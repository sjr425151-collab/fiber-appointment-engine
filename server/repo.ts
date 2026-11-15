/**
 * Data access layer. All SQL lives here so the storage engine (SQLite today)
 * can be swapped for Postgres/Supabase later without touching routes.
 */
import { randomUUID } from 'node:crypto';
import type { Appointment, AreaStatus, Lead, LeadNote, LeadStatus } from '../shared/schemas';
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
  updatedAt: string;
}

export function getServiceArea(db: DB, zip: string): ServiceArea | null {
  const r = db.prepare('SELECT * FROM service_areas WHERE zip = ?').get(zip) as Row | undefined;
  return r ? { zip: r.zip as string, city: r.city as string, status: r.status as AreaStatus, updatedAt: r.updated_at as string } : null;
}

export function listServiceAreas(db: DB): ServiceArea[] {
  return (db.prepare('SELECT * FROM service_areas ORDER BY city, zip').all() as Row[]).map((r) => ({
    zip: r.zip as string,
    city: r.city as string,
    status: r.status as AreaStatus,
    updatedAt: r.updated_at as string,
  }));
}

export function upsertServiceArea(db: DB, a: { zip: string; city: string; status: AreaStatus }) {
  db.prepare(
    `INSERT INTO service_areas (zip, city, status, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(zip) DO UPDATE SET city = excluded.city, status = excluded.status, updated_at = excluded.updated_at`,
  ).run(a.zip, a.city, a.status, now());
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
  bookingTokenHash: string;
  consentText: string;
  consentIp: string;
  consentUserAgent: string;
}

/**
 * Create a lead, or refresh an existing one when the same email + phone
 * resubmits (avoids duplicate leads from the same household).
 */
