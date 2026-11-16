import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { rateLimit } from 'express-rate-limit';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  appointmentUpdateSchema,
  availabilityQuerySchema,
  bookingInputSchema,
  eventInputSchema,
  leadInputSchema,
  leadUpdateSchema,
  LEAD_STATUSES,
  loginSchema,
  serviceAreaSchema,
  slotsQuerySchema,
  type AvailabilityResult,
} from '../shared/schemas';
import { BRAND, CONSENT_VERSION, consentText } from '../shared/content';
import { marketSchema, type Market } from '../shared/market';
import type { AppConfig } from './config';
import type { DB } from './db';
import { renderHtml, type BootData } from './html';
import { createNotifier, listNotifications, type Notifier } from './notify';
import {
  createSessionToken,
  newToken,
  parseCookies,
  readSessionToken,
  safeEqual,
  SESSION_COOKIE,
  SESSION_TTL_MS,
  sha256,
  verifyPassword,
  type Session,
} from './lib/auth';
import * as repo from './repo';
import { availableSlots, bookableDates, bookAppointment, BookingError } from './scheduling';

declare module 'express-serve-static-core' {
  interface Request {
    session?: Session;
  }
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

function parse<T extends z.ZodType>(schema: T, data: unknown): z.output<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const issue of r.error.issues) fields[issue.path.join('.') || '_'] ??= issue.message;
    throw new HttpError(400, 'Please check the highlighted fields.', fields);
  }
  return r.data;
}

const summary = (m: Market) => ({ slug: m.slug, name: m.name, state: m.state });
/** Market data safe to publish: internal team inboxes are removed. */
const publicMarket = (m: Market): Market => ({ ...m, notifyEmails: [] });

/** Visitor-facing availability message. `market` is the market the ZIP belongs to. */
export function describeAvailability(zip: string, area: repo.ServiceArea | null, market: Market | null): AvailabilityResult {
  const city = area?.city ?? null;
  const provider = market?.provider ?? 'Fiber';
  const base = { zip, city, market: market && area ? summary(market) : null };
  switch (area?.status) {
    case 'available':
      return { ...base, status: 'available', headline: `${provider} is available in ${city}!`,
        message: 'Your area is being served. Reserve a free consultation to confirm your address and lock in your install.' };
    case 'verify':
      return { ...base, status: 'verify', headline: `${city} is in the ${provider} build area`,
        message: 'Fiber is rolling out across your ZIP code. Book a quick consultation and we’ll confirm service at your exact address.' };
    case 'coming_soon':
      return { ...base, status: 'coming_soon', headline: `Fiber is coming to ${city}`,
        message: 'Your area is on the expansion map. Join the priority list and we’ll reach out the moment your street opens.' };
    case 'not_serviceable':
      return { ...base, status: 'not_serviceable', headline: 'Not in the service area yet',
        message: 'We aren’t able to serve this ZIP code right now. Leave your info and we’ll let you know if that changes.' };
    default:
      return { zip, city: null, market: null, status: 'unknown', headline: 'We’re checking your area',
        message: 'This ZIP isn’t on our launch map yet. Leave your details and a local specialist will check your address.' };
  }
}

