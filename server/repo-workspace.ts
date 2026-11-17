/**
 * Storage for the Agent Workspace: lead events (the timeline), dispositions,
 * contact edits with version checks, notes, follow-ups, per-service details,
 * work queues, KPIs and next best actions. Parameterized SQL only.
 */
import { randomUUID } from 'node:crypto';
import { OPEN_LEAD_STATUSES, type Lead, type LeadNote, type LeadStatus } from '../shared/schemas';
import { ATTEMPTS, INTERESTED, localDate, REACHED, type LeadFacts, type NextActionRule, type QueueId, type TaskBucket, type TaskKind, type TaskPriority, taskBucket } from '../shared/team/workspace';
import { transaction, type DB } from './db';
import * as repo from './repo';

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
const marks = (n: number) => Array.from({ length: n }, () => '?').join(',');

// ------------------------------------------------------------------ events --
export interface LeadEvent {
  id: string;
  leadId: string;
  kind: string;
  code: string;
  title: string;
  detail: unknown;
  actor: string;
  actorType: 'user' | 'system';
  createdAt: string;
}
/** Has this request already been applied to the lead? (double clicks, retries after a dropped connection) */
export function seenRequest(db: DB, leadId: string, requestId: string | undefined): boolean {
  if (!requestId) return false;
  return !!db.prepare('SELECT 1 FROM lead_events WHERE lead_id = ? AND request_id = ?').get(leadId, requestId);
}
export function addEvent(db: DB, e: { leadId: string; kind: string; code?: string; title: string; detail?: unknown; actor: string; actorType?: 'user' | 'system'; requestId?: string }) {
  const ts = now();
  db.prepare('INSERT INTO lead_events (id, lead_id, kind, code, title, detail, actor, actor_type, request_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
    randomUUID(),
    e.leadId,
    e.kind,
    e.code ?? '',
    e.title,
    e.detail === undefined ? '' : JSON.stringify(e.detail),
    e.actor,
    e.actorType ?? 'user',
    e.requestId ?? null,
    ts,
  );
  db.prepare('UPDATE leads SET last_activity_at = ?, updated_at = ? WHERE id = ?').run(ts, ts, e.leadId);
}

// ------------------------------------------------------------ dispositions --
/** Applies already-validated changes from `applyDisposition` and records the event, in one transaction. */
export function recordDisposition(db: DB, lead: Lead, d: { code: string; label: string; changes: Partial<LeadFacts>; reason: string; evidence: string; actor: string; requestId?: string }): Lead {
  return transaction(db, () => {
    const ts = now();
    db.prepare('UPDATE leads SET disposition = ?, disposition_at = ?, version = version + 1 WHERE id = ?').run(d.code, ts, lead.id);
    const c = d.changes;
    if (c.qualification && c.qualification !== lead.qualification) {
      db.prepare("UPDATE leads SET qualification = ?, qualified_at = CASE WHEN ? = 'qualified' THEN COALESCE(qualified_at, ?) ELSE qualified_at END WHERE id = ?").run(c.qualification, c.qualification, ts, lead.id);
    }
    if (c.outcome !== undefined && c.outcome !== lead.outcome) db.prepare('UPDATE leads SET outcome = ?, outcome_at = ? WHERE id = ?').run(c.outcome, c.outcome ? ts : null, lead.id);
    if (c.doNotContact) db.prepare('UPDATE leads SET do_not_contact = 1 WHERE id = ?').run(lead.id);
    if (REACHED.includes(d.code as never) && !lead.firstContactAt) db.prepare('UPDATE leads SET first_contact_at = ? WHERE id = ?').run(ts, lead.id);
    if (c.status && c.status !== lead.status) repo.updateLeadStatus(db, lead.id, c.status, d.actor);
    addEvent(db, { leadId: lead.id, kind: 'disposition', code: d.code, title: d.label, detail: { reason: d.reason || undefined, evidence: d.evidence || undefined, changes: c }, actor: d.actor, requestId: d.requestId });
    return repo.getLead(db, lead.id)!;
  });
}

