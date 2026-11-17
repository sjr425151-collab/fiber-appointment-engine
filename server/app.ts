import { randomUUID } from 'node:crypto';
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
  repInputSchema,
  serviceAreaSchema,
  SERVER_ONLY_EVENTS,
  slotsQuerySchema,
  type AvailabilityResult,
  type Representative,
} from '../shared/schemas';
import { ROUTING_REASON } from '../shared/platform/routing';
import { noCrm, type CrmAdapter } from './integrations/crm';
import { BRAND, CONSENT_VERSION, consentText } from '../shared/content';
import { marketSchema, type Market } from '../shared/market';
import type { AppConfig } from './config';
import type { DB } from './db';
import { renderHtml, type BootData } from './html';
import { platformPreloader } from './preload';
import { PLATFORM_META, PLATFORM_OG_IMAGE, platformStructuredData } from '../shared/platform/brand';
import { OPPORTUNITY_STATUSES } from '../shared/platform/opportunity';
import { createNotifier, listNotifications, type Notifier } from './notify';
import { platformRouter, PlatformError } from './platform';
import {
  createSessionToken,
  hashPassword,
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
import * as team from './repo-team';
import { errorFields, log } from './lib/log';
import { availableSlots, bookableDates, bookAppointment, BookingError } from './scheduling';

declare module 'express-serve-static-core' {
  interface Request {
    session?: Session;
    /** Set when the signed-in person is a representative (they see only their own leads). */
    rep?: Representative;
    /** Correlates a response with its log lines (also sent as X-Request-Id). */
    requestId?: string;
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

export function createApp(config: AppConfig, db: DB, deps: { notifier?: Notifier; htmlTemplate?: string; crm?: CrmAdapter } = {}) {
  const notifier = deps.notifier ?? createNotifier(db, config);
  const app = express();
  app.disable('x-powered-by');
  // Request id: reuse a sane upstream id (Render sends rndr-id), else generate one.
  app.use((req, res, next) => {
    const upstream = String(req.headers['x-request-id'] ?? req.headers['rndr-id'] ?? '');
    req.requestId = /^[\w-]{8,64}$/.test(upstream) ? upstream : randomUUID();
    res.set('X-Request-Id', req.requestId);
    next();
  });
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

  // Host canonicalisation for the move to the canonical domain (config.siteUrl):
  //  - "www." + canonical host always redirects to the canonical host;
  //  - legacy domains redirect only once LEGACY_REDIRECTS is switched on.
  // Only page requests (GET/HEAD outside /api) are redirected, so a form already
  // open on the old domain can still submit, and health checks are never touched.
  // Retired paths are mapped in the same step so an old link takes a single hop.
  // The target is always the fixed canonical origin, so this cannot loop or be
  // steered to another site.
  const canonicalHost = new URL(config.siteUrl).hostname.toLowerCase();
  // A retired domain's www form moves with it, listed or not.
  const legacyHosts = new Set((config.domains?.legacyHosts ?? []).flatMap((h) => [h, h.startsWith('www.') ? h : `www.${h}`]).filter((h) => h !== canonicalHost));
  const legacyRedirects = config.domains?.legacyRedirects === true;
  /**
   * Retired URLs → their replacement, or null when the path is current.
   *  /savings          → /                  (Tucker's home moved to the root)
   *  /internet         → /                  (no national internet page; the home covers it)
   *  /<location>       → /internet/<location>  (regional internet pages moved under /internet)
   */
  const retiredPath = (rawPath: string): string | null => {
    const path = rawPath.replace(/\/+$/, '') || '/';
    if (path === '/savings' || path === '/internet') return '/';
    // Regional internet pages were retired with the location system: their old addresses lead to the national home.
    const slug = /^\/(?:internet\/)?([a-z0-9-]{2,40})$/.exec(path)?.[1];
    if (slug && repo.getMarket(db, slug)) return '/';
    return null;
  };
  app.use((req, res, next) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || req.path === '/api' || req.path.startsWith('/api/')) return next();
    const host = (req.hostname ?? '').toLowerCase();
    const moveHost = !!host && host !== canonicalHost && (host === `www.${canonicalHost}` || (legacyHosts.has(host) && legacyRedirects));
    const moved = retiredPath(req.path);
    if (!moveHost && moved === null) return next();
    // One hop: the new path and (when needed) the canonical host together, query kept.
    const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
    const target = `${moved ?? req.path}${query}`;
    // One hour of caching at first, so a change can be undone quickly if needed.
    res.set('Cache-Control', 'public, max-age=3600');
    res.redirect(301, moveHost ? `${config.siteUrl}${target}` : target);
  });

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
  // Liveness + readiness for Render's health check and uptime monitors: proves the
  // database answers. No secrets; the commit id helps confirm what is deployed.
  api.get('/health', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      db.prepare('SELECT 1').get();
      res.json({ ok: true, db: 'ok', env: config.flags.env, version: (process.env.RENDER_GIT_COMMIT ?? 'dev').slice(0, 7) });
    } catch (err) {
      log('error', 'health_db_failed', errorFields(err));
      res.status(503).json({ ok: false, db: 'error' });
    }
  });

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
    if (!SERVER_ONLY_EVENTS.includes(e.name)) repo.insertEvent(db, { ...e, marketId });
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
    if (pwOk && safeEqual(email, config.adminEmail)) {
      res.cookie(SESSION_COOKIE, createSessionToken(email, config.sessionSecret), { ...cookieOpts, maxAge: SESSION_TTL_MS });
      res.json({ email, role: 'admin' });
      return;
    }
    // Representatives sign in with their own password and get a restricted session.
    const cred = repo.getRepCredentials(db, email);
    if (!cred?.active || !cred.passwordHash || !verifyPassword(password, cred.passwordHash)) throw new HttpError(401, 'Invalid email or password.');
    res.cookie(SESSION_COOKIE, createSessionToken(email, config.sessionSecret, Date.now(), { role: 'rep', repId: cred.id }), { ...cookieOpts, maxAge: SESSION_TTL_MS });
    res.json({ email, role: 'rep' });
  });

  api.post('/admin/logout', (req, res) => {
    if (req.headers['x-requested-with'] !== 'fetch') throw new HttpError(403, 'Missing request header.');
    res.clearCookie(SESSION_COOKIE, cookieOpts);
    res.json({ ok: true });
  });

  /** Everything a representative's session may call. All other team routes are admin only. */
  const UUID = '[0-9a-f-]{36}';
  const REP_ROUTES: [string, RegExp][] = [
    ['GET', /^\/me$/],
    ['GET', /^\/leads$/],
    ['GET', new RegExp(`^/leads/${UUID}$`)],
    ['PATCH', new RegExp(`^/leads/${UUID}$`)],
    ['PATCH', new RegExp(`^/opportunities/${UUID}$`)],
    ['PATCH', /^\/reps\/me$/],
  ];
  const crm: CrmAdapter = deps.crm ?? noCrm;
  /** The benchmark values a browser needs (no author or notes). */
  const publicBenchmarks = () => {
    const b = repo.currentBenchmarks(db);
    return { version: b.version, internetMonthly: b.internetMonthly, mobilePerLine: b.mobilePerLine, tvMonthly: b.tvMonthly, electricityWithSolarMonthly: b.electricityWithSolarMonthly };
  };

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
    if (session.role === 'rep') {
      // Checked on every request, so deactivating a representative ends their access at once.
      const me = session.repId ? repo.getRep(db, session.repId) : null;
      if (!me?.active) throw new HttpError(401, 'Please sign in.');
      if (!REP_ROUTES.some(([method, path]) => method === req.method && path.test(req.path))) throw new HttpError(403, 'Not available for your account.');
      req.rep = me;
    }
    next();
  });

  /** Lead access: an admin sees every lead; a representative only the ones assigned to them (anything else looks missing). */
  const leadFor = (req: Request, id: string) => {
    const lead = repo.getLead(db, id);
    if (!lead || (req.rep && lead.assignedRepId !== req.rep.id)) throw new HttpError(404, 'Lead not found.');
    return lead;
  };
  const actor = (req: Request) => req.session!.email;

  const marketQuery = z.object({ market: z.string().trim().max(40).optional() });

  admin.get('/me', (req, res) => {
    const missingTeam = notifier.teamTo(repo.getDefaultMarket(db)).length ? [] : ['new leads'];
    // Prices that are (about to be) hidden from the savings comparison because nobody re-verified them.
    // Location plan prices are no longer shown to customers, so there is nothing to warn about.
    const pricing: { name: string; state: 'expiring' | 'hidden'; daysLeft: number | null }[] = [];
    res.json({
      email: req.session!.email,
      role: req.rep ? 'rep' : 'admin',
      rep: req.rep ? { id: req.rep.id, name: req.rep.name, accepting: req.rep.accepting, openLeads: req.rep.openLeads } : null,
      emailEnabled: notifier.enabled,
      locationsWithoutTeamEmail: req.rep ? [] : missingTeam,
      pricingWarnings: req.rep ? [] : pricing,
      crm: { name: crm.name, configured: crm.configured },
      representatives: req.rep ? undefined : repo.listReps(db).filter((r) => r.active).length,
    });
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
        /** A representative's id, or "unassigned" for the follow-up queue. */
        assigned: z.union([z.literal('unassigned'), z.string().uuid()]).optional(),
      }),
      req.query,
    );
    const { assigned, ...rest } = q;
    // A representative's list is always their own leads, whatever the query says.
    const scope = req.rep ? { rep: req.rep.id } : assigned === 'unassigned' ? { unassigned: true } : assigned ? { rep: assigned } : {};
    res.json(repo.listLeads(db, { ...rest, ...scope }));
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

  admin.get('/assessments', (req, res) => {
    const q = parse(z.object({ limit: z.coerce.number().int().min(1).max(200).optional(), offset: z.coerce.number().int().min(0).optional() }), req.query);
    res.json({ ...repo.listAssessments(db, q), stats: repo.assessmentStats(db, 30) });
  });

  admin.get('/assessments/:id', (req, res) => {
    const a = repo.getAssessment(db, String(req.params.id));
    if (!a) throw new HttpError(404, 'Assessment not found.');
    res.json({ assessment: a });
  });

  const opportunityQuery = z.object({
    status: z.enum(OPPORTUNITY_STATUSES).optional(),
    category: z.string().trim().regex(/^[a-z_]{1,30}$/).optional(),
    market: z.string().trim().max(40).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  });
  admin.get('/opportunities', (req, res) => {
    const q = parse(opportunityQuery, req.query);
    res.json({ ...repo.listOpportunities(db, { ...q, market: q.market || undefined }), stats: repo.opportunityStats(db, q.market || undefined) });
  });

  admin.patch('/opportunities/:id', (req, res) => {
    const { status } = parse(z.object({ status: z.enum(OPPORTUNITY_STATUSES) }).strict(), req.body);
    const before = repo.getOpportunity(db, String(req.params.id));
    if (!before) throw new HttpError(404, 'Opportunity not found.');
    if (req.rep && repo.getLead(db, before.leadId)?.assignedRepId !== req.rep.id) throw new HttpError(404, 'Opportunity not found.');
    const o = repo.updateOpportunityStatus(db, before.id, status, actor(req));
    if (!o) throw new HttpError(404, 'Opportunity not found.');
    res.json({ opportunity: o, notes: repo.listNotes(db, o.leadId) });
  });

  admin.get('/leads/:id', (req, res) => {
    const lead = leadFor(req, String(req.params.id));
    const reps = repo.listReps(db);
    res.json({
      lead,
      notes: repo.listNotes(db, lead.id),
      appointments: repo.listAppointments(db, { leadId: lead.id }),
      notifications: listNotifications(db, lead.id),
      consents: repo.listConsents(db, lead.id),
      assessment: lead.assessmentId ? repo.getAssessment(db, lead.assessmentId) : null,
      opportunities: repo.opportunitiesForLead(db, lead.id),
      history: repo.listLeadHistory(db, lead.id),
      representative: reps.find((r) => r.id === lead.assignedRepId)?.name ?? null,
      // Only an admin can reassign, so only an admin gets the list of people.
      representatives: req.rep ? undefined : reps.filter((r) => r.active).map((r) => ({ id: r.id, name: r.name, accepting: r.accepting, openLeads: r.openLeads })),
    });
  });

  admin.patch('/leads/:id', (req, res) => {
    const id = String(req.params.id);
    const body = parse(leadUpdateSchema, req.body);
    const lead = leadFor(req, id);
    if (body.assignRepId !== undefined) {
      if (req.rep) throw new HttpError(403, 'Only an admin can reassign a lead.');
      if (body.assignRepId && !repo.getRep(db, body.assignRepId)?.active) throw new HttpError(400, 'Choose an active representative.');
      repo.assignLead(db, id, body.assignRepId, { outcome: body.assignRepId ? 'assigned' : 'queued', reason: ROUTING_REASON.manual, actor: actor(req) });
      if (body.assignRepId) repo.insertEvent(db, { name: 'rep_assigned', sessionId: '', path: lead.landingPage, props: { reason: 'manual' }, utmSource: lead.utmSource, utmCampaign: lead.utmCampaign, marketId: lead.marketId });
    }
    if (body.status && body.status !== lead.status) {
      repo.updateLeadStatus(db, id, body.status, actor(req));
      // Funnel events are recorded only when a person confirms the outcome here.
      const event = body.status === 'qualified' ? 'lead_qualified' : body.status === 'sold' ? 'lead_converted' : null;
      if (event) repo.insertEvent(db, { name: event, sessionId: '', path: lead.landingPage, props: {}, utmSource: lead.utmSource, utmCampaign: lead.utmCampaign, marketId: lead.marketId });
    }
    if (body.note) repo.addNote(db, id, body.note, actor(req));
    res.json({ lead: repo.getLead(db, id), notes: repo.listNotes(db, id), history: repo.listLeadHistory(db, id), representative: repo.listReps(db).find((r) => r.id === repo.getLead(db, id)?.assignedRepId)?.name ?? null });
  });

  // Representatives: who receives leads. Managed by the admin; a representative can only switch their own "accepting".
  const repBody = (req: Request) => {
    const b = parse(repInputSchema, req.body);
    const { password, ...rest } = b;
    return { ...rest, passwordHash: password ? hashPassword(password) : undefined };
  };
  const uniqueEmail = (err: unknown) => {
    if (err instanceof Error && /UNIQUE constraint failed: representatives.email/.test(err.message)) throw new HttpError(400, 'Another representative already uses that email.');
    throw err;
  };
  admin.get('/reps', (_req, res) => res.json({ representatives: repo.listReps(db) }));
  admin.post('/reps', (req, res) => {
    const input = repBody(req);
    if (safeEqual(input.email, config.adminEmail)) throw new HttpError(400, 'That email belongs to the admin account.');
    try {
      res.status(201).json({ representative: repo.createRep(db, input) });
    } catch (err) {
      uniqueEmail(err);
    }
  });
  admin.patch('/reps/me', (req, res) => {
    if (!req.rep) throw new HttpError(403, 'Only a representative can change this.');
    const { accepting } = parse(z.object({ accepting: z.boolean() }).strict(), req.body);
    res.json({ representative: repo.setRepAccepting(db, req.rep.id, accepting) });
  });
  admin.put('/reps/:id', (req, res) => {
    const input = repBody(req);
    try {
      const r = repo.updateRep(db, String(req.params.id), input);
      if (!r) throw new HttpError(404, 'Representative not found.');
      res.json({ representative: r });
    } catch (err) {
      uniqueEmail(err);
    }
  });

  admin.get('/handoff-funnel', (_req, res) => res.json(repo.handoffFunnel(db, 30)));

  // National benchmarks: one current set, every change a new version with its author.
  const benchmarkBody = z
    .object({
      internetMonthly: z.number().int().min(100).max(100_000),
      mobilePerLine: z.number().int().min(100).max(100_000),
      tvMonthly: z.number().int().min(100).max(100_000),
      electricityWithSolarMonthly: z.number().int().min(100).max(200_000),
      note: z.string().trim().max(300).optional().default(''),
    })
    .strict();
  admin.get('/benchmarks', (_req, res) => res.json({ current: repo.currentBenchmarks(db), history: repo.listBenchmarkVersions(db) }));
  admin.post('/benchmarks', (req, res) => {
    const { note, ...values } = parse(benchmarkBody, req.body);
    const before = repo.currentBenchmarks(db);
    const current = repo.publishBenchmarks(db, values, note, actor(req));
    team.addAudit(db, { actor: actor(req), role: 'super_admin', action: 'benchmarks.publish', resourceType: 'benchmarks', resourceId: current.version, detail: { from: before.version, values, note }, ip: req.ip ?? '' });
    res.status(201).json({ current, history: repo.listBenchmarkVersions(db) });
  });
  admin.post('/benchmarks/:id/restore', (req, res) => {
    const old = repo.listBenchmarkVersions(db).find((v) => v.id === Number(req.params.id));
    if (!old) throw new HttpError(404, 'Version not found.');
    const current = repo.publishBenchmarks(db, old, `Restored the values of ${old.version}`, actor(req));
    team.addAudit(db, { actor: actor(req), role: 'super_admin', action: 'benchmarks.restore', resourceType: 'benchmarks', resourceId: current.version, detail: { restored: old.version }, ip: req.ip ?? '' });
    res.status(201).json({ current, history: repo.listBenchmarkVersions(db) });
  });
  admin.get('/benchmarks/audit', (_req, res) => res.json(team.listAudit(db, { resourceType: 'benchmarks', limit: 50 })));

  // Central settings: where new-lead alerts go (replaces the per-location alert email).
  const emailList = z.array(z.string().trim().toLowerCase().email('Enter valid email addresses')).max(10);
  admin.get('/settings', (_req, res) => {
    res.json({ teamEmails: notifier.centralTeamEmails(), fallbackTeamEmails: config.email.teamEmails, emailEnabled: notifier.enabled, emailFrom: config.email.from });
  });
  admin.put('/settings', (req, res) => {
    const { teamEmails } = parse(z.object({ teamEmails: emailList }).strict(), req.body);
    team.setSetting(db, 'notify.teamEmails', JSON.stringify(teamEmails));
    team.addAudit(db, { actor: actor(req), role: 'super_admin', action: 'settings.update', resourceType: 'settings', resourceId: 'notify.teamEmails', detail: { count: teamEmails.length }, ip: req.ip ?? '' });
    res.json({ teamEmails: notifier.centralTeamEmails(), fallbackTeamEmails: config.email.teamEmails, emailEnabled: notifier.enabled, emailFrom: config.email.from });
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

  // Household savings API (assessments, results, contact).
  api.use('/platform', platformRouter(config, db, notifier));

  api.use('/admin', admin);
  api.use((_req, _res, next) => next(new HttpError(404, 'Not found.')));
  app.use('/api', api);

  // ----------------------------------------------------- SEO endpoints --
  app.get('/robots.txt', (_req, res) => {
    if (config.flags.env !== 'production') return res.type('text/plain').send('User-agent: *\nDisallow: /\n');
    res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\n\nSitemap: ${config.siteUrl}/sitemap.xml\n`);
  });
  app.get('/sitemap.xml', (_req, res) => {
    const paths = ['/', '/savings/assess', '/privacy'];
    const urls = paths.map((p) => `  <url><loc>${config.siteUrl}${p}</loc></url>`).join('\n');
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
  });

  // ---------------------------------------------------- pages (production) --
  const dist = resolve('dist');
  const serveBuild = config.isProduction && existsSync(dist);
  if (serveBuild) {
    // Hashed build assets never change; media changes rarely.
    app.use('/assets', express.static(resolve(dist, 'assets'), { immutable: true, maxAge: '1y', index: false }));
    app.use('/media', express.static(resolve(dist, 'media'), { maxAge: '30d', index: false }));
    app.use(express.static(dist, { index: false, maxAge: '1d' }));
  }
  // Tests inject a template so page routing is covered without a production build.
  const template = deps.htmlTemplate ?? (serveBuild ? readFileSync(resolve(dist, 'index.html'), 'utf8') : null);
  const platformPreloads = platformPreloader(resolve(dist, '.vite', 'manifest.json'));
  if (template) {
    app.get(/^(?!\/api).*/, (req, res) => {
      const def = repo.getDefaultMarket(db);
      const boot = (market: Market): BootData => ({
        market: publicMarket(market),
        markets: repo.marketSummaries(db),
        defaultSlug: def.slug,
        flags: config.flags,
        benchmarks: publicBenchmarks(),
      });
      const send = (status: number, html: string) => res.status(status).set('Cache-Control', 'no-cache').type('html').send(html);
      const path = req.path.replace(/\/+$/, '') || '/';
      const base = { siteUrl: config.siteUrl };

      const tucker = { title: PLATFORM_META.title, description: PLATFORM_META.description, ogImage: PLATFORM_OG_IMAGE, ogImageAlt: `${BRAND.name}. Your home service savings broker.`, omitStructuredData: true };
      // Tucker's national home.
      if (path === '/') {
        return send(200, renderHtml(template, { ...base, ...tucker, canonicalPath: '/', heroPreload: true, structuredData: platformStructuredData(config.siteUrl), preload: platformPreloads(path), boot: boot(def) }));
      }
      if (path === '/privacy') {
        return send(200, renderHtml(template, { ...base, ...tucker, canonicalPath: '/privacy', title: `Privacy Notice — ${BRAND.name}`, preload: platformPreloads(path), boot: boot(def) }));
      }
      if (path.startsWith('/savings/')) {
        const known = /^\/savings\/(assess|design|results\/[^/]+)$/.test(path);
        return send(
          known ? 200 : 404,
          renderHtml(template, {
            ...base,
            ...tucker,
            canonicalPath: path,
            // Private results and the internal style guide are never indexed.
            noindex: !known || path.startsWith('/savings/results') || path.startsWith('/savings/design'),
            preload: platformPreloads(path),
            boot: boot(def),
          }),
        );
      }
      // Regional internet pages (optional local campaigns), one per active location.
      if (path === '/admin' || path.startsWith('/admin/')) {
        return send(200, renderHtml(template, { ...base, ...tucker, canonicalPath: '/', noindex: true, title: `${BRAND.name} — Team`, boot: boot(def) }));
      }
      return send(404, renderHtml(template, { ...base, ...tucker, canonicalPath: '/', noindex: true, title: `Page not found — ${BRAND.name}`, boot: boot(def) }));
    });
  }

  // -------------------------------------------------------------- errors --
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError || err instanceof BookingError || err instanceof PlatformError) {
      res.status(err.status).json({ error: err.message, fields: err instanceof BookingError ? undefined : err.details });
      return;
    }
    const status = (err as { status?: number }).status;
    if (status && status >= 400 && status < 500) {
      res.status(status).json({ error: 'Bad request.' });
      return;
    }
    // Path only (never the query string: results tokens live there), no body or cookies.
    log('error', 'unhandled_error', { requestId: req.requestId, method: req.method, path: req.path, ...errorFields(err) });
    res.status(500).json({ error: 'Something went wrong. Please try again.', requestId: req.requestId });
  });

  return app;
}
