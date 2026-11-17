/**
 * Data access layer. All SQL lives here so the storage engine (SQLite today)
 * can be swapped for Postgres/Supabase later without touching routes.
 */
import { randomUUID } from 'node:crypto';
import { OPPORTUNITY_STATUSES, OPPORTUNITY_STATUS_LABEL, type OpportunityDraft, type OpportunityKind, type OpportunityStatus } from '../shared/platform/opportunity';
import { OPPORTUNITY_STAGE_LABEL, STAGE_TO_STATUS, type OpportunityStage } from '../shared/team/pipeline';
import { CLOSED_LEAD_STATUSES, OPEN_LEAD_STATUSES, type Appointment, type AreaStatus, type Lead, type LeadNote, type LeadStatus, type Representative } from '../shared/schemas';
import { marketSchema, type Market, type MarketSummary } from '../shared/market';
import { transaction, type DB } from './db';

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();

const parseJson = (v: unknown): unknown => {
  if (typeof v !== 'string' || v === '') return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
};
const marks = (n: number) => Array.from({ length: n }, () => '?').join(',');

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
    assignedRepId: (r.assigned_rep_id as string) ?? null,
    assignedAt: (r.assigned_at as string) ?? null,
    routingOutcome: (r.routing_outcome as string) ?? '',
    routingReason: (r.routing_reason as string) ?? '',
    preview: parseJson(r.preview),
    bestTime: (r.best_time as string) ?? '',
    marketingConsent: !!r.marketing_consent,
    firstContactAt: (r.first_contact_at as string) ?? null,
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
  /** What the customer was shown when they asked for help (stored as JSON). */
  preview?: unknown;
  bestTime?: string;
  /** Wording of the optional marketing permission, when the customer ticked it. */
  marketingConsentText?: string;
  /** One lead per submitted form: a retry with the same key returns the first lead. */
  requestKey?: string | null;
}

/**
 * Record a lead submission. Every submission gets its own lead row, booking
 * token and consent record. When the same phone (and the same email, when both
 * gave one) already has an open lead, the new one is linked to it
 * (`duplicate_of`) and a note is added to the original — the original's data,
 * consent and appointment are never modified. A retry of the very same form
 * (`requestKey`) returns the lead it already created.
 */