/** Manager or admin: reopen a closed lead. History is kept; the outcome is cleared. */
export function reopenLead(db: DB, lead: Lead, status: LeadStatus, reason: string, actor: string, requestId?: string): Lead {
  return transaction(db, () => {
    db.prepare("UPDATE leads SET outcome = '', outcome_at = NULL, version = version + 1 WHERE id = ?").run(lead.id);
    repo.updateLeadStatus(db, lead.id, status, actor);
    addEvent(db, { leadId: lead.id, kind: 'reopen', title: 'Lead reopened', detail: { reason, previousOutcome: lead.outcome }, actor, requestId });
    return repo.getLead(db, lead.id)!;
  });
}

/** Manager or admin: lift Do Not Contact (needs a recorded reason). */
export function clearDoNotContact(db: DB, lead: Lead, reason: string, actor: string, requestId?: string): Lead {
  return transaction(db, () => {
    db.prepare('UPDATE leads SET do_not_contact = 0, version = version + 1 WHERE id = ?').run(lead.id);
    addEvent(db, { leadId: lead.id, kind: 'dnc', code: 'cleared', title: 'Do Not Contact lifted', detail: { reason }, actor, requestId });
    return repo.getLead(db, lead.id)!;
  });
}

// ---------------------------------------------------------------- contacts --
export const CONTACT_FIELDS = {
  firstName: 'first_name',
  lastName: 'last_name',
  preferredName: 'preferred_name',
  phone: 'phone',
  email: 'email',
  street: 'street',
  unit: 'unit',
  city: 'city',
  zip: 'zip',
  preferredContact: 'preferred_contact',
  bestTime: 'best_time',
  householdNotes: 'household_notes',
  currentProvider: 'current_provider',
} as const;
export type ContactField = keyof typeof CONTACT_FIELDS;

/**
 * Saves contact edits only if nobody changed the lead since `expectedVersion`.
 * Returns the fields that actually changed (unchanged values are not rewritten or logged).
 */
export function updateContact(
  db: DB,
  leadId: string,
  expectedVersion: number,
  fields: Partial<Record<ContactField, string>>,
  actor: string,
  requestId?: string,
): { ok: true; lead: Lead; changed: ContactField[] } | { ok: false; lead: Lead } {
  return transaction(db, () => {
    const lead = repo.getLead(db, leadId)!;
    if (lead.version !== expectedVersion) return { ok: false as const, lead };
    const changed = (Object.keys(fields) as ContactField[]).filter((k) => fields[k] !== undefined && fields[k] !== (lead[k] as string));
    if (!changed.length) return { ok: true as const, lead, changed };
    const ts = now();
    const sets = changed.map((k) => `${CONTACT_FIELDS[k]} = ?`).join(', ');
    // The column names come from the fixed map above, never from the request.
    db.prepare(`UPDATE leads SET ${sets}, version = version + 1, updated_at = ? WHERE id = ? AND version = ?`).run(...changed.map((k) => fields[k]!), ts, leadId, expectedVersion);
    addEvent(db, {
      leadId,
      kind: 'contact',
      title: 'Contact details updated',
      detail: { changes: Object.fromEntries(changed.map((k) => [k, { from: lead[k], to: fields[k] }])) },
      actor,
      requestId,
    });
    return { ok: true as const, lead: repo.getLead(db, leadId)!, changed };
  });
}

