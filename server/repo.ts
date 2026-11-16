/**
 * Data access layer. All SQL lives here so the storage engine (SQLite today)
 * can be swapped for Postgres/Supabase later without touching routes.
 */
import { randomUUID } from 'node:crypto';
import type { Appointment, AreaStatus, Lead, LeadNote, LeadStatus } from '../shared/schemas';
import { marketSchema, type Market, type MarketSummary } from '../shared/market';
import { transaction, type DB } from './db';

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();

// ---------------------------------------------------------------- mapping --
function toLead(r: Row): Lead {
  return {
    id: r.id as string,
    firstName: r.first_name as string,
    lastName: r.last_name as string,
    email: r.email as string,
    phone: r.phone as string,
    street: r.street as string,
    unit: r.unit as string,
    city: r.city as string,
    zip: r.zip as string,
    preferredContact: r.preferred_contact as string,
    currentProvider: r.current_provider as string,
    status: r.status as LeadStatus,
    areaStatus: r.area_status as string,
    source: r.source as string,
    utmSource: r.utm_source as string,
    utmMedium: r.utm_medium as string,
    utmCampaign: r.utm_campaign as string,
    utmContent: (r.utm_content as string) ?? '',
    utmTerm: (r.utm_term as string) ?? '',
    clickId: (r.click_id as string) ?? '',
    referrer: (r.referrer as string) ?? '',
    landingPage: (r.landing_page as string) ?? '',
    marketId: (r.market_id as string) ?? '',
    duplicateOf: (r.duplicate_of as string) ?? null,
    assessmentId: (r.assessment_id as string) ?? null,
    consentAt: r.consent_at as string,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

function toAppointment(r: Row): Appointment {
  const a: Appointment = {
    id: r.id as string,
    leadId: r.lead_id as string,
    startUtc: r.start_utc as string,
    endUtc: r.end_utc as string,
    status: r.status as Appointment['status'],
    notes: r.notes as string,
    createdAt: r.created_at as string,
    marketId: (r.market_id as string) ?? '',
  };
  if (r.first_name !== undefined) {
    a.leadName = `${r.first_name} ${r.last_name}`;
    a.leadPhone = r.phone as string;
    a.leadAddress = [r.street, r.unit, r.city, r.zip].filter(Boolean).join(', ');
  }
  return a;
}

// ---------------------------------------------------------- service areas --
export interface ServiceArea {
  zip: string;
  city: string;
  status: AreaStatus;
  marketId: string;
  updatedAt: string;
}

const toArea = (r: Row): ServiceArea => ({
  zip: r.zip as string,
  city: r.city as string,
  status: r.status as AreaStatus,
  marketId: r.market_id as string,
  updatedAt: r.updated_at as string,
});

export function getServiceArea(db: DB, zip: string): ServiceArea | null {
  const r = db.prepare('SELECT * FROM service_areas WHERE zip = ?').get(zip) as Row | undefined;
  return r ? toArea(r) : null;
}

export function listServiceAreas(db: DB, marketId?: string): ServiceArea[] {
  const rows = marketId
    ? db.prepare('SELECT * FROM service_areas WHERE market_id = ? ORDER BY city, zip').all(marketId)
    : db.prepare('SELECT * FROM service_areas ORDER BY market_id, city, zip').all();
  return (rows as Row[]).map(toArea);
}

export function upsertServiceArea(db: DB, a: { zip: string; city: string; status: AreaStatus; marketId: string }) {
  db.prepare(
    `INSERT INTO service_areas (zip, city, status, market_id, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(zip) DO UPDATE SET city = excluded.city, status = excluded.status, market_id = excluded.market_id, updated_at = excluded.updated_at`,
  ).run(a.zip, a.city, a.status, a.marketId, now());
}

export function deleteServiceArea(db: DB, zip: string) {
  db.prepare('DELETE FROM service_areas WHERE zip = ?').run(zip);
}

// ----------------------------------------------------------------- markets --
function toMarket(r: Row): Market {
  // Re-validate on read so older rows pick up defaults for newly added fields.
  return marketSchema.parse({ ...JSON.parse(r.config as string), slug: r.slug, active: !!r.active, isDefault: !!r.is_default });
}

export function getMarket(db: DB, slug: string): Market | null {
  const r = db.prepare('SELECT * FROM markets WHERE slug = ?').get(slug) as Row | undefined;
  return r ? toMarket(r) : null;
}

export function getDefaultMarket(db: DB): Market {
  const r = (db.prepare('SELECT * FROM markets WHERE is_default = 1 LIMIT 1').get() ??
    db.prepare('SELECT * FROM markets ORDER BY created_at LIMIT 1').get()) as Row | undefined;
  if (!r) throw new Error('No markets configured');
  return toMarket(r);
}

export function listMarkets(db: DB, opts: { activeOnly?: boolean } = {}): Market[] {
  const sql = `SELECT * FROM markets ${opts.activeOnly ? 'WHERE active = 1' : ''} ORDER BY is_default DESC, name`;
  return (db.prepare(sql).all() as Row[]).map(toMarket);
}

export function marketSummaries(db: DB): MarketSummary[] {
  return (db.prepare('SELECT slug, name, state FROM markets WHERE active = 1 ORDER BY is_default DESC, name').all() as Row[]).map((r) => ({
    slug: r.slug as string,
    name: r.name as string,
    state: r.state as string,
  }));
}

/** Insert or update a market. Exactly one market is always the default. */
export function saveMarket(db: DB, m: Market): Market {
  return transaction(db, () => {
    const ts = now();
    if (m.isDefault) db.prepare('UPDATE markets SET is_default = 0 WHERE slug <> ?').run(m.slug);
    db.prepare(
      `INSERT INTO markets (slug, name, state, config, active, is_default, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(slug) DO UPDATE SET name = excluded.name, state = excluded.state, config = excluded.config,
         active = excluded.active, is_default = excluded.is_default, updated_at = excluded.updated_at`,
    ).run(m.slug, m.name, m.state, JSON.stringify(m), m.active ? 1 : 0, m.isDefault ? 1 : 0, ts, ts);
    const { d } = db.prepare('SELECT COUNT(*) AS d FROM markets WHERE is_default = 1').get() as { d: number };
    if (d === 0) throw new Error('At least one location must be the default.');
    const def = db.prepare('SELECT active FROM markets WHERE is_default = 1').get() as { active: number };
    if (!def.active) throw new Error('The default location must be active.');
    return getMarket(db, m.slug)!;
  });
}

// ---------------------------------------------------------------- settings --
export function getSettings(db: DB): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// ------------------------------------------------------------------- leads --
export interface NewLead {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  street: string;
  unit: string;
  city: string;
  zip: string;
  preferredContact: string;
  currentProvider: string;
  areaStatus: string;
  source: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  utmTerm: string;
  clickId: string;
  referrer: string;
  landingPage: string;
  sessionId: string;
  marketId: string;
  bookingTokenHash: string;
  consentText: string;
  consentIp: string;
  consentUserAgent: string;
}

/**
 * Record a lead submission. Every submission gets its own lead row, booking
 * token and consent record. When the same email + phone already has an open
 * lead, the new one is linked to it (`duplicate_of`) and a note is added to the
 * original — the original's data, consent and appointment are never modified.
 */
export function createLead(db: DB, l: NewLead): { lead: Lead; duplicate: boolean } {
  return transaction(db, () => {
    const ts = now();
    const existing = db
      .prepare("SELECT id FROM leads WHERE email = ? AND phone = ? AND status <> 'lost' AND duplicate_of IS NULL ORDER BY created_at LIMIT 1")
      .get(l.email, l.phone) as { id: string } | undefined;

    const id = randomUUID();
    db.prepare(
      `INSERT INTO leads (id, first_name, last_name, email, phone, street, unit, city, zip, preferred_contact,
         current_provider, status, area_status, source, utm_source, utm_medium, utm_campaign, booking_token_hash,
         consent_text, consent_at, consent_ip, consent_user_agent, created_at, updated_at,
         utm_content, utm_term, click_id, referrer, landing_page, session_id, market_id, duplicate_of)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, l.firstName, l.lastName, l.email, l.phone, l.street, l.unit, l.city, l.zip, l.preferredContact,
      l.currentProvider, l.areaStatus, l.source, l.utmSource, l.utmMedium, l.utmCampaign, l.bookingTokenHash,
      l.consentText, ts, l.consentIp, l.consentUserAgent, ts, ts,
      l.utmContent, l.utmTerm, l.clickId, l.referrer, l.landingPage, l.sessionId, l.marketId, existing?.id ?? null,
    );
    db.prepare('INSERT INTO consents (id, lead_id, consent_text, ip, user_agent, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      randomUUID(), id, l.consentText, l.consentIp, l.consentUserAgent, 'lead_form', ts,
    );
    if (existing) {
      addNote(db, existing.id, `Submitted the form again (new lead ${id}). This record was not changed.`, 'system');
      addNote(db, id, `Repeat submission — same email and phone as lead ${existing.id}.`, 'system');
    }
    return { lead: getLead(db, id)!, duplicate: !!existing };
  });
}

export interface ConsentRecord {
  id: string;
  consentText: string;
  ip: string;
  userAgent: string;
  source: string;
  createdAt: string;
}

export function listConsents(db: DB, leadId: string): ConsentRecord[] {
  return (db.prepare('SELECT * FROM consents WHERE lead_id = ? ORDER BY created_at').all(leadId) as Row[]).map((r) => ({
    id: r.id as string,
    consentText: r.consent_text as string,
    ip: r.ip as string,
    userAgent: r.user_agent as string,
    source: r.source as string,
    createdAt: r.created_at as string,
  }));
}

export function getLead(db: DB, id: string): Lead | null {
  const r = db.prepare('SELECT * FROM leads WHERE id = ?').get(id) as Row | undefined;
  return r ? toLead(r) : null;
}

export function getLeadTokenHash(db: DB, id: string): string | null {
  const r = db.prepare('SELECT booking_token_hash FROM leads WHERE id = ?').get(id) as Row | undefined;
  return r ? (r.booking_token_hash as string) : null;
}

export function leadStatsByMarket(db: DB): Record<string, number> {
  const rows = db.prepare('SELECT market_id, COUNT(*) AS n FROM leads GROUP BY market_id').all() as { market_id: string; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.market_id, r.n]));
}

export interface LeadFilter {
  status?: string;
  market?: string;
  q?: string;
  limit?: number;
  offset?: number;
  /** Upper bound for `limit` (admin list: 200; CSV export: larger). */
  maxLimit?: number;
}

export function listLeads(db: DB, f: LeadFilter = {}): { leads: Lead[]; total: number } {
  const where: string[] = [];
  const params: string[] = [];
  if (f.status) {
    where.push('status = ?');
    params.push(f.status);
  }
  if (f.market) {
    where.push('market_id = ?');
    params.push(f.market);
  }
  if (f.q) {
    where.push("(first_name || ' ' || last_name LIKE ? OR email LIKE ? OR phone LIKE ? OR street LIKE ? OR zip = ?)");
    const like = `%${f.q.replace(/[%_]/g, '')}%`;
    params.push(like, like, like, like, f.q);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM leads ${clause}`).get(...params) as { n: number };
  const rows = db
    .prepare(`SELECT * FROM leads ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, Math.min(f.limit ?? 50, f.maxLimit ?? 200), f.offset ?? 0) as Row[];
  return { leads: rows.map(toLead), total: n };
}

export function updateLeadStatus(db: DB, id: string, status: LeadStatus, author: string) {
  const lead = getLead(db, id);
  if (!lead || lead.status === status) return;
  db.prepare('UPDATE leads SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id);
  addNote(db, id, `Status changed: ${lead.status} → ${status}`, author);
}

export function addNote(db: DB, leadId: string, body: string, author: string): LeadNote {
  const note = { id: randomUUID(), leadId, body, author, createdAt: now() };
  db.prepare('INSERT INTO lead_notes (id, lead_id, body, author, created_at) VALUES (?, ?, ?, ?, ?)').run(
    note.id, leadId, body, author, note.createdAt,
  );
  return note;
}

export function listNotes(db: DB, leadId: string): LeadNote[] {
  return (db.prepare('SELECT * FROM lead_notes WHERE lead_id = ? ORDER BY created_at DESC').all(leadId) as Row[]).map(
    (r) => ({
      id: r.id as string,
      leadId: r.lead_id as string,
      body: r.body as string,
      author: r.author as string,
      createdAt: r.created_at as string,
    }),
  );
}

export function leadStats(db: DB) {
  const byStatus = db.prepare('SELECT status, COUNT(*) AS n FROM leads GROUP BY status').all() as {
    status: string;
    n: number;
  }[];
  const { today } = db
    .prepare("SELECT COUNT(*) AS today FROM leads WHERE created_at >= strftime('%Y-%m-%dT00:00:00Z','now','-1 day')")
    .get() as { today: number };
  const { upcoming } = db
    .prepare("SELECT COUNT(*) AS upcoming FROM appointments WHERE status = 'scheduled' AND start_utc >= ?")
    .get(now()) as { upcoming: number };
  return { byStatus: Object.fromEntries(byStatus.map((r) => [r.status, r.n])), last24h: today, upcomingAppointments: upcoming };
}

// ------------------------------------------------------------ appointments --
const APPT_JOIN = `SELECT a.*, l.first_name, l.last_name, l.phone, l.street, l.unit, l.city, l.zip
  FROM appointments a JOIN leads l ON l.id = a.lead_id`;

export function countBookedAt(db: DB, marketId: string, startUtc: string): number {
  const { n } = db
    .prepare("SELECT COUNT(*) AS n FROM appointments WHERE market_id = ? AND start_utc = ? AND status = 'scheduled'")
    .get(marketId, startUtc) as { n: number };
  return n;
}

export function bookedCountsBetween(db: DB, marketId: string, fromUtc: string, toUtc: string): Map<string, number> {
  const rows = db
    .prepare(
      "SELECT start_utc, COUNT(*) AS n FROM appointments WHERE market_id = ? AND status = 'scheduled' AND start_utc >= ? AND start_utc < ? GROUP BY start_utc",
    )
    .all(marketId, fromUtc, toUtc) as { start_utc: string; n: number }[];
  return new Map(rows.map((r) => [r.start_utc, r.n]));
}

export function getActiveAppointmentForLead(db: DB, leadId: string): Appointment | null {
  const r = db
    .prepare("SELECT * FROM appointments WHERE lead_id = ? AND status = 'scheduled' ORDER BY start_utc LIMIT 1")
    .get(leadId) as Row | undefined;
  return r ? toAppointment(r) : null;
}

export function insertAppointment(
  db: DB,
  a: { leadId: string; marketId: string; startUtc: string; endUtc: string; notes: string },
): Appointment {
  const ts = now();
  const id = randomUUID();
  db.prepare(
    "INSERT INTO appointments (id, lead_id, market_id, start_utc, end_utc, status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'scheduled', ?, ?, ?)",
  ).run(id, a.leadId, a.marketId, a.startUtc, a.endUtc, a.notes, ts, ts);
  return toAppointment(db.prepare('SELECT * FROM appointments WHERE id = ?').get(id) as Row);
}

export function getAppointment(db: DB, id: string): Appointment | null {
  const r = db.prepare('SELECT * FROM appointments WHERE id = ?').get(id) as Row | undefined;
  return r ? toAppointment(r) : null;
}

export function setAppointmentStatus(db: DB, id: string, status: Appointment['status']): Appointment | null {
  db.prepare('UPDATE appointments SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id);
  const r = db.prepare(`${APPT_JOIN} WHERE a.id = ?`).get(id) as Row | undefined;
  return r ? toAppointment(r) : null;
}

export function listAppointments(db: DB, f: { fromUtc?: string; leadId?: string; market?: string } = {}): Appointment[] {
  if (f.leadId) {
    return (db.prepare(`${APPT_JOIN} WHERE a.lead_id = ? ORDER BY a.start_utc DESC`).all(f.leadId) as Row[]).map(toAppointment);
  }
  const rows = f.market
    ? db.prepare(`${APPT_JOIN} WHERE a.start_utc >= ? AND a.market_id = ? ORDER BY a.start_utc LIMIT 500`).all(f.fromUtc ?? '', f.market)
    : db.prepare(`${APPT_JOIN} WHERE a.start_utc >= ? ORDER BY a.start_utc LIMIT 500`).all(f.fromUtc ?? '');
  return (rows as Row[]).map(toAppointment);
}

// ------------------------------------------------------------------ events --
export function insertEvent(
  db: DB,
  e: { name: string; sessionId: string; path: string; props: Record<string, unknown>; utmSource: string; utmCampaign: string; marketId?: string },
) {
  db.prepare(
    'INSERT INTO events (name, session_id, path, props, utm_source, utm_campaign, market_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(e.name, e.sessionId, e.path, JSON.stringify(e.props), e.utmSource, e.utmCampaign, e.marketId ?? '', now());
}

/**
 * Keep the anonymous events table bounded: drop events older than `maxAgeDays`
 * and, as a backstop, all but the newest `maxRows`. Returns rows deleted.
 */
export function pruneEvents(db: DB, maxAgeDays = 400, maxRows = 500_000): number {
  const cutoff = new Date(Date.now() - maxAgeDays * 86_400_000).toISOString();
  const byAge = db.prepare('DELETE FROM events WHERE created_at < ?').run(cutoff).changes;
  const byCount = db
    .prepare('DELETE FROM events WHERE id <= (SELECT id FROM events ORDER BY id DESC LIMIT 1 OFFSET ?)')
    .run(maxRows).changes;
  return Number(byAge) + Number(byCount);
}

/** Funnel + attribution summary for the admin dashboard. */
export function conversionStats(db: DB, days = 30, market?: string) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const mf = market ? ' AND market_id = ?' : '';
  const args = market ? [since, market] : [since];
  const funnel = db
    .prepare(
      `SELECT name, COUNT(*) AS events, COUNT(DISTINCT NULLIF(session_id, '')) AS sessions
       FROM events WHERE created_at >= ?${mf} GROUP BY name`,
    )
    .all(...args) as { name: string; events: number; sessions: number }[];
  const sources = db
    .prepare(
      `SELECT COALESCE(NULLIF(utm_source, ''), source) AS source, COUNT(*) AS leads,
              SUM(CASE WHEN status IN ('appointment_set','sold','install_scheduled','installed') THEN 1 ELSE 0 END) AS qualified
       FROM leads WHERE created_at >= ?${mf} GROUP BY 1 ORDER BY leads DESC LIMIT 10`,
    )
    .all(...args) as { source: string; leads: number; qualified: number }[];
  return { days, funnel: Object.fromEntries(funnel.map((f) => [f.name, f])), sources };
}

// ------------------------------------------------------------- assessments --
export interface AssessmentRow {
  id: string;
  zip: string;
  marketId: string;
  categories: string[];
  answers: unknown;
  analysis: unknown;
  analysisVersion: string;
  assumptionsVersion: string;
  includeSamples: boolean;
  status: 'complete' | 'incomplete';
  currentMonthlyCents: number | null;
  potentialSavingsCents: number;
  projectionBasis: string;
  leadId: string | null;
  utmSource: string;
  utmCampaign: string;
  createdAt: string;
}

const toAssessment = (r: Row): AssessmentRow => ({
  id: r.id as string,
  zip: r.zip as string,
  marketId: r.market_id as string,
  categories: JSON.parse(r.categories as string),
  answers: JSON.parse(r.answers as string),
  analysis: JSON.parse(r.analysis as string),
  analysisVersion: r.analysis_version as string,
  assumptionsVersion: r.assumptions_version as string,
  includeSamples: !!r.include_samples,
  status: r.status as AssessmentRow['status'],
  currentMonthlyCents: (r.current_monthly_cents as number) ?? null,
  potentialSavingsCents: r.potential_savings_cents as number,
  projectionBasis: r.projection_basis as string,
  leadId: (r.lead_id as string) ?? null,
  utmSource: r.utm_source as string,
  utmCampaign: r.utm_campaign as string,
  createdAt: r.created_at as string,
});

export function insertAssessment(
  db: DB,
  a: {
    tokenHash: string;
    zip: string;
    marketId: string;
    categories: string[];
    answers: unknown;
    analysis: unknown;
    analysisVersion: string;
    assumptionsVersion: string;
    includeSamples: boolean;
    status: 'complete' | 'incomplete';
    currentMonthlyCents: number | null;
    potentialSavingsCents: number;
    projectionBasis: string;
    sessionId: string;
    utmSource: string;
    utmCampaign: string;
    landingPage: string;
    referrer: string;
  },
): string {
  const id = randomUUID();
  const ts = now();
  db.prepare(
    `INSERT INTO assessments (id, token_hash, zip, market_id, categories, answers, analysis, analysis_version, assumptions_version,
       include_samples, status, current_monthly_cents, potential_savings_cents, projection_basis, session_id, utm_source, utm_campaign,
       landing_page, referrer, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id, a.tokenHash, a.zip, a.marketId, JSON.stringify(a.categories), JSON.stringify(a.answers), JSON.stringify(a.analysis),
    a.analysisVersion, a.assumptionsVersion, a.includeSamples ? 1 : 0, a.status, a.currentMonthlyCents, a.potentialSavingsCents,
    a.projectionBasis, a.sessionId, a.utmSource, a.utmCampaign, a.landingPage, a.referrer, ts, ts,
  );
  return id;
}

export function getAssessment(db: DB, id: string): AssessmentRow | null {
  const r = db.prepare('SELECT * FROM assessments WHERE id = ?').get(id) as Row | undefined;
  return r ? toAssessment(r) : null;
}

export function getAssessmentTokenHash(db: DB, id: string): string | null {
  const r = db.prepare('SELECT token_hash FROM assessments WHERE id = ?').get(id) as Row | undefined;
  return r ? (r.token_hash as string) : null;
}

export function linkAssessmentLead(db: DB, assessmentId: string, leadId: string) {
  transaction(db, () => {
    db.prepare('UPDATE assessments SET lead_id = ?, updated_at = ? WHERE id = ?').run(leadId, now(), assessmentId);
    db.prepare('UPDATE leads SET assessment_id = ?, updated_at = ? WHERE id = ?').run(assessmentId, now(), leadId);
  });
}

export function listAssessments(db: DB, f: { limit?: number; offset?: number } = {}): { assessments: Omit<AssessmentRow, 'answers' | 'analysis'>[]; total: number } {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM assessments').get() as { n: number };
  const rows = db.prepare('SELECT * FROM assessments ORDER BY created_at DESC LIMIT ? OFFSET ?').all(Math.min(f.limit ?? 50, 200), f.offset ?? 0) as Row[];
  return {
    total: n,
    assessments: rows.map((r) => {
      const { answers: _a, analysis: _b, ...rest } = toAssessment(r);
      return rest;
    }),
  };
}

export function assessmentStats(db: DB, days = 30) {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const row = db
    .prepare(
      `SELECT COUNT(*) AS completed, SUM(CASE WHEN lead_id IS NOT NULL THEN 1 ELSE 0 END) AS withLead,
              SUM(CASE WHEN potential_savings_cents > 0 THEN 1 ELSE 0 END) AS withOpportunity
       FROM assessments WHERE created_at >= ?`,
    )
    .get(since) as { completed: number; withLead: number | null; withOpportunity: number | null };
  return { days, completed: row.completed, withLead: row.withLead ?? 0, withOpportunity: row.withOpportunity ?? 0 };
}