export function createLead(db: DB, l: NewLead): { lead: Lead; duplicate: boolean; retried: boolean; existingId: string | null } {
  return transaction(db, () => {
    const ts = now();
    if (l.requestKey) {
      const same = db.prepare('SELECT id, duplicate_of FROM leads WHERE request_key = ?').get(l.requestKey) as { id: string; duplicate_of: string | null } | undefined;
      if (same) return { lead: getLead(db, same.id)!, duplicate: !!same.duplicate_of, retried: true, existingId: same.duplicate_of };
    }
    const existing = db
      .prepare(
        `SELECT id FROM leads WHERE phone = ? AND (email = ? OR email = '' OR ? = '')
           AND status NOT IN (${marks(CLOSED_LEAD_STATUSES.length)}) AND duplicate_of IS NULL ORDER BY created_at LIMIT 1`,
      )
      .get(l.phone, l.email, l.email, ...CLOSED_LEAD_STATUSES) as { id: string } | undefined;

    const id = randomUUID();
    db.prepare(
      `INSERT INTO leads (id, first_name, last_name, email, phone, street, unit, city, zip, preferred_contact,
         current_provider, status, area_status, source, utm_source, utm_medium, utm_campaign, booking_token_hash,
         consent_text, consent_at, consent_ip, consent_user_agent, created_at, updated_at,
         utm_content, utm_term, click_id, referrer, landing_page, session_id, market_id, duplicate_of,
         preview, best_time, marketing_consent, request_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, l.firstName, l.lastName, l.email, l.phone, l.street, l.unit, l.city, l.zip, l.preferredContact,
      l.currentProvider, l.areaStatus, l.source, l.utmSource, l.utmMedium, l.utmCampaign, l.bookingTokenHash,
      l.consentText, ts, l.consentIp, l.consentUserAgent, ts, ts,
      l.utmContent, l.utmTerm, l.clickId, l.referrer, l.landingPage, l.sessionId, l.marketId, existing?.id ?? null,
      l.preview === undefined ? '' : JSON.stringify(l.preview), l.bestTime ?? '', l.marketingConsentText ? 1 : 0, l.requestKey ?? null,
    );
    db.prepare('INSERT INTO consents (id, lead_id, consent_text, ip, user_agent, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
      randomUUID(), id, l.consentText, l.consentIp, l.consentUserAgent, 'lead_form', ts,
    );
    if (l.marketingConsentText) {
      db.prepare('INSERT INTO consents (id, lead_id, consent_text, ip, user_agent, source, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        randomUUID(), id, l.marketingConsentText, l.consentIp, l.consentUserAgent, 'marketing_optin', ts,
      );
    }
    if (existing) {
      addNote(db, existing.id, `Submitted the form again (new lead ${id}). This record was not changed.`, 'system');
      addNote(db, id, `Repeat submission — same contact details as lead ${existing.id}.`, 'system');
    }
    return { lead: getLead(db, id)!, duplicate: !!existing, retried: false, existingId: existing?.id ?? null };
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
  /** Only leads assigned to this representative. */
  rep?: string;
  /** Only open leads nobody is assigned to (the follow-up queue). */
  unassigned?: boolean;
  /** Team scope: leads assigned to any of these people, plus the unassigned queue. */
  scopeReps?: string[];
  source?: string;
  /** Leads with nothing recorded since this instant (stale). */
  untouchedSince?: string;
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
  if (f.rep) {
    where.push('assigned_rep_id = ?');
    params.push(f.rep);
  }
  if (f.scopeReps) {
    where.push(`(assigned_rep_id IS NULL OR assigned_rep_id IN (${marks(f.scopeReps.length) || "''"}))`);
    params.push(...f.scopeReps);
  }
  if (f.source) {
    where.push('source = ?');
    params.push(f.source);
  }
  if (f.untouchedSince) {
    where.push(`updated_at < ? AND status IN (${marks(OPEN_LEAD_STATUSES.length)})`);
    params.push(f.untouchedSince, ...OPEN_LEAD_STATUSES);
  }
  if (f.unassigned) {
    where.push(`assigned_rep_id IS NULL AND status IN (${marks(OPEN_LEAD_STATUSES.length)})`);
    params.push(...OPEN_LEAD_STATUSES);
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
  const ts = now();
  db.prepare('UPDATE leads SET status = ?, updated_at = ? WHERE id = ?').run(status, ts, id);
  // The first confirmed conversation is kept, for "time to first contact".
  if (status === 'contacted' && !lead.firstContactAt) db.prepare('UPDATE leads SET first_contact_at = ? WHERE id = ?').run(ts, id);
  addHistory(db, id, 'status', lead.status, status, '', author);
  addNote(db, id, `Status changed: ${lead.status} → ${status}`, author);
}

export interface LeadHistoryRow {
  id: string;
  kind: 'status' | 'assignment';
  from: string;
  to: string;
  detail: string;
  actor: string;
  createdAt: string;
}

function addHistory(db: DB, leadId: string, kind: LeadHistoryRow['kind'], from: string, to: string, detail: string, actor: string) {
  db.prepare('INSERT INTO lead_history (id, lead_id, kind, from_value, to_value, detail, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    randomUUID(), leadId, kind, from, to, detail, actor, now(),
  );
}

export function listLeadHistory(db: DB, leadId: string): LeadHistoryRow[] {
  return (db.prepare('SELECT * FROM lead_history WHERE lead_id = ? ORDER BY created_at, rowid').all(leadId) as Row[]).map((r) => ({
    id: r.id as string,
    kind: r.kind as LeadHistoryRow['kind'],
    from: r.from_value as string,
    to: r.to_value as string,
    detail: r.detail as string,
    actor: r.actor as string,
    createdAt: r.created_at as string,
  }));
}

// --------------------------------------------------------- representatives --
const REP_SELECT = `SELECT r.*,
    (SELECT COUNT(*) FROM leads l WHERE l.assigned_rep_id = r.id AND l.status IN (${marks(OPEN_LEAD_STATUSES.length)})) AS open_leads,
    (SELECT MAX(l.assigned_at) FROM leads l WHERE l.assigned_rep_id = r.id) AS last_assigned_at
  FROM representatives r`;

const toRep = (r: Row): Representative => ({
  id: r.id as string,
  name: r.name as string,
  email: r.email as string,
  phone: r.phone as string,
  active: !!r.active,
  accepting: !!r.accepting,
  markets: (parseJson(r.markets) as string[] | null) ?? ['*'],
  categories: (parseJson(r.categories) as Representative['categories'] | null) ?? [],
  maxOpenLeads: r.max_open_leads as number,
  canSignIn: (r.password_hash as string) !== '',
  role: ((r.role as string) ?? 'rep') as Representative['role'],
  status: ((r.status as string) ?? 'active') as Representative['status'],
  teamId: (r.team_id as string) ?? null,
  repCode: (r.rep_code as string) ?? '',
  mfaEnabled: !!r.mfa_enabled,
  lastLoginAt: (r.last_login_at as string) ?? null,
  openLeads: (r.open_leads as number) ?? 0,
  lastAssignedAt: (r.last_assigned_at as string) ?? null,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

export function listReps(db: DB): Representative[] {
  return (db.prepare(`${REP_SELECT} ORDER BY r.name, r.id`).all(...OPEN_LEAD_STATUSES) as Row[]).map(toRep);
}

export function getRep(db: DB, id: string): Representative | null {
  const r = db.prepare(`${REP_SELECT} WHERE r.id = ?`).get(...OPEN_LEAD_STATUSES, id) as Row | undefined;
  return r ? toRep(r) : null;
}

/** For sign-in only: the stored password hash is never returned anywhere else. */
export function getRepCredentials(db: DB, email: string): { id: string; passwordHash: string; active: boolean } | null {
  const r = db.prepare('SELECT id, password_hash, active FROM representatives WHERE email = ?').get(email) as Row | undefined;
  return r ? { id: r.id as string, passwordHash: r.password_hash as string, active: !!r.active } : null;
}

export interface RepInput {
  name: string;
  email: string;
  phone: string;
  active: boolean;
  accepting: boolean;
  markets: string[];
  categories: string[];
  maxOpenLeads: number;
  /** Already hashed; undefined keeps the current one. */
  passwordHash?: string;
}

export function createRep(db: DB, i: RepInput): Representative {
  const id = randomUUID();
  const ts = now();
  const { n } = db.prepare('SELECT COALESCE(MAX(CAST(SUBSTR(rep_code, 3) AS INTEGER)), 1000) AS n FROM representatives').get() as { n: number };
  db.prepare(
    `INSERT INTO representatives (id, name, email, phone, password_hash, active, accepting, markets, categories, max_open_leads, created_at, updated_at, status, rep_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, i.name, i.email, i.phone, i.passwordHash ?? '', i.active ? 1 : 0, i.accepting ? 1 : 0, JSON.stringify(i.markets), JSON.stringify(i.categories), i.maxOpenLeads, ts, ts, i.active ? 'active' : 'deactivated', `R-${n + 1}`);
  return getRep(db, id)!;
}

export function updateRep(db: DB, id: string, i: RepInput): Representative | null {
  if (!getRep(db, id)) return null;
  db.prepare(
    `UPDATE representatives SET name = ?, email = ?, phone = ?, active = ?, accepting = ?, markets = ?, categories = ?, max_open_leads = ?, updated_at = ? WHERE id = ?`,
  ).run(i.name, i.email, i.phone, i.active ? 1 : 0, i.accepting ? 1 : 0, JSON.stringify(i.markets), JSON.stringify(i.categories), i.maxOpenLeads, now(), id);
  // Keep the newer status column in step, and end sessions when someone is switched off.
  db.prepare("UPDATE representatives SET status = CASE WHEN ? = 1 THEN (CASE WHEN status = 'invited' THEN 'invited' ELSE 'active' END) ELSE 'deactivated' END, session_epoch = session_epoch + CASE WHEN ? = 1 THEN 0 ELSE 1 END WHERE id = ?").run(i.active ? 1 : 0, i.active ? 1 : 0, id);
  if (i.passwordHash !== undefined) db.prepare('UPDATE representatives SET password_hash = ? WHERE id = ?').run(i.passwordHash, id);
  return getRep(db, id);
}

/** A representative switching their own "accepting new leads" on or off. */
export function setRepAccepting(db: DB, id: string, accepting: boolean): Representative | null {
  db.prepare('UPDATE representatives SET accepting = ?, updated_at = ? WHERE id = ?').run(accepting ? 1 : 0, now(), id);
  return getRep(db, id);
}

/** Who already owns an open lead for this phone number (so a repeat request goes to the same person). */
export function openLeadOwner(db: DB, phone: string, exceptLeadId: string): string | null {
  const r = db
    .prepare(
      `SELECT assigned_rep_id FROM leads WHERE phone = ? AND id <> ? AND assigned_rep_id IS NOT NULL
         AND status IN (${marks(OPEN_LEAD_STATUSES.length)}) ORDER BY created_at DESC LIMIT 1`,
    )
    .get(phone, exceptLeadId, ...OPEN_LEAD_STATUSES) as { assigned_rep_id: string } | undefined;
  return r?.assigned_rep_id ?? null;
}

/**
 * Record a routing result on a lead: assign it to a representative, or leave
 * it unassigned (queued / unsupported). Every change is written to the lead's
 * history with who did it and why. `new` becomes `assigned` and back; no other
 * status is ever changed here.
 */
export function assignLead(db: DB, leadId: string, repId: string | null, o: { outcome: string; reason: string; actor: string }): Lead | null {
  const lead = getLead(db, leadId);
  if (!lead) return null;
  const rep = repId ? getRep(db, repId) : null;
  if (repId && !rep) return null;
  return transaction(db, () => {
    const ts = now();
    db.prepare('UPDATE leads SET assigned_rep_id = ?, assigned_at = ?, routing_outcome = ?, routing_reason = ?, updated_at = ? WHERE id = ?').run(
      repId, repId ? ts : null, o.outcome, o.reason, ts, leadId,
    );
    if (lead.assignedRepId !== repId || !lead.routingOutcome) {
      addHistory(db, leadId, 'assignment', lead.assignedRepId ?? '', repId ?? '', `${o.outcome}: ${o.reason}`, o.actor);
      addNote(db, leadId, rep ? `Assigned to ${rep.name} (${o.reason}).` : `Not assigned — ${o.outcome === 'unsupported' ? 'needs review' : 'in the follow-up queue'} (${o.reason}).`, o.actor);
    }
    if (repId && lead.status === 'new') updateLeadStatus(db, leadId, 'assigned', o.actor);
    if (!repId && lead.status === 'assigned') updateLeadStatus(db, leadId, 'new', o.actor);
    return getLead(db, leadId);
  });
}

/** Funnel for pricing-review requests: site events plus what happened to the leads afterwards. */
export function handoffFunnel(db: DB, days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const names = ['preview_view', 'handoff_cta_view', 'handoff_cta_click', 'handoff_start', 'handoff_submit', 'handoff_error'];
  const events = db
    .prepare(`SELECT name, COUNT(*) AS events, COUNT(DISTINCT NULLIF(session_id, '')) AS sessions FROM events WHERE created_at >= ? AND name IN (${marks(names.length)}) GROUP BY name`)
    .all(since, ...names) as { name: string; events: number; sessions: number }[];
  const l = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN assigned_rep_id IS NOT NULL THEN 1 ELSE 0 END) AS assigned,
              SUM(CASE WHEN assigned_rep_id IS NULL AND status IN (${marks(OPEN_LEAD_STATUSES.length)}) THEN 1 ELSE 0 END) AS queued,
              SUM(CASE WHEN routing_outcome = 'unsupported' THEN 1 ELSE 0 END) AS unsupported,
              SUM(CASE WHEN first_contact_at IS NOT NULL THEN 1 ELSE 0 END) AS contacted,
              SUM(CASE WHEN EXISTS (SELECT 1 FROM appointments a WHERE a.lead_id = leads.id AND a.status <> 'cancelled') THEN 1 ELSE 0 END) AS appointments,
              SUM(CASE WHEN status IN ('qualified','sold','install_scheduled','installed')
                         OR EXISTS (SELECT 1 FROM lead_history h WHERE h.lead_id = leads.id AND h.kind = 'status' AND h.to_value = 'qualified') THEN 1 ELSE 0 END) AS qualified,
              SUM(CASE WHEN status IN ('sold','install_scheduled','installed') THEN 1 ELSE 0 END) AS converted,
              AVG(CASE WHEN first_contact_at IS NOT NULL THEN (julianday(first_contact_at) - julianday(created_at)) * 1440 END) AS avg_minutes_to_contact
       FROM leads WHERE created_at >= ? AND source LIKE 'platform_%'`,
    )
    .get(...OPEN_LEAD_STATUSES, since) as Record<string, number | null>;
  return {
    days,
    events: Object.fromEntries(events.map((e) => [e.name, { events: e.events, sessions: e.sessions }])),
    leads: {
      total: l.total ?? 0,
      assigned: l.assigned ?? 0,
      queued: l.queued ?? 0,
      unsupported: l.unsupported ?? 0,
      contacted: l.contacted ?? 0,
      appointments: l.appointments ?? 0,
      qualified: l.qualified ?? 0,
      converted: l.converted ?? 0,
      avgMinutesToFirstContact: l.avg_minutes_to_contact === null ? null : Math.round(l.avg_minutes_to_contact as number),
    },
  };
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

// ------------------------------------------------------------ opportunities --
export interface OpportunityRow {
  id: string;
  leadId: string;
  assessmentId: string;
  marketId: string;
  category: string;
  offerId: string;
  planName: string;
  kind: OpportunityKind;
  estimate: boolean;
  currentMonthlyCents: number | null;
  proposedMonthlyCents: number | null;
  monthlySavingsCents: number | null;
  fiveYearSavingsCents: number | null;
  status: OpportunityStatus;
  /** Pipeline stage (shared/team/pipeline.ts). The coarse `status` above is derived from it. */
  stage: OpportunityStage;
  providerId: string | null;
  productId: string | null;
  /** unverified | address_qualified | provider_verified | not_qualified */
  qualification: string;
  offerSource: string;
  offerExpiresOn: string | null;
  expectedActivationOn: string | null;
  notes: string;
  /** 'customer' when it came from the customer's own selections, otherwise the team member who added it. */
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  /** Joined for list views. */
  leadName?: string;
}

const toOpportunity = (r: Row): OpportunityRow => ({
  id: String(r.id),
  leadId: String(r.lead_id),
  assessmentId: String(r.assessment_id),
  marketId: String(r.market_id),
  category: String(r.category),
  offerId: String(r.offer_id),
  planName: String(r.plan_name),
  kind: r.kind as OpportunityKind,
  estimate: r.is_estimate === 1,
  currentMonthlyCents: r.current_monthly_cents === null ? null : Number(r.current_monthly_cents),
  proposedMonthlyCents: r.proposed_monthly_cents === null ? null : Number(r.proposed_monthly_cents),
  monthlySavingsCents: r.monthly_savings_cents === null ? null : Number(r.monthly_savings_cents),
  fiveYearSavingsCents: r.five_year_savings_cents === null ? null : Number(r.five_year_savings_cents),
  status: r.status as OpportunityStatus,
  stage: ((r.stage as string) ?? 'identified') as OpportunityStage,
  providerId: (r.provider_id as string) ?? null,
  productId: (r.product_id as string) ?? null,
  qualification: (r.qualification as string) ?? 'unverified',
  offerSource: (r.offer_source as string) ?? '',
  offerExpiresOn: (r.offer_expires_on as string) ?? null,
  expectedActivationOn: (r.expected_activation_on as string) ?? null,
  notes: (r.notes as string) ?? '',
  createdBy: (r.created_by as string) ?? 'customer',
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
  ...(r.lead_name !== undefined ? { leadName: String(r.lead_name) } : {}),
});

/** Records a help request's opportunities atomically. */
export function insertOpportunities(db: DB, o: { leadId: string; assessmentId: string; marketId: string; drafts: OpportunityDraft[] }): OpportunityRow[] {
  const ts = now();
  const stmt = db.prepare(
    `INSERT INTO opportunities (id, lead_id, assessment_id, market_id, category, offer_id, plan_name, kind, is_estimate,
       current_monthly_cents, proposed_monthly_cents, monthly_savings_cents, five_year_savings_cents, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`,
  );
  const ids = transaction(db, () =>
    o.drafts.map((d) => {
      const id = randomUUID();
      stmt.run(id, o.leadId, o.assessmentId, o.marketId, d.category, d.offerId, d.planName, d.kind, d.estimate ? 1 : 0,
        d.currentMonthlyCents, d.proposedMonthlyCents, d.monthlySavingsCents, d.fiveYearSavingsCents, ts, ts);
      return id;
    }),
  );
  return ids.map((id) => getOpportunity(db, id)!);
}

export function getOpportunity(db: DB, id: string): OpportunityRow | null {
  const r = db.prepare('SELECT * FROM opportunities WHERE id = ?').get(id) as Row | undefined;
  return r ? toOpportunity(r) : null;
}

export function opportunitiesForLead(db: DB, leadId: string): OpportunityRow[] {
  return (db.prepare('SELECT * FROM opportunities WHERE lead_id = ? ORDER BY created_at, rowid').all(leadId) as Row[]).map(toOpportunity);
}

export interface OpportunityFilter {
  status?: OpportunityStatus;
  category?: string;
  market?: string;
  limit?: number;
  offset?: number;
}

export function listOpportunities(db: DB, f: OpportunityFilter = {}): { opportunities: OpportunityRow[]; total: number } {
  const where: string[] = [];
  const args: (string | number)[] = [];
  const add = (clause: string, value: string) => {
    where.push(clause);
    args.push(value);
  };
  if (f.status) add('o.status = ?', f.status);
  if (f.category) add('o.category = ?', f.category);
  if (f.market) add('o.market_id = ?', f.market);
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = Number((db.prepare(`SELECT COUNT(*) AS n FROM opportunities o ${w}`).get(...args) as Row).n);
  const rows = db
    .prepare(
      `SELECT o.*, l.first_name || ' ' || l.last_name AS lead_name FROM opportunities o JOIN leads l ON l.id = o.lead_id ${w}
       ORDER BY o.created_at DESC, o.rowid LIMIT ? OFFSET ?`,
    )
    .all(...args, Math.min(f.limit ?? 50, 200), f.offset ?? 0) as Row[];
  return { opportunities: rows.map(toOpportunity), total };
}

/** Pipeline totals by status (count and estimated monthly savings of priced, non-sample rows). */
export function opportunityStats(db: DB, market?: string) {
  const rows = db
    .prepare(
      `SELECT status, COUNT(*) AS n,
         COALESCE(SUM(CASE WHEN kind IN ('verified','pending_address') AND monthly_savings_cents > 0 THEN monthly_savings_cents END), 0) AS savings
       FROM opportunities ${market ? 'WHERE market_id = ?' : ''} GROUP BY status`,
    )
    .all(...(market ? [market] : [])) as Row[];
  const byStatus = Object.fromEntries(OPPORTUNITY_STATUSES.map((s) => [s, { count: 0, monthlySavingsCents: 0 }])) as Record<OpportunityStatus, { count: number; monthlySavingsCents: number }>;
  for (const r of rows) byStatus[r.status as OpportunityStatus] = { count: Number(r.n), monthlySavingsCents: Number(r.savings) };
  return byStatus;
}

/** Changes status and records who did it on the lead's timeline. Returns null if not found. */
export function updateOpportunityStatus(db: DB, id: string, status: OpportunityStatus, author: string): OpportunityRow | null {
  const before = getOpportunity(db, id);
  if (!before) return null;
  if (before.status === status) return before;
  db.prepare('UPDATE opportunities SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id);
  addNote(db, before.leadId, `Opportunity "${before.planName}" (${before.category}): ${OPPORTUNITY_STATUS_LABEL[before.status]} → ${OPPORTUNITY_STATUS_LABEL[status]}`, author);
  return getOpportunity(db, id);
}

/** Move an opportunity to a pipeline stage (the caller has already checked the move is allowed). Keeps the coarse status in step. */
export function setOpportunityStage(db: DB, id: string, stage: OpportunityStage, author: string): OpportunityRow | null {
  const before = getOpportunity(db, id);
  if (!before) return null;
  if (before.stage === stage) return before;
  db.prepare('UPDATE opportunities SET stage = ?, status = ?, updated_at = ? WHERE id = ?').run(stage, STAGE_TO_STATUS[stage], now(), id);
  addNote(db, before.leadId, `Opportunity "${before.planName}" (${before.category}): ${OPPORTUNITY_STAGE_LABEL[before.stage]} → ${OPPORTUNITY_STAGE_LABEL[stage]}`, author);
  return getOpportunity(db, id);
}

export interface OpportunityDetails {
  planName: string;
  providerId: string | null;
  productId: string | null;
  proposedMonthlyCents: number | null;
  qualification: string;
  offerSource: string;
  offerExpiresOn: string | null;
  expectedActivationOn: string | null;
  notes: string;
}

/** What the representative is proposing. Savings are recomputed from the stated bill; nothing here is a verified price unless `qualification` says so. */
export function updateOpportunityDetails(db: DB, id: string, d: OpportunityDetails): OpportunityRow | null {
  const before = getOpportunity(db, id);
  if (!before) return null;
  const savings = before.currentMonthlyCents !== null && d.proposedMonthlyCents !== null ? before.currentMonthlyCents - d.proposedMonthlyCents : null;
  db.prepare(
    `UPDATE opportunities SET plan_name = ?, provider_id = ?, product_id = ?, proposed_monthly_cents = ?, monthly_savings_cents = ?, five_year_savings_cents = ?,
       qualification = ?, offer_source = ?, offer_expires_on = ?, expected_activation_on = ?, notes = ?, updated_at = ? WHERE id = ?`,
  ).run(d.planName, d.providerId, d.productId, d.proposedMonthlyCents, savings, savings === null ? null : savings * 60, d.qualification, d.offerSource, d.offerExpiresOn, d.expectedActivationOn, d.notes, now(), id);
  return getOpportunity(db, id);
}

/** An opportunity a team member adds by hand to a household that already has an analysis. */
export function createOpportunity(db: DB, o: { leadId: string; assessmentId: string; marketId: string; category: string; planName: string; currentMonthlyCents: number | null; createdBy: string }): OpportunityRow {
  const id = randomUUID();
  const ts = now();
  db.prepare(
    `INSERT INTO opportunities (id, lead_id, assessment_id, market_id, category, offer_id, plan_name, kind, is_estimate, current_monthly_cents, status, stage, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, '', ?, 'advisor', 1, ?, 'new', 'identified', ?, ?, ?)`,
  ).run(id, o.leadId, o.assessmentId, o.marketId, o.category, o.planName, o.currentMonthlyCents, o.createdBy, ts, ts);
  return getOpportunity(db, id)!;
}