// ------------------------------------------------------------------- notes --
export function getNote(db: DB, id: string): LeadNote | null {
  const r = db.prepare('SELECT * FROM lead_notes WHERE id = ?').get(id) as Row | undefined;
  return r ? repo.toNote(r) : null;
}
export function editNote(db: DB, note: LeadNote, body: string, category: string, actor: string): LeadNote {
  const ts = now();
  db.prepare('UPDATE lead_notes SET body = ?, category = ?, edited_at = ?, edited_by = ? WHERE id = ?').run(body, category, ts, actor, note.id);
  // The earlier wording stays in the timeline, so an edit never erases what was written.
  addEvent(db, { leadId: note.leadId, kind: 'note', code: 'edited', title: 'Note edited', detail: { noteId: note.id, before: note.body }, actor });
  return getNote(db, note.id)!;
}
export function pinNote(db: DB, note: LeadNote, pinned: boolean, actor: string): LeadNote {
  db.prepare('UPDATE lead_notes SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, note.id);
  addEvent(db, { leadId: note.leadId, kind: 'note', code: pinned ? 'pinned' : 'unpinned', title: pinned ? 'Note pinned' : 'Note unpinned', detail: { noteId: note.id }, actor });
  return getNote(db, note.id)!;
}
/** Archiving hides a note from the list; it is never deleted and the timeline keeps its text. */
export function archiveNote(db: DB, note: LeadNote, actor: string) {
  db.prepare('UPDATE lead_notes SET archived_at = ?, archived_by = ? WHERE id = ?').run(now(), actor, note.id);
  addEvent(db, { leadId: note.leadId, kind: 'note', code: 'archived', title: 'Note archived', detail: { noteId: note.id, body: note.body }, actor });
}

// ------------------------------------------------------------------- tasks --
export interface WorkTask {
  id: string;
  leadId: string;
  leadName: string;
  assigneeId: string;
  kind: TaskKind;
  title: string;
  priority: TaskPriority;
  notes: string;
  dueAt: string;
  timeZone: string;
  doneAt: string | null;
  doneBy: string;
  reschedules: number;
  createdBy: string;
  createdAt: string;
  doNotContact: boolean;
}
const TASK_SELECT = `SELECT t.*, TRIM(l.first_name || ' ' || l.last_name) AS lead_name, l.do_not_contact AS dnc FROM tasks t JOIN leads l ON l.id = t.lead_id`;
const toTask = (r: Row): WorkTask => ({
  id: r.id as string,
  leadId: r.lead_id as string,
  leadName: r.lead_name as string,
  assigneeId: r.assignee_id as string,
  kind: ((r.kind as string) || 'general') as TaskKind,
  title: r.title as string,
  priority: ((r.priority as string) || 'normal') as TaskPriority,
  notes: (r.notes as string) ?? '',
  dueAt: r.due_at as string,
  timeZone: (r.time_zone as string) ?? '',
  doneAt: (r.done_at as string) ?? null,
  doneBy: (r.done_by as string) ?? '',
  reschedules: (r.reschedules as number) ?? 0,
  createdBy: r.created_by as string,
  createdAt: r.created_at as string,
  doNotContact: !!r.dnc,
});
export function getTask(db: DB, id: string): WorkTask | null {
  const r = db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(id) as Row | undefined;
  return r ? toTask(r) : null;
}
/** Keeps leads.next_follow_up_at equal to the earliest open follow-up. */
function refreshFollowUp(db: DB, leadId: string) {
  db.prepare('UPDATE leads SET next_follow_up_at = (SELECT MIN(due_at) FROM tasks WHERE lead_id = ? AND done_at IS NULL) WHERE id = ?').run(leadId, leadId);
}
export function createTask(
  db: DB,
  t: { leadId: string; assigneeId: string; kind: TaskKind; title: string; priority: TaskPriority; notes: string; dueAt: string; timeZone: string; actor: string; requestId?: string },
): WorkTask {
  return transaction(db, () => {
    const id = randomUUID();
    db.prepare('INSERT INTO tasks (id, lead_id, assignee_id, title, due_at, created_by, created_at, kind, priority, notes, time_zone) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id,
      t.leadId,
      t.assigneeId,
      t.title,
      t.dueAt,
      t.actor,
      now(),
      t.kind,
      t.priority,
      t.notes,
      t.timeZone,
    );
    refreshFollowUp(db, t.leadId);
    addEvent(db, {
      leadId: t.leadId,
      kind: 'task',
      code: 'created',
      title: `Follow-up scheduled: ${t.title}`,
      detail: { taskId: id, dueAt: t.dueAt, timeZone: t.timeZone, kind: t.kind, priority: t.priority },
      actor: t.actor,
      requestId: t.requestId,
    });
    return getTask(db, id)!;
  });
}
export function completeTask(db: DB, task: WorkTask, actor: string, note: string): WorkTask {
  return transaction(db, () => {
    // Only an open task can be completed, so a double click records one completion.
    const changed = db.prepare('UPDATE tasks SET done_at = ?, done_by = ? WHERE id = ? AND done_at IS NULL').run(now(), actor, task.id).changes === 1;
    if (changed) {
      refreshFollowUp(db, task.leadId);
      addEvent(db, {
        leadId: task.leadId,
        kind: 'task',
        code: 'completed',
        title: `Follow-up completed: ${task.title}`,
        detail: { taskId: task.id, dueAt: task.dueAt, wasOverdue: new Date(task.dueAt) < new Date(), note: note || undefined },
        actor,
      });
    }
    return getTask(db, task.id)!;
  });
}
export function rescheduleTask(db: DB, task: WorkTask, dueAt: string, timeZone: string, actor: string): WorkTask {
  return transaction(db, () => {
    db.prepare('UPDATE tasks SET due_at = ?, time_zone = ?, reschedules = reschedules + 1 WHERE id = ? AND done_at IS NULL').run(dueAt, timeZone, task.id);
    refreshFollowUp(db, task.leadId);
    addEvent(db, { leadId: task.leadId, kind: 'task', code: 'rescheduled', title: `Follow-up rescheduled: ${task.title}`, detail: { taskId: task.id, from: task.dueAt, to: dueAt }, actor });
    return getTask(db, task.id)!;
  });
}
export function listTasks(db: DB, f: { leadId?: string; assigneeIds?: string[] | null; open?: boolean; doneSince?: string; limit?: number }): WorkTask[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.leadId) {
    where.push('t.lead_id = ?');
    params.push(f.leadId);
  }
  if (f.assigneeIds) {
    where.push(`t.assignee_id IN (${marks(f.assigneeIds.length) || "''"})`);
    params.push(...f.assigneeIds);
  }
  if (f.open) where.push('t.done_at IS NULL');
  if (f.doneSince) {
    where.push('(t.done_at IS NULL OR t.done_at >= ?)');
    params.push(f.doneSince);
  }
  return (db.prepare(`${TASK_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY t.done_at IS NOT NULL, t.due_at LIMIT ?`).all(...params, Math.min(f.limit ?? 200, 500)) as Row[]).map(toTask);
}
export function bucketTasks(tasks: WorkTask[], at: Date, timeZone: string): Record<TaskBucket, WorkTask[]> {
  const out: Record<TaskBucket, WorkTask[]> = { overdue: [], today: [], upcoming: [], completed: [] };
  for (const t of tasks) out[taskBucket(t, at, timeZone)].push(t);
  out.completed.sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''));
  return out;
}