export function createApp(config: AppConfig, db: DB, deps: { notifier?: Notifier } = {}) {
  const notifier = deps.notifier ?? createNotifier(db, config);
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'"],
          mediaSrc: ["'self'"],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
  app.use(compression());
  app.use(express.json({ limit: '40kb' }));

  const isTest = process.env.NODE_ENV === 'test';
  const limiter = (limit: number, windowMinutes: number) =>
    rateLimit({ windowMs: windowMinutes * 60000, limit, standardHeaders: 'draft-8', legacyHeaders: false, skip: () => isTest });

  /** Active market by slug; empty slug means the default market. */
  const resolveMarket = (slug: string | undefined): Market => {
    if (!slug) return repo.getDefaultMarket(db);
    const m = repo.getMarket(db, slug);
    if (!m || !m.active) throw new HttpError(404, 'Unknown location.');
    return m;
  };
  /** Market owning a ZIP, if that market is active. */
  const areaMarket = (area: repo.ServiceArea | null): Market | null => {
    if (!area) return null;
    const m = repo.getMarket(db, area.marketId);
    return m?.active ? m : null;
  };

  const api = express.Router();
  api.use(limiter(300, 15));

  // ------------------------------------------------------------- public --
  api.get('/health', (_req, res) => res.json({ ok: true }));

  api.get('/markets', (_req, res) => res.json({ markets: repo.marketSummaries(db), defaultSlug: repo.getDefaultMarket(db).slug }));

  api.get('/markets/:slug', (req, res) => {
    const slug = String(req.params.slug);
    res.json({ market: publicMarket(resolveMarket(slug === 'default' ? undefined : slug)) });
  });

  api.get('/availability', (req, res) => {
    const { zip } = parse(availabilityQuerySchema, req.query);
    const area = repo.getServiceArea(db, zip);
    const owner = areaMarket(area);
    res.json(describeAvailability(zip, owner ? area : null, owner));
  });

  api.post('/leads', limiter(10, 15), (req, res) => {
    const input = parse(leadInputSchema, req.body);
    const page = resolveMarket(input.market || undefined);
    if (input.website) {
      // Honeypot tripped: pretend success so bots learn nothing.
      res.status(201).json({ leadId: crypto.randomUUID(), bookingToken: newToken(), market: page.slug, availability: describeAvailability(input.zip, null, null) });
      return;
    }
    const rawArea = repo.getServiceArea(db, input.zip);
    const owner = areaMarket(rawArea);
    const area = owner ? rawArea : null;
    // Route the lead to the market that serves the ZIP, but only when it's the same
    // provider the visitor consented to be contacted about; otherwise keep the page's market.
    const market = owner && owner.provider === page.provider ? owner : page;
    const bookingToken = newToken();
    const { lead, duplicate } = repo.createLead(db, {
      firstName: input.firstName,
      lastName: input.lastName,
      email: input.email,
      phone: input.phone,
      street: input.street,
      unit: input.unit,
      city: input.city,
      zip: input.zip,
      preferredContact: input.preferredContact,
      currentProvider: input.currentProvider,
      areaStatus: area?.status ?? 'unknown',
      source: input.source,
      utmSource: input.utmSource,
      utmMedium: input.utmMedium,
      utmCampaign: input.utmCampaign,
      utmContent: input.utmContent,
      utmTerm: input.utmTerm,
      clickId: input.clickId,
      referrer: input.referrer,
      landingPage: input.landingPage,
      sessionId: input.sessionId,
      marketId: market.slug,
      bookingTokenHash: sha256(bookingToken),
      // Exactly the consent wording shown on the page the visitor submitted from.
      consentText: `[${CONSENT_VERSION}] ${consentText(page)}`,
      consentIp: req.ip ?? '',
      consentUserAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
    });
    // Recorded server-side so conversions count even when the browser blocks beacons.
    repo.insertEvent(db, {
      name: 'lead_submit',
      sessionId: input.sessionId,
      path: input.landingPage,
      props: { areaStatus: area?.status ?? 'unknown', duplicate },
      utmSource: input.utmSource,
      utmCampaign: input.utmCampaign,
      marketId: market.slug,
    });
    notifier.onLead(lead, duplicate);
    res.status(201).json({ leadId: lead.id, bookingToken, market: market.slug, availability: describeAvailability(input.zip, area, owner) });
  });

  // First-party conversion events. Server-recorded events are not accepted from clients.
  api.post('/events', limiter(120, 15), (req, res) => {
    const e = parse(eventInputSchema, req.body);
    const marketId = e.market && repo.getMarket(db, e.market) ? e.market : '';
    if (e.name !== 'lead_submit' && e.name !== 'appointment_booked') repo.insertEvent(db, { ...e, marketId });
    res.status(204).end();
  });

  api.get('/schedule/dates', (req, res) => {
    const market = resolveMarket(typeof req.query.market === 'string' ? req.query.market : undefined);
    res.json({ market: market.slug, timezone: market.timezone, dates: bookableDates(market.schedule, market.timezone) });
  });

  api.get('/schedule/slots', (req, res) => {
    const { date, market: slug } = parse(slotsQuerySchema, req.query);
    const market = resolveMarket(slug);
    res.json({ date, market: market.slug, timezone: market.timezone, slots: availableSlots(db, market, date) });
  });

  api.post('/appointments', limiter(20, 15), (req, res) => {
    const input = parse(bookingInputSchema, req.body);
    const appt = bookAppointment(db, input);
    notifier.onBooked(appt);
    const booked = repo.getLead(db, input.leadId);
    repo.insertEvent(db, {
      name: 'appointment_booked',
      sessionId: '',
      path: booked?.landingPage ?? '',
      props: {},
      utmSource: booked?.utmSource ?? '',
      utmCampaign: booked?.utmCampaign ?? '',
      marketId: appt.marketId,
    });
    res.status(201).json({ appointment: { id: appt.id, startUtc: appt.startUtc, endUtc: appt.endUtc, status: appt.status } });
  });

  // -------------------------------------------------------------- admin --
  const cookieOpts = {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: config.isProduction,
    path: '/',
  };

  api.post('/admin/login', limiter(10, 15), (req, res) => {
    const { email, password } = parse(loginSchema, req.body);
    // Always run the hash check so response time doesn't reveal valid emails.
    const pwOk = verifyPassword(password, config.adminPasswordHash);
    if (!pwOk || !safeEqual(email, config.adminEmail)) throw new HttpError(401, 'Invalid email or password.');
    res.cookie(SESSION_COOKIE, createSessionToken(email, config.sessionSecret), { ...cookieOpts, maxAge: SESSION_TTL_MS });
    res.json({ email });
  });

  api.post('/admin/logout', (req, res) => {
    if (req.headers['x-requested-with'] !== 'fetch') throw new HttpError(403, 'Missing request header.');
    res.clearCookie(SESSION_COOKIE, cookieOpts);
    res.json({ ok: true });
  });

  const admin = express.Router();
  admin.use((req, res, next) => {
    res.set('Cache-Control', 'no-store'); // admin data must never be cached
    const session = readSessionToken(parseCookies(req.headers.cookie)[SESSION_COOKIE], config.sessionSecret);
    if (!session) throw new HttpError(401, 'Please sign in.');
    // CSRF defence in depth: state-changing requests must carry a custom header,
    // which browsers won't send cross-origin without a CORS preflight we never allow.
    if (req.method !== 'GET' && req.headers['x-requested-with'] !== 'fetch') {
      throw new HttpError(403, 'Missing request header.');
    }
    req.session = session;
    next();
  });

  const marketQuery = z.object({ market: z.string().trim().max(40).optional() });

  admin.get('/me', (req, res) => {
    const missingTeam = repo.listMarkets(db, { activeOnly: true }).filter((m) => !notifier.teamTo(m).length).map((m) => m.name);
    res.json({ email: req.session!.email, emailEnabled: notifier.enabled, locationsWithoutTeamEmail: missingTeam });
  });

  admin.get('/stats', (_req, res) => res.json(repo.leadStats(db)));

  admin.get('/conversions', (req, res) => {
    const { market } = parse(marketQuery, req.query);
    res.json(repo.conversionStats(db, 30, market || undefined));
  });

  // Locations (markets)
  admin.get('/markets', (_req, res) => res.json({ markets: repo.listMarkets(db), leadCounts: repo.leadStatsByMarket(db) }));

  const saveMarket = (m: Market) => {
    try {
      return repo.saveMarket(db, m);
    } catch (err) {
      // Only our own validation messages are shown; anything else is logged, not echoed.
      const msg = err instanceof Error && /default|active/.test(err.message) ? err.message : 'Could not save location.';
      if (msg === 'Could not save location.') console.error('[markets] save failed', err);
      throw new HttpError(400, msg);
    }
  };

  admin.post('/markets', (req, res) => {
    const m = parse(marketSchema, req.body);
    if (repo.getMarket(db, m.slug)) throw new HttpError(409, 'A location with that URL already exists.', { slug: 'Already in use' });
    res.status(201).json({ market: saveMarket(m) });
  });

  admin.put('/markets/:slug', (req, res) => {
    const slug = String(req.params.slug);
    if (!repo.getMarket(db, slug)) throw new HttpError(404, 'Location not found.');
    // The URL slug is permanent once created (links, leads and appointments reference it).
    res.json({ market: saveMarket(parse(marketSchema, { ...req.body, slug })) });
  });

  admin.get('/leads', (req, res) => {
    const q = parse(
      z.object({
        status: z.enum(LEAD_STATUSES).optional(),
        market: z.string().trim().max(40).optional(),
        q: z.string().trim().max(100).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
        offset: z.coerce.number().int().min(0).optional(),
      }),
      req.query,
    );
    res.json(repo.listLeads(db, q));
  });

  admin.get('/leads.csv', (req, res) => {
    const { market } = parse(marketQuery, req.query);
    const { leads } = repo.listLeads(db, { limit: 10_000, maxLimit: 10_000, market: market || undefined });
    const cols = ['createdAt', 'marketId', 'firstName', 'lastName', 'phone', 'email', 'street', 'unit', 'city', 'zip', 'status', 'areaStatus', 'source', 'utmSource', 'utmCampaign'] as const;
    const esc = (v: string) => {
      const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v; // block spreadsheet formula injection
      return `"${s.replace(/"/g, '""')}"`;
    };
    const csv = [cols.join(','), ...leads.map((l) => cols.map((c) => esc(String(l[c] ?? ''))).join(','))].join('\n');
    res.type('text/csv').attachment('leads.csv').send(csv);
  });

  admin.get('/leads/:id', (req, res) => {
    const lead = repo.getLead(db, String(req.params.id));
    if (!lead) throw new HttpError(404, 'Lead not found.');
    res.json({
      lead,
      notes: repo.listNotes(db, lead.id),
      appointments: repo.listAppointments(db, { leadId: lead.id }),
      notifications: listNotifications(db, lead.id),
      consents: repo.listConsents(db, lead.id),
    });
  });

  admin.patch('/leads/:id', (req, res) => {
    const id = String(req.params.id);
    const body = parse(leadUpdateSchema, req.body);
    if (!repo.getLead(db, id)) throw new HttpError(404, 'Lead not found.');
    if (body.status) repo.updateLeadStatus(db, id, body.status, req.session!.email);
    if (body.note) repo.addNote(db, id, body.note, req.session!.email);
    res.json({ lead: repo.getLead(db, id), notes: repo.listNotes(db, id) });
  });

  admin.get('/appointments', (req, res) => {
    const { from, market } = parse(z.object({ from: z.string().datetime().optional(), market: z.string().trim().max(40).optional() }), req.query);
    const fromUtc = from ?? new Date(Date.now() - 7 * 86400000).toISOString();
    res.json({ appointments: repo.listAppointments(db, { fromUtc, market: market || undefined }) });
  });

  admin.patch('/appointments/:id', (req, res) => {
    const { status } = parse(appointmentUpdateSchema, req.body);
    const appt = repo.setAppointmentStatus(db, String(req.params.id), status);
    if (!appt) throw new HttpError(404, 'Appointment not found.');
    repo.addNote(db, appt.leadId, `Appointment ${appt.startUtc} marked ${status}`, req.session!.email);
    res.json({ appointment: appt });
  });

  admin.get('/service-areas', (req, res) => {
    const { market } = parse(marketQuery, req.query);
    res.json({ areas: repo.listServiceAreas(db, market || undefined) });
  });

  admin.put('/service-areas', (req, res) => {
    const a = parse(serviceAreaSchema, req.body);
    if (!repo.getMarket(db, a.marketId)) throw new HttpError(400, 'Unknown location.', { marketId: 'Unknown location' });
    repo.upsertServiceArea(db, a);
    res.json({ areas: repo.listServiceAreas(db) });
  });

  admin.delete('/service-areas/:zip', (req, res) => {
    repo.deleteServiceArea(db, String(req.params.zip));
    res.json({ areas: repo.listServiceAreas(db) });
  });

  api.use('/admin', admin);
  api.use((_req, _res, next) => next(new HttpError(404, 'Not found.')));
  app.use('/api', api);

  // ----------------------------------------------------- SEO endpoints --
  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n\nSitemap: ${config.siteUrl}/sitemap.xml\n`);
  });
  app.get('/sitemap.xml', (_req, res) => {
    const def = repo.getDefaultMarket(db);
    const paths = ['/', ...repo.marketSummaries(db).filter((m) => m.slug !== def.slug).map((m) => `/${m.slug}`), '/privacy'];
    const urls = paths.map((p) => `  <url><loc>${config.siteUrl}${p}</loc></url>`).join('\n');
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
  });

  // ---------------------------------------------------- pages (production) --
  const dist = resolve('dist');
  if (config.isProduction && existsSync(dist)) {
    // Hashed build assets never change; media changes rarely.
    app.use('/assets', express.static(resolve(dist, 'assets'), { immutable: true, maxAge: '1y', index: false }));
    app.use('/media', express.static(resolve(dist, 'media'), { maxAge: '30d', index: false }));
    app.use(express.static(dist, { index: false, maxAge: '1d' }));
    const template = readFileSync(resolve(dist, 'index.html'), 'utf8');

    app.get(/^(?!\/api).*/, (req, res) => {
      const def = repo.getDefaultMarket(db);
      const boot = (market: Market): BootData => ({ market: publicMarket(market), markets: repo.marketSummaries(db), defaultSlug: def.slug });
      const send = (status: number, html: string) => res.status(status).set('Cache-Control', 'no-cache').type('html').send(html);
      const path = req.path.replace(/\/+$/, '') || '/';
      const base = { siteUrl: config.siteUrl };

      if (path === '/') return send(200, renderHtml(template, { ...base, canonicalPath: '/', boot: boot(def) }));
      if (path === '/privacy') {
        return send(200, renderHtml(template, { ...base, canonicalPath: '/privacy', title: `Privacy Notice — ${BRAND.name}`, boot: boot(def) }));
      }
      if (path === '/admin' || path.startsWith('/admin/')) {
        return send(200, renderHtml(template, { ...base, canonicalPath: '/', noindex: true, title: `${BRAND.name} — Team`, boot: boot(def) }));
      }
      const slug = path.slice(1);
      if (/^[a-z0-9-]{2,40}$/.test(slug)) {
        if (slug === def.slug) return res.redirect(301, '/'); // one URL per page
        const m = repo.getMarket(db, slug);
        if (m?.active) return send(200, renderHtml(template, { ...base, canonicalPath: `/${slug}`, boot: boot(m) }));
      }
      return send(404, renderHtml(template, { ...base, canonicalPath: '/', noindex: true, boot: boot(def) }));
    });
  }

  // -------------------------------------------------------------- errors --
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError || err instanceof BookingError) {
      res.status(err.status).json({ error: err.message, fields: err instanceof HttpError ? err.details : undefined });
      return;
    }
    const status = (err as { status?: number }).status;
    if (status && status >= 400 && status < 500) {
      res.status(status).json({ error: 'Bad request.' });
      return;
    }
    console.error(err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });

  return app;
}