export function createOrRefreshLead(db: DB, l: NewLead): { lead: Lead; duplicate: boolean } {
  return transaction(db, () => {
    const ts = now();
    const existing = db
      .prepare("SELECT id FROM leads WHERE email = ? AND phone = ? AND status <> 'lost' ORDER BY created_at DESC LIMIT 1")
      .get(l.email, l.phone) as { id: string } | undefined;

    if (existing) {
      db.prepare(
        `UPDATE leads SET first_name=?, last_name=?, street=?, unit=?, city=?, zip=?, preferred_contact=?,
           current_provider=?, area_status=?, booking_token_hash=?, consent_text=?, consent_at=?,
           consent_ip=?, consent_user_agent=?, updated_at=? WHERE id=?`,
      ).run(
        l.firstName, l.lastName, l.street, l.unit, l.city, l.zip, l.preferredContact, l.currentProvider,
        l.areaStatus, l.bookingTokenHash, l.consentText, ts, l.consentIp, l.consentUserAgent, ts, existing.id,
      );
      addNote(db, existing.id, 'Lead resubmitted the availability form.', 'system');
      return { lead: getLead(db, existing.id)!, duplicate: true };
    }

    const id = randomUUID();
    db.prepare(
      `INSERT INTO leads (id, first_name, last_name, email, phone, street, unit, city, zip, preferred_contact,
         current_provider, status, area_status, source, utm_source, utm_medium, utm_campaign, booking_token_hash,
         consent_text, consent_at, consent_ip, consent_user_agent, created_at, updated_at,
         utm_content, utm_term, click_id, referrer, landing_page, session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id, l.firstName, l.lastName, l.email, l.phone, l.street, l.unit, l.city, l.zip, l.preferredContact,
      l.currentProvider, l.areaStatus, l.source, l.utmSource, l.utmMedium, l.utmCampaign, l.bookingTokenHash,
      l.consentText, ts, l.consentIp, l.consentUserAgent, ts, ts,
      l.utmContent, l.utmTerm, l.clickId, l.referrer, l.landingPage, l.sessionId,
    );
    return { lead: getLead(db, id)!, duplicate: false };
  });
}

export function getLead(db: DB, id: string): Lead | null {
  const r = db.prepare('SELECT * FROM leads WHERE id = ?').get(id) as Row | undefined;
  return r ? toLead(r) : null;
}

export function getLeadTokenHash(db: DB, id: string): string | null {
  const r = db.prepare('SELECT booking_token_hash FROM leads WHERE id = ?').get(id) as Row | undefined;
  return r ? (r.booking_token_hash as string) : null;
}

export interface LeadFilter {
  status?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export function listLeads(db: DB, f: LeadFilter = {}): { leads: Lead[]; total: number } {
  const where: string[] = [];
  const params: string[] = [];
  if (f.status) {
    where.push('status = ?');
    params.push(f.status);
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
    .all(...params, Math.min(f.limit ?? 50, 200), f.offset ?? 0) as Row[];
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

export function countBookedAt(db: DB, startUtc: string): number {
  const { n } = db
    .prepare("SELECT COUNT(*) AS n FROM appointments WHERE start_utc = ? AND status = 'scheduled'")
    .get(startUtc) as { n: number };
  return n;
}

export function bookedCountsBetween(db: DB, fromUtc: string, toUtc: string): Map<string, number> {
  const rows = db
    .prepare(
      "SELECT start_utc, COUNT(*) AS n FROM appointments WHERE status = 'scheduled' AND start_utc >= ? AND start_utc < ? GROUP BY start_utc",
    )
    .all(fromUtc, toUtc) as { start_utc: string; n: number }[];
  return new Map(rows.map((r) => [r.start_utc, r.n]));
}

export function getActiveAppointmentForLead(db: DB, leadId: string): Appointment | null {
  const r = db
    .prepare("SELECT * FROM appointments WHERE lead_id = ? AND status = 'scheduled' ORDER BY start_utc LIMIT 1")
    .get(leadId) as Row | undefined;
  return r ? toAppointment(r) : null;
}

export function insertAppointment(db: DB, a: { leadId: string; startUtc: string; endUtc: string; notes: string }): Appointment {
  const ts = now();
  const id = randomUUID();
  db.prepare(
    "INSERT INTO appointments (id, lead_id, start_utc, end_utc, status, notes, created_at, updated_at) VALUES (?, ?, ?, ?, 'scheduled', ?, ?, ?)",
  ).run(id, a.leadId, a.startUtc, a.endUtc, a.notes, ts, ts);
  return toAppointment(db.prepare('SELECT * FROM appointments WHERE id = ?').get(id) as Row);
}

export function setAppointmentStatus(db: DB, id: string, status: Appointment['status']): Appointment | null {
  db.prepare('UPDATE appointments SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id);
  const r = db.prepare(`${APPT_JOIN} WHERE a.id = ?`).get(id) as Row | undefined;
  return r ? toAppointment(r) : null;
}

export function listAppointments(db: DB, f: { fromUtc?: string; leadId?: string } = {}): Appointment[] {
  if (f.leadId) {
    return (db.prepare(`${APPT_JOIN} WHERE a.lead_id = ? ORDER BY a.start_utc DESC`).all(f.leadId) as Row[]).map(toAppointment);
  }
  return (
    db.prepare(`${APPT_JOIN} WHERE a.start_utc >= ? ORDER BY a.start_utc LIMIT 500`).all(f.fromUtc ?? '') as Row[]
  ).map(toAppointment);
}

// ------------------------------------------------------------------ events --
export function insertEvent(
  db: DB,
  e: { name: string; sessionId: string; path: string; props: Record<string, unknown>; utmSource: string; utmCampaign: string },
) {
  db.prepare(
    'INSERT INTO events (name, session_id, path, props, utm_source, utm_campaign, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(e.name, e.sessionId, e.path, JSON.stringify(e.props), e.utmSource, e.utmCampaign, now());
}

/** Funnel + attribution summary for the admin dashboard. */
export function conversionStats(db: DB, days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const funnel = db
    .prepare(
      `SELECT name, COUNT(*) AS events, COUNT(DISTINCT NULLIF(session_id, '')) AS sessions
       FROM events WHERE created_at >= ? GROUP BY name`,
    )
    .all(since) as { name: string; events: number; sessions: number }[];
  const sources = db
    .prepare(
      `SELECT COALESCE(NULLIF(utm_source, ''), source) AS source, COUNT(*) AS leads,
              SUM(CASE WHEN status IN ('appointment_set','sold','install_scheduled','installed') THEN 1 ELSE 0 END) AS qualified
       FROM leads WHERE created_at >= ? GROUP BY 1 ORDER BY leads DESC LIMIT 10`,
    )
    .all(since) as { source: string; leads: number; qualified: number }[];
  return { days, funnel: Object.fromEntries(funnel.map((f) => [f.name, f])), sources };
}
