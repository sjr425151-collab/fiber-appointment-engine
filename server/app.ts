import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  appointmentUpdateSchema,
  availabilityQuerySchema,
  bookingInputSchema,
  leadInputSchema,
  leadUpdateSchema,
  LEAD_STATUSES,
  loginSchema,
  serviceAreaSchema,
  slotsQuerySchema,
  type AvailabilityResult,
} from '../shared/schemas';
import { CONSENT_TEXT, CONSENT_VERSION } from '../shared/content';
import type { AppConfig } from './config';
import type { DB } from './db';
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
import { availableSlots, bookableDates, bookAppointment, BookingError, rulesFromSettings } from './scheduling';

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

export function describeAvailability(zip: string, area: repo.ServiceArea | null): AvailabilityResult {
  const city = area?.city ?? null;
  switch (area?.status) {
    case 'available':
      return { zip, city, status: 'available', headline: `Omni Fiber is available in ${city}!`,
        message: 'Your area is being served. Reserve a free consultation to confirm your address and lock in your install.' };
    case 'verify':
      return { zip, city, status: 'verify', headline: `${city} is in the Omni Fiber build area`,
        message: 'Fiber is rolling out across your ZIP code. Book a quick consultation and we’ll confirm service at your exact address.' };
    case 'coming_soon':
      return { zip, city, status: 'coming_soon', headline: `Fiber is coming to ${city}`,
        message: 'Your area is on the expansion map. Join the priority list and we’ll reach out the moment your street opens.' };
    case 'not_serviceable':
      return { zip, city, status: 'not_serviceable', headline: 'Not in the service area yet',
        message: 'We aren’t able to serve this ZIP code right now. Leave your info and we’ll let you know if that changes.' };
    default:
      return { zip, city: null, status: 'unknown', headline: 'We’re checking your area',
        message: 'This ZIP isn’t on our launch map yet. Leave your details and a local specialist will check your address.' };
  }
}

export function createApp(config: AppConfig, db: DB) {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          imgSrc: ["'self'", 'data:'],
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          fontSrc: ["'self'", 'https://fonts.gstatic.com'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );
  app.use(express.json({ limit: '20kb' }));

  const isTest = process.env.NODE_ENV === 'test';
  const limiter = (limit: number, windowMinutes: number) =>
    rateLimit({ windowMs: windowMinutes * 60000, limit, standardHeaders: 'draft-8', legacyHeaders: false, skip: () => isTest });

  const api = express.Router();
  api.use(limiter(300, 15));

  // ------------------------------------------------------------- public --
  api.get('/health', (_req, res) => res.json({ ok: true }));

  api.get('/availability', (req, res) => {
    const { zip } = parse(availabilityQuerySchema, req.query);
    res.json(describeAvailability(zip, repo.getServiceArea(db, zip)));
  });

  api.post('/leads', limiter(10, 15), (req, res) => {
    const input = parse(leadInputSchema, req.body);
    if (input.website) {
      // Honeypot tripped: pretend success so bots learn nothing.
      res.status(201).json({ leadId: crypto.randomUUID(), bookingToken: newToken(), availability: describeAvailability(input.zip, null) });
      return;
    }
    const area = repo.getServiceArea(db, input.zip);
    const bookingToken = newToken();
    const { lead } = repo.createOrRefreshLead(db, {
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
      bookingTokenHash: sha256(bookingToken),
      consentText: `[${CONSENT_VERSION}] ${CONSENT_TEXT}`,
      consentIp: req.ip ?? '',
      consentUserAgent: String(req.headers['user-agent'] ?? '').slice(0, 300),
    });
    res.status(201).json({ leadId: lead.id, bookingToken, availability: describeAvailability(input.zip, area) });
  });

  api.get('/schedule/dates', (_req, res) => {
    const rules = rulesFromSettings(repo.getSettings(db));
    res.json({ timezone: config.timezone, dates: bookableDates(rules, config.timezone) });
  });

  api.get('/schedule/slots', (req, res) => {
    const { date } = parse(slotsQuerySchema, req.query);
    res.json({ date, timezone: config.timezone, slots: availableSlots(db, date, config.timezone) });
  });

  api.post('/appointments', limiter(20, 15), (req, res) => {
    const input = parse(bookingInputSchema, req.body);
    const appt = bookAppointment(db, input, config.timezone);
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

  api.post('/admin/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE, cookieOpts);
    res.json({ ok: true });
  });

  const admin = express.Router();
  admin.use((req, _res, next) => {
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

  admin.get('/me', (req, res) => res.json({ email: req.session!.email }));

  admin.get('/stats', (_req, res) => res.json(repo.leadStats(db)));

  admin.get('/leads', (req, res) => {
    const q = parse(
      z.object({
        status: z.enum(LEAD_STATUSES).optional(),
        q: z.string().trim().max(100).optional(),
        limit: z.coerce.number().int().min(1).max(200).optional(),
        offset: z.coerce.number().int().min(0).optional(),
      }),
      req.query,
    );
    res.json(repo.listLeads(db, q));
  });

  admin.get('/leads.csv', (_req, res) => {
    const { leads } = repo.listLeads(db, { limit: 200 });
    const cols = ['createdAt', 'firstName', 'lastName', 'phone', 'email', 'street', 'unit', 'city', 'zip', 'status', 'areaStatus', 'source', 'utmCampaign'] as const;
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
    res.json({ lead, notes: repo.listNotes(db, lead.id), appointments: repo.listAppointments(db, { leadId: lead.id }) });
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
    const { from } = parse(z.object({ from: z.string().datetime().optional() }), req.query);
    const fromUtc = from ?? new Date(Date.now() - 7 * 86400000).toISOString();
    res.json({ timezone: config.timezone, appointments: repo.listAppointments(db, { fromUtc }) });
  });

  admin.patch('/appointments/:id', (req, res) => {
    const { status } = parse(appointmentUpdateSchema, req.body);
    const appt = repo.setAppointmentStatus(db, String(req.params.id), status);
    if (!appt) throw new HttpError(404, 'Appointment not found.');
    repo.addNote(db, appt.leadId, `Appointment ${appt.startUtc} marked ${status}`, req.session!.email);
    res.json({ appointment: appt });
  });

  admin.get('/service-areas', (_req, res) => res.json({ areas: repo.listServiceAreas(db) }));

  admin.put('/service-areas', (req, res) => {
    repo.upsertServiceArea(db, parse(serviceAreaSchema, req.body));
    res.json({ areas: repo.listServiceAreas(db) });
  });

  api.use('/admin', admin);
  api.use((_req, _res, next) => next(new HttpError(404, 'Not found.')));
  app.use('/api', api);

  // ----------------------------------------------- static (production) --
  const dist = resolve('dist');
  if (config.isProduction && existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(resolve(dist, 'index.html')));
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