// ---------------------------------------------------------------- services --
export interface LeadService {
  category: string;
  provider: string;
  monthlyCents: number | null;
  plan: string;
  concerns: string;
  details: Record<string, unknown>;
  updatedBy: string;
  updatedAt: string;
}
export function listServices(db: DB, leadId: string): LeadService[] {
  return (db.prepare('SELECT * FROM lead_services WHERE lead_id = ?').all(leadId) as Row[]).map((r) => ({
    category: r.category as string,
    provider: r.provider as string,
    monthlyCents: (r.monthly_cents as number) ?? null,
    plan: r.plan as string,
    concerns: r.concerns as string,
    details: JSON.parse((r.details as string) || '{}') as Record<string, unknown>,
    updatedBy: r.updated_by as string,
    updatedAt: r.updated_at as string,
  }));
}
export function saveService(db: DB, leadId: string, s: Omit<LeadService, 'updatedBy' | 'updatedAt'>, actor: string) {
  transaction(db, () => {
    const ts = now();
    db.prepare(
      `INSERT INTO lead_services (lead_id, category, provider, monthly_cents, plan, concerns, details, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(lead_id, category) DO UPDATE SET provider = excluded.provider, monthly_cents = excluded.monthly_cents, plan = excluded.plan,
         concerns = excluded.concerns, details = excluded.details, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).run(leadId, s.category, s.provider, s.monthlyCents, s.plan, s.concerns, JSON.stringify(s.details), actor, ts);
    addEvent(db, { leadId, kind: 'service', code: s.category, title: `Service details updated: ${s.category}`, detail: s, actor });
  });
}

// ---------------------------------------------------------------- timeline --
export interface TimelineItem {
  id: string;
  at: string;
  type: 'created' | 'status' | 'assignment' | 'disposition' | 'contact' | 'note' | 'task' | 'service' | 'chat' | 'system' | 'reopen' | 'dnc';
  title: string;
  detail: unknown;
  actor: string;
  system: boolean;
}
const SYSTEM_ACTORS = new Set(['system', 'routing', '']);
/** Everything that happened to the lead, oldest record kept as it was written. Newest first. */
export function timeline(db: DB, lead: Lead): TimelineItem[] {
  const items: TimelineItem[] = [
    {
      id: `created-${lead.id}`,
      at: lead.createdAt,
      type: 'created',
      title: `Lead created from ${lead.source.replace(/_/g, ' ')}`,
      detail: { landingPage: lead.landingPage, utmSource: lead.utmSource || undefined },
      actor: 'system',
      system: true,
    },
  ];
  for (const h of repo.listLeadHistory(db, lead.id)) {
    items.push({
      id: h.id,
      at: h.createdAt,
      type: h.kind,
      title: h.kind === 'status' ? `Stage: ${h.from || '—'} → ${h.to}` : h.to ? 'Assigned' : 'Unassigned',
      detail: h.detail ? { detail: h.detail, from: h.from, to: h.to } : null,
      actor: h.actor,
      system: SYSTEM_ACTORS.has(h.actor),
    });
  }
  for (const r of db.prepare("SELECT * FROM lead_events WHERE lead_id = ? AND kind <> 'note_request'").all(lead.id) as Row[]) {
    const kind = r.kind as string;
    items.push({
      id: r.id as string,
      at: r.created_at as string,
      type: (['disposition', 'contact', 'note', 'task', 'service', 'reopen', 'dnc'].includes(kind) ? kind : 'system') as TimelineItem['type'],
      title: r.title as string,
      detail: r.detail ? JSON.parse(r.detail as string) : null,
      actor: r.actor as string,
      system: r.actor_type === 'system',
    });
  }
  for (const r of db
    .prepare("SELECT * FROM lead_notes WHERE lead_id = ? AND (kind = 'note' OR (body NOT LIKE 'Status changed:%' AND body NOT LIKE 'Assigned to %' AND body NOT LIKE 'Not assigned %'))")
    .all(lead.id) as Row[]) {
    const n = repo.toNote(r);
    items.push({
      id: `note-${n.id}`,
      at: n.createdAt,
      type: n.kind === 'note' ? 'note' : 'system',
      title: n.kind === 'note' ? 'Note added' : 'System',
      detail: { body: n.body, category: n.category },
      actor: n.author,
      system: n.kind === 'system' || n.author === 'system',
    });
  }
  const chat = db.prepare('SELECT s.id, s.created_at, (SELECT COUNT(*) FROM chat_messages m WHERE m.session_id = s.id) AS n FROM chat_sessions s WHERE s.lead_id = ?').get(lead.id) as Row | undefined;
  if (chat)
    items.push({ id: `chat-${chat.id as string}`, at: chat.created_at as string, type: 'chat', title: `Website chat with the AI assistant (${chat.n as number} messages)`, detail: null, actor: 'customer', system: true });
  return items.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
}

// ----------------------------------------------------------------- queues --
export interface WorkFilter {
  /** null = every lead (manager/admin); otherwise only these owners. */
  ownerIds: string[] | null;
  queue?: QueueId;
  q?: string;
  sort?: 'newest' | 'oldest' | 'activity' | 'followup';
  stage?: string;
  disposition?: string;
  qualification?: string;
  source?: string;
  owner?: string;
  limit?: number;
  offset?: number;
  /** End of "today" for the follow-up-due queue (ISO, from the viewer's time zone). */
  dueBefore?: string;
}
const CLOSED_OUTCOMES = ['lost', 'duplicate', 'invalid', 'spam'];
export function listWorkLeads(db: DB, f: WorkFilter): { leads: (Lead & { ownerName: string | null })[]; total: number } {
  const where: string[] = [];
  const p: (string | number)[] = [];
  if (f.ownerIds) {
    where.push(`l.assigned_rep_id IN (${marks(f.ownerIds.length) || "''"})`);
    p.push(...f.ownerIds);
  }
  switch (f.queue) {
    case 'new':
      where.push("l.status IN ('new','assigned') AND l.disposition = '' AND l.outcome = ''");
      break;
    case 'uncontacted':
      where.push("l.first_contact_at IS NULL AND l.outcome = ''");
      break;
    case 'followup_due':
      where.push("l.next_follow_up_at IS NOT NULL AND l.next_follow_up_at < ? AND l.outcome = ''");
      p.push(f.dueBefore ?? now());
      break;
    case 'interested':
      where.push(`l.outcome = '' AND l.disposition IN (${marks(INTERESTED.length)})`);
      p.push(...INTERESTED);
      break;
    case 'qualified':
      where.push("l.outcome = '' AND l.qualification = 'qualified'");
      break;
    case 'consultations':
      where.push("l.outcome = '' AND l.status = 'appointment_set'");
      break;
    case 'awaiting_verification':
      where.push("l.outcome = '' AND (l.qualification = 'serviceability_check' OR l.disposition IN ('provider_referral','order_submitted'))");
      break;
    case 'won':
      where.push("l.outcome = 'won'");
      break;
    case 'lost':
      where.push(`l.outcome IN (${marks(CLOSED_OUTCOMES.length)})`);
      p.push(...CLOSED_OUTCOMES);
      break;
    case 'unassigned':
      where.push("l.assigned_rep_id IS NULL AND l.outcome = ''");
      break;
  }
  const exact: [keyof WorkFilter, string][] = [
    ['stage', 'l.status'],
    ['disposition', 'l.disposition'],
    ['qualification', 'l.qualification'],
    ['source', 'l.source'],
    ['owner', 'l.assigned_rep_id'],
  ];
  for (const [k, col] of exact) {
    const v = f[k];
    if (typeof v === 'string' && v) {
      where.push(`${col} = ?`);
      p.push(v);
    }
  }
  if (f.q) {
    const q = f.q.trim();
    const like = `%${q.replace(/[%_]/g, '')}%`;
    const digits = q.replace(/\D/g, '');
    const parts = ["(l.first_name || ' ' || l.last_name) LIKE ?", 'l.preferred_name LIKE ?', 'l.email LIKE ?', 'l.id LIKE ?'];
    p.push(like, like, like, `${q.replace(/[%_]/g, '')}%`);
    if (digits.length >= 3) {
      parts.push("REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(l.phone, '(', ''), ')', ''), '-', ''), ' ', ''), '+', '') LIKE ?");
      p.push(`%${digits}%`);
    }
    where.push(`(${parts.join(' OR ')})`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const order = { newest: 'l.created_at DESC', oldest: 'l.created_at ASC', activity: 'COALESCE(l.last_activity_at, l.updated_at) DESC', followup: 'l.next_follow_up_at IS NULL, l.next_follow_up_at ASC' }[
    f.sort ?? 'newest'
  ];
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM leads l ${clause}`).get(...p) as { n: number };
  const rows = db
    .prepare(`SELECT l.id, r.name AS owner_name FROM leads l LEFT JOIN representatives r ON r.id = l.assigned_rep_id ${clause} ORDER BY ${order}, l.id LIMIT ? OFFSET ?`)
    .all(...p, Math.min(f.limit ?? 50, 200), f.offset ?? 0) as Row[];
  return { leads: rows.map((r) => ({ ...repo.getLead(db, r.id as string)!, ownerName: (r.owner_name as string) ?? null })), total: n };
}

// -------------------------------------------------------------- duplicates --
const PHONE_SQL = "SUBSTR(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone, '(', ''), ')', ''), '-', ''), ' ', ''), '+', ''), -10)";
/** Other leads with the same phone number (last 10 digits) or the same email. Never merged automatically. */
export function possibleDuplicates(db: DB, lead: Lead, ownerIds: string[] | null) {
  const digits = lead.phone.replace(/\D/g, '').slice(-10);
  const rows = db
    .prepare(
      `SELECT id, first_name, last_name, status, outcome, created_at, assigned_rep_id, phone, email FROM leads
       WHERE id <> ? AND ((LENGTH(?) = 10 AND ${PHONE_SQL} = ?) OR (? <> '' AND LOWER(email) = LOWER(?))) ORDER BY created_at DESC LIMIT 20`,
    )
    .all(lead.id, digits, digits, lead.email, lead.email) as Row[];
  return rows
    .filter((r) => !ownerIds || ownerIds.includes(r.assigned_rep_id as string))
    .map((r) => ({
      id: r.id as string,
      name: `${r.first_name as string} ${r.last_name as string}`.trim(),
      status: r.status as string,
      outcome: r.outcome as string,
      createdAt: r.created_at as string,
      matchedOn: [
        ((r.phone as string) ?? '').replace(/\D/g, '').slice(-10) === digits && digits.length === 10 ? 'phone' : '',
        lead.email && (r.email as string)?.toLowerCase() === lead.email.toLowerCase() ? 'email' : '',
      ].filter(Boolean),
    }));
}

// ------------------------------------------------------------ KPIs & next --
const startOfLocalDay = (at: Date, tz: string): string => {
  // Midnight in `tz` expressed in UTC: step back from `at` by the local time of day.
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(at);
  const g = (t: string) => Number(parts.find((x) => x.type === t)?.value ?? 0) % 24;
  return new Date(at.getTime() - ((g('hour') * 60 + g('minute')) * 60 + g('second')) * 1000 - at.getMilliseconds()).toISOString();
};
export const endOfLocalDay = (at: Date, tz: string): string => {
  // The next local midnight: start of today + 24h, corrected for a daylight-saving change during the day.
  const start = new Date(startOfLocalDay(at, tz));
  const guess = new Date(start.getTime() + 26 * 3600_000);
  return startOfLocalDay(guess, tz);
};

export function overview(db: DB, ownerIds: string[] | null, tz: string, days: number, at = new Date()) {
  const own = ownerIds ? `assigned_rep_id IN (${marks(ownerIds.length) || "''"})` : '1=1';
  const op = ownerIds ?? [];
  const since = new Date(at.getTime() - days * 86_400_000).toISOString();
  const todayStart = startOfLocalDay(at, tz);
  const todayEnd = endOfLocalDay(at, tz);
  const one = (sql: string, ...params: (string | number)[]) => (db.prepare(sql).get(...params) as { n: number | null }).n ?? 0;
  const openStatuses = OPEN_LEAD_STATUSES;
  const taskOwner = ownerIds ? `t.assignee_id IN (${marks(ownerIds.length) || "''"})` : '1=1';

  const assignedCohort = one(`SELECT COUNT(*) AS n FROM leads WHERE ${own} AND assigned_at >= ?`, ...op, since);
  const contactedCohort = one(`SELECT COUNT(*) AS n FROM leads WHERE ${own} AND assigned_at >= ? AND first_contact_at IS NOT NULL`, ...op, since);
  const qualifiedCohort = one(`SELECT COUNT(*) AS n FROM leads WHERE ${own} AND assigned_at >= ? AND first_contact_at IS NOT NULL AND qualified_at IS NOT NULL`, ...op, since);
  const wonCohort = one(`SELECT COUNT(*) AS n FROM leads WHERE ${own} AND assigned_at >= ? AND qualified_at IS NOT NULL AND outcome = 'won'`, ...op, since);
  const rate = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
  const contactCodes = [...ATTEMPTS, ...REACHED];

  const kpis = {
    assigned: one(`SELECT COUNT(*) AS n FROM leads WHERE ${own} AND outcome = '' AND status IN (${marks(openStatuses.length)})`, ...op, ...openStatuses),
    newToday: one(`SELECT COUNT(*) AS n FROM leads WHERE ${own} AND assigned_at >= ?`, ...op, todayStart),
    contacted: one(
      `SELECT COUNT(DISTINCT e.lead_id) AS n FROM lead_events e JOIN leads l ON l.id = e.lead_id WHERE e.kind = 'disposition' AND e.code IN (${marks(contactCodes.length)}) AND e.created_at >= ? AND ${ownerIds ? `l.${own}` : '1=1'}`,
      ...contactCodes,
      since,
      ...op,
    ),
    followUpsDue: one(`SELECT COUNT(*) AS n FROM tasks t WHERE ${taskOwner} AND t.done_at IS NULL AND t.due_at >= ? AND t.due_at < ?`, ...op, at.toISOString(), todayEnd),
    overdue: one(`SELECT COUNT(*) AS n FROM tasks t WHERE ${taskOwner} AND t.done_at IS NULL AND t.due_at < ?`, ...op, at.toISOString()),
    interested: one(`SELECT COUNT(*) AS n FROM leads WHERE ${own} AND outcome = '' AND disposition IN (${marks(INTERESTED.length)})`, ...op, ...INTERESTED),
    qualified: one(`SELECT COUNT(*) AS n FROM leads WHERE ${own} AND outcome = '' AND qualification = 'qualified'`, ...op),
    consultations: one(`SELECT COUNT(*) AS n FROM leads WHERE ${own} AND outcome = '' AND status = 'appointment_set'`, ...op),
    won: one(`SELECT COUNT(*) AS n FROM leads WHERE ${own} AND outcome = 'won' AND outcome_at >= ?`, ...op, since),
    leadToContact: rate(contactedCohort, assignedCohort),
    contactToQualified: rate(qualifiedCohort, contactedCohort),
    qualifiedToWon: rate(wonCohort, qualifiedCohort),
  };
  return { kpis, cohort: { assigned: assignedCohort, contacted: contactedCohort, qualified: qualifiedCohort, won: wonCohort }, days, today: localDate(at, tz) };
}

export interface NextAction {
  rule: NextActionRule;
  leadId: string;
  leadName: string;
  at: string | null;
  taskId?: string;
  detail: string;
}
export function nextActions(db: DB, ownerIds: string[] | null, at = new Date(), limit = 8): NextAction[] {
  const op = ownerIds ?? [];
  const own = (alias: string) => (ownerIds ? `${alias}.assigned_rep_id IN (${marks(ownerIds.length) || "''"})` : '1=1');
  const taskOwner = ownerIds ? `t.assignee_id IN (${marks(ownerIds.length) || "''"})` : '1=1';
  const nowIso = at.toISOString();
  const soon = new Date(at.getTime() + 2 * 3600_000).toISOString();
  const name = (r: Row) => `${r.first_name as string} ${r.last_name as string}`.trim();
  const out: NextAction[] = [];
  const tasks = (cond: string, ...params: string[]) =>
    db
      .prepare(`SELECT t.id, t.title, t.due_at, l.id AS lead_id, l.first_name, l.last_name FROM tasks t JOIN leads l ON l.id = t.lead_id WHERE ${taskOwner} AND t.done_at IS NULL AND ${cond} ORDER BY t.due_at LIMIT ?`)
      .all(...op, ...params, limit) as Row[];
  for (const r of tasks('t.due_at < ?', nowIso)) out.push({ rule: 'overdue_task', leadId: r.lead_id as string, leadName: name(r), at: r.due_at as string, taskId: r.id as string, detail: r.title as string });
  for (const r of tasks('t.due_at >= ? AND t.due_at < ?', nowIso, soon))
    out.push({ rule: 'task_due_soon', leadId: r.lead_id as string, leadName: name(r), at: r.due_at as string, taskId: r.id as string, detail: r.title as string });
  const leads = (cond: string) =>
    db
      .prepare(`SELECT l.id, l.first_name, l.last_name, l.assigned_at, l.created_at FROM leads l WHERE ${own('l')} AND l.outcome = '' AND ${cond} ORDER BY COALESCE(l.assigned_at, l.created_at) LIMIT ?`)
      .all(...op, limit) as Row[];
  for (const r of leads("l.disposition = '' AND l.status IN ('new','assigned')"))
    out.push({ rule: 'new_lead', leadId: r.id as string, leadName: name(r), at: (r.assigned_at as string) ?? (r.created_at as string), detail: 'No contact recorded yet' });
  for (const r of leads("l.qualification = 'serviceability_check'")) out.push({ rule: 'serviceability', leadId: r.id as string, leadName: name(r), at: null, detail: 'Confirm what is available at the address' });
  for (const r of leads("l.qualification = 'qualified' AND l.next_follow_up_at IS NULL"))
    out.push({ rule: 'qualified_no_next_step', leadId: r.id as string, leadName: name(r), at: null, detail: 'Schedule the next step' });
  const seen = new Set<string>();
  return out.filter((a) => (seen.has(a.leadId) ? false : (seen.add(a.leadId), true))).slice(0, limit);
}
