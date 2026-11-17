/**
 * Storage for the team area: members, invitations, teams, the audit log,
 * activities, follow-up tasks and in-app notifications. Parameterized SQL only.
 * (Leads, markets and assessments live in ./repo.ts; orders and money in ./repo-ops.ts.)
 */
import { randomUUID } from 'node:crypto';
import { OPEN_LEAD_STATUSES, type Lead } from '../shared/schemas';
import type { Role, TeamRole, UserStatus } from '../shared/team/permissions';
import { transaction, type DB } from './db';
import * as repo from './repo';

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
const marks = (n: number) => Array.from({ length: n }, () => '?').join(',');

// ---------------------------------------------------------------- settings --
export function getSetting(db: DB, key: string): string | null {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return r?.value ?? null;
}
export function setSetting(db: DB, key: string, value: string) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

// ------------------------------------------------------------------- audit --
export interface AuditInput {
  actor: string;
  role: Role | 'system' | 'public';
  action: string;
  resourceType?: string;
  resourceId?: string;
  /** Context for the change. Never put passwords, tokens or secrets here. */
  detail?: Record<string, unknown>;
  ip?: string;
}
export function addAudit(db: DB, a: AuditInput) {
  db.prepare('INSERT INTO audit_events (actor, actor_role, action, resource_type, resource_id, detail, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    a.actor, a.role, a.action, a.resourceType ?? '', a.resourceId ?? '', JSON.stringify(a.detail ?? {}), a.ip ?? '', now(),
  );
}
export interface AuditRow {
  id: number;
  actor: string;
  actorRole: string;
  action: string;
  resourceType: string;
  resourceId: string;
  detail: Record<string, unknown>;
  ip: string;
  createdAt: string;
}
export function listAudit(db: DB, f: { action?: string; actor?: string; resourceType?: string; resourceId?: string; limit?: number; offset?: number } = {}): { events: AuditRow[]; total: number } {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.action) {
    where.push('action LIKE ?');
    params.push(`${f.action.replace(/[%_]/g, '')}%`);
  }
  if (f.actor) {
    where.push('actor = ?');
    params.push(f.actor);
  }
  if (f.resourceType) {
    where.push('resource_type = ?');
    params.push(f.resourceType);
  }
  if (f.resourceId) {
    where.push('resource_id = ?');
    params.push(f.resourceId);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM audit_events ${clause}`).get(...params) as { n: number };
  const rows = db.prepare(`SELECT * FROM audit_events ${clause} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, Math.min(f.limit ?? 50, 200), f.offset ?? 0) as Row[];
  return {
    total: n,
    events: rows.map((r) => ({
      id: r.id as number,
      actor: r.actor as string,
      actorRole: r.actor_role as string,
      action: r.action as string,
      resourceType: r.resource_type as string,
      resourceId: r.resource_id as string,
      detail: JSON.parse(r.detail as string) as Record<string, unknown>,
      ip: r.ip as string,
      createdAt: r.created_at as string,
    })),
  };
}

// ------------------------------------------------------------ team members --
/** Everything needed to check a sign-in. Never sent to a browser. */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: TeamRole;
  status: UserStatus;
  mfaEnabled: boolean;
  mfaSecret: string;
  mfaPending: string;
  sessionEpoch: number;
  failedLogins: number;
  lockedUntil: string | null;
}
const toAuth = (r: Row): AuthUser => ({
  id: r.id as string,
  email: r.email as string,
  name: r.name as string,
  passwordHash: r.password_hash as string,
  role: r.role as TeamRole,
  status: r.status as UserStatus,
  mfaEnabled: !!r.mfa_enabled,
  mfaSecret: r.mfa_secret as string,
  mfaPending: r.mfa_pending as string,
  sessionEpoch: r.session_epoch as number,
  failedLogins: r.failed_logins as number,
  lockedUntil: (r.locked_until as string) ?? null,
});
export function authUserByEmail(db: DB, email: string): AuthUser | null {
  const r = db.prepare('SELECT * FROM representatives WHERE email = ?').get(email) as Row | undefined;
  return r ? toAuth(r) : null;
}
export function authUserById(db: DB, id: string): AuthUser | null {
  const r = db.prepare('SELECT * FROM representatives WHERE id = ?').get(id) as Row | undefined;
  return r ? toAuth(r) : null;
}

export interface NewUser {
  name: string;
  email: string;
  phone: string;
  role: TeamRole;
  teamId: string | null;
  markets: string[];
  categories: string[];
  maxOpenLeads: number;
}
/** Adds a member in the "invited" state: they cannot sign in until they accept an invitation and set a password. */
export function createUser(db: DB, u: NewUser): string {
  return transaction(db, () => {
    const id = randomUUID();
    const ts = now();
    const { n } = db.prepare('SELECT COALESCE(MAX(CAST(SUBSTR(rep_code, 3) AS INTEGER)), 1000) AS n FROM representatives').get() as { n: number };
    db.prepare(
      `INSERT INTO representatives (id, name, email, phone, password_hash, active, accepting, markets, categories, max_open_leads, created_at, updated_at, role, status, team_id, rep_code)
       VALUES (?, ?, ?, ?, '', 0, 0, ?, ?, ?, ?, ?, ?, 'invited', ?, ?)`,
    ).run(id, u.name, u.email, u.phone, JSON.stringify(u.markets), JSON.stringify(u.categories), u.maxOpenLeads, ts, ts, u.role, u.teamId, `R-${n + 1}`);
    return id;
  });
}

export function updateUser(db: DB, id: string, u: Partial<NewUser> & { accepting?: boolean }) {
  const cur = repo.getRep(db, id);
  if (!cur) return null;
  db.prepare(
    `UPDATE representatives SET name = ?, phone = ?, role = ?, team_id = ?, markets = ?, categories = ?, max_open_leads = ?, accepting = ?, updated_at = ? WHERE id = ?`,
  ).run(
    u.name ?? cur.name, u.phone ?? cur.phone, u.role ?? cur.role, u.teamId === undefined ? cur.teamId : u.teamId,
    JSON.stringify(u.markets ?? cur.markets), JSON.stringify(u.categories ?? cur.categories), u.maxOpenLeads ?? cur.maxOpenLeads,
    (u.accepting ?? cur.accepting) && cur.status === 'active' ? 1 : 0, now(), id,
  );
  return repo.getRep(db, id);
}

/** Changing status also ends every session the member has open. */
export function setUserStatus(db: DB, id: string, status: UserStatus) {
  db.prepare('UPDATE representatives SET status = ?, active = ?, accepting = CASE WHEN ? = 1 THEN accepting ELSE 0 END, session_epoch = session_epoch + 1, updated_at = ? WHERE id = ?').run(
    status, status === 'active' ? 1 : 0, status === 'active' ? 1 : 0, now(), id,
  );
}
export function setPassword(db: DB, id: string, passwordHash: string, o: { activate: boolean; emailVerified: boolean }) {
  db.prepare(
    `UPDATE representatives SET password_hash = ?, session_epoch = session_epoch + 1, failed_logins = 0, locked_until = NULL,
       status = CASE WHEN ? = 1 AND status = 'invited' THEN 'active' ELSE status END,
       active = CASE WHEN ? = 1 AND status = 'invited' THEN 1 ELSE active END,
       email_verified_at = CASE WHEN ? = 1 THEN ? ELSE email_verified_at END, updated_at = ? WHERE id = ?`,
  ).run(passwordHash, o.activate ? 1 : 0, o.activate ? 1 : 0, o.emailVerified ? 1 : 0, now(), now(), id);
}
/** Ends every open session for this member ("sign out everywhere"). */
export function endSessions(db: DB, id: string) {
  db.prepare('UPDATE representatives SET session_epoch = session_epoch + 1 WHERE id = ?').run(id);
}
export const LOCK_AFTER = 5;
export const LOCK_MINUTES = 15;
export function recordLoginFailure(db: DB, id: string) {
  db.prepare(
    `UPDATE representatives SET failed_logins = failed_logins + 1,
       locked_until = CASE WHEN failed_logins + 1 >= ? THEN ? ELSE locked_until END WHERE id = ?`,
  ).run(LOCK_AFTER, new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString(), id);
}
export function recordLoginSuccess(db: DB, id: string) {
  db.prepare('UPDATE representatives SET failed_logins = 0, locked_until = NULL, last_login_at = ? WHERE id = ?').run(now(), id);
}
export function setMfaPending(db: DB, id: string, secret: string) {
  db.prepare('UPDATE representatives SET mfa_pending = ? WHERE id = ?').run(secret, id);
}
export function enableMfa(db: DB, id: string, secret: string) {
  db.prepare("UPDATE representatives SET mfa_secret = ?, mfa_pending = '', mfa_enabled = 1 WHERE id = ?").run(secret, id);
}
export function disableMfa(db: DB, id: string) {
  db.prepare("UPDATE representatives SET mfa_secret = '', mfa_pending = '', mfa_enabled = 0, session_epoch = session_epoch + 1 WHERE id = ?").run(id);
}

// ------------------------------------------------------------- invitations --
export const INVITE_DAYS = 7;
export const RESET_HOURS = 2;
export interface Invitation {
  id: string;
  userId: string;
  purpose: 'activate' | 'reset';
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  createdBy: string;
  createdAt: string;
}
const toInvitation = (r: Row): Invitation => ({
  id: r.id as string,
  userId: r.user_id as string,
  purpose: r.purpose as Invitation['purpose'],
  expiresAt: r.expires_at as string,
  usedAt: (r.used_at as string) ?? null,
  revokedAt: (r.revoked_at as string) ?? null,
  createdBy: r.created_by as string,
  createdAt: r.created_at as string,
});
/** Issues a new link and cancels any earlier unused link of the same kind for this member. */
export function createInvitation(db: DB, userId: string, purpose: Invitation['purpose'], tokenHash: string, by: string): Invitation {
  return transaction(db, () => {
    const ts = now();
    db.prepare('UPDATE invitations SET revoked_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL AND revoked_at IS NULL').run(ts, userId, purpose);
    const id = randomUUID();
    const expires = new Date(Date.now() + (purpose === 'activate' ? INVITE_DAYS * 86_400_000 : RESET_HOURS * 3_600_000)).toISOString();
    db.prepare('INSERT INTO invitations (id, user_id, purpose, token_hash, expires_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, userId, purpose, tokenHash, expires, by, ts);
    return toInvitation(db.prepare('SELECT * FROM invitations WHERE id = ?').get(id) as Row);
  });
}
/** A link is usable once, before it expires, unless it was revoked. */
export function usableInvitation(db: DB, tokenHash: string, at = new Date()): Invitation | null {
  const r = db.prepare('SELECT * FROM invitations WHERE token_hash = ?').get(tokenHash) as Row | undefined;
  if (!r) return null;
  const i = toInvitation(r);
  return i.usedAt || i.revokedAt || i.expiresAt <= at.toISOString() ? null : i;
}
export function useInvitation(db: DB, id: string): boolean {
  return db.prepare('UPDATE invitations SET used_at = ? WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL').run(now(), id).changes === 1;
}
export function revokeInvitations(db: DB, userId: string): number {
  return Number(db.prepare('UPDATE invitations SET revoked_at = ? WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL').run(now(), userId).changes);
}
export function openInvitation(db: DB, userId: string, at = new Date()): Invitation | null {
  const r = db
    .prepare('SELECT * FROM invitations WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1')
    .get(userId, at.toISOString()) as Row | undefined;
  return r ? toInvitation(r) : null;
}

// ------------------------------------------------------------------- teams --
export interface Team {
  id: string;
  name: string;
  managerId: string | null;
  members: number;
}
export function listTeams(db: DB): Team[] {
  return (
    db.prepare('SELECT t.*, (SELECT COUNT(*) FROM representatives r WHERE r.team_id = t.id) AS members FROM teams t ORDER BY t.name').all() as Row[]
  ).map((r) => ({ id: r.id as string, name: r.name as string, managerId: (r.manager_id as string) ?? null, members: r.members as number }));
}
export function getTeam(db: DB, id: string): Team | null {
  return listTeams(db).find((t) => t.id === id) ?? null;
}
export function createTeam(db: DB, name: string, managerId: string | null): Team {
  const id = randomUUID();
  db.prepare('INSERT INTO teams (id, name, manager_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(id, name, managerId, now(), now());
  return getTeam(db, id)!;
}
export function updateTeam(db: DB, id: string, name: string, managerId: string | null): Team | null {
  db.prepare('UPDATE teams SET name = ?, manager_id = ?, updated_at = ? WHERE id = ?').run(name, managerId, now(), id);
  return getTeam(db, id);
}
/** Ids of everyone on the teams this person manages (including themselves). */
export function teamMemberIds(db: DB, managerId: string): string[] {
  const rows = db
    .prepare('SELECT r.id FROM representatives r WHERE r.team_id IN (SELECT id FROM teams WHERE manager_id = ?) OR r.id = ?')
    .all(managerId, managerId) as { id: string }[];
  return [...new Set(rows.map((r) => r.id))];
}
/** The manager of the team a member belongs to, if any. */
export function managerOf(db: DB, userId: string): string | null {
  const r = db.prepare('SELECT t.manager_id FROM representatives r JOIN teams t ON t.id = r.team_id WHERE r.id = ?').get(userId) as { manager_id: string | null } | undefined;
  return r?.manager_id && r.manager_id !== userId ? r.manager_id : null;
}

// -------------------------------------------------------------- activities --
export const ACTIVITY_KINDS = ['call', 'email', 'text', 'meeting', 'offer', 'other'] as const;
export interface Activity {
  id: string;
  leadId: string;
  kind: (typeof ACTIVITY_KINDS)[number];
  outcome: string;
  body: string;
  actor: string;
  occurredAt: string;
  createdAt: string;
}
export function addActivity(db: DB, a: Omit<Activity, 'id' | 'createdAt'>): Activity {
  const row = { ...a, id: randomUUID(), createdAt: now() };
  db.prepare('INSERT INTO lead_activities (id, lead_id, kind, outcome, body, actor, occurred_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    row.id, row.leadId, row.kind, row.outcome, row.body, row.actor, row.occurredAt, row.createdAt,
  );
  db.prepare('UPDATE leads SET updated_at = ? WHERE id = ?').run(row.createdAt, a.leadId);
  return row;
}
export function listActivities(db: DB, leadId: string): Activity[] {
  return (db.prepare('SELECT * FROM lead_activities WHERE lead_id = ? ORDER BY occurred_at DESC, created_at DESC').all(leadId) as Row[]).map((r) => ({
    id: r.id as string,
    leadId: r.lead_id as string,
    kind: r.kind as Activity['kind'],
    outcome: r.outcome as string,
    body: r.body as string,
    actor: r.actor as string,
    occurredAt: r.occurred_at as string,
    createdAt: r.created_at as string,
  }));
}

// ------------------------------------------------------------------- tasks --
export interface Task {
  id: string;
  leadId: string;
  leadName: string;
  assigneeId: string;
  title: string;
  dueAt: string;
  doneAt: string | null;
  createdBy: string;
  createdAt: string;
}
const TASK_SELECT = `SELECT t.*, TRIM(l.first_name || ' ' || l.last_name) AS lead_name FROM tasks t JOIN leads l ON l.id = t.lead_id`;
const toTask = (r: Row): Task => ({
  id: r.id as string,
  leadId: r.lead_id as string,
  leadName: r.lead_name as string,
  assigneeId: r.assignee_id as string,
  title: r.title as string,
  dueAt: r.due_at as string,
  doneAt: (r.done_at as string) ?? null,
  createdBy: r.created_by as string,
  createdAt: r.created_at as string,
});
export function createTask(db: DB, t: { leadId: string; assigneeId: string; title: string; dueAt: string; createdBy: string }): Task {
  const id = randomUUID();
  db.prepare('INSERT INTO tasks (id, lead_id, assignee_id, title, due_at, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, t.leadId, t.assigneeId, t.title, t.dueAt, t.createdBy, now());
  return getTask(db, id)!;
}
export function getTask(db: DB, id: string): Task | null {
  const r = db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(id) as Row | undefined;
  return r ? toTask(r) : null;
}
export function completeTask(db: DB, id: string, by: string): Task | null {
  db.prepare('UPDATE tasks SET done_at = ?, done_by = ? WHERE id = ? AND done_at IS NULL').run(now(), by, id);
  return getTask(db, id);
}
export function listTasks(db: DB, f: { leadId?: string; assigneeIds?: string[]; open?: boolean; limit?: number }): Task[] {
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
  return (db.prepare(`${TASK_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY t.done_at IS NOT NULL, t.due_at LIMIT ?`).all(...params, Math.min(f.limit ?? 100, 300)) as Row[]).map(toTask);
}

// ----------------------------------------------------------- notifications --
export interface UserNotification {
  id: string;
  kind: string;
  title: string;
  leadId: string | null;
  readAt: string | null;
  createdAt: string;
}
/** Adds an in-app notification once per `dedupeKey`; repeating the same event never alerts twice. */
export function notify(db: DB, n: { userId: string; kind: string; title: string; leadId?: string | null; dedupeKey: string }): boolean {
  return (
    db
      .prepare('INSERT OR IGNORE INTO user_notifications (id, user_id, kind, title, lead_id, dedupe_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), n.userId, n.kind, n.title, n.leadId ?? null, n.dedupeKey, now()).changes === 1
  );
}
export function listNotifications(db: DB, userId: string, limit = 30): { items: UserNotification[]; unread: number } {
  const items = (db.prepare('SELECT * FROM user_notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?').all(userId, limit) as Row[]).map((r) => ({
    id: r.id as string,
    kind: r.kind as string,
    title: r.title as string,
    leadId: (r.lead_id as string) ?? null,
    readAt: (r.read_at as string) ?? null,
    createdAt: r.created_at as string,
  }));
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM user_notifications WHERE user_id = ? AND read_at IS NULL').get(userId) as { n: number };
  return { items, unread: n };
}
export function markNotificationsRead(db: DB, userId: string) {
  db.prepare('UPDATE user_notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now(), userId);
}

// ---------------------------------------------------------------- claiming --
/**
 * A representative takes an unassigned open lead. The update only succeeds if
 * nobody else got there first, so two people can never both claim one lead.
 */
export function claimLead(db: DB, leadId: string, repId: string, actor: string): Lead | null {
  const ts = now();
  const won =
    db
      .prepare(`UPDATE leads SET assigned_rep_id = ?, assigned_at = ?, routing_outcome = 'assigned', routing_reason = 'Claimed from the queue', updated_at = ? WHERE id = ? AND assigned_rep_id IS NULL AND status IN (${marks(OPEN_LEAD_STATUSES.length)})`)
      .run(repId, ts, ts, leadId, ...OPEN_LEAD_STATUSES).changes === 1;
  if (!won) return null;
  // Record it the same way as any other assignment (history, note, status new → assigned).
  db.prepare("UPDATE leads SET assigned_rep_id = NULL, routing_outcome = 'queued' WHERE id = ?").run(leadId);
  return repo.assignLead(db, leadId, repId, { outcome: 'assigned', reason: 'Claimed from the queue', actor });
}

/** The unassigned queue as a representative may see it before claiming: no contact details. */
export function claimableLeads(db: DB, limit = 50) {
  return (
    db
      .prepare(
        `SELECT l.id, l.first_name, l.city, l.zip, l.market_id, l.created_at, l.source,
                (SELECT GROUP_CONCAT(o.category, ',') FROM opportunities o WHERE o.lead_id = l.id) AS categories
         FROM leads l WHERE l.assigned_rep_id IS NULL AND l.routing_outcome <> 'unsupported' AND l.status IN (${marks(OPEN_LEAD_STATUSES.length)}) ORDER BY l.created_at LIMIT ?`,
      )
      .all(...OPEN_LEAD_STATUSES, limit) as Row[]
  ).map((r) => ({
    id: r.id as string,
    firstName: r.first_name as string,
    city: r.city as string,
    zip: r.zip as string,
    marketId: r.market_id as string,
    createdAt: r.created_at as string,
    source: r.source as string,
    categories: ((r.categories as string) ?? '').split(',').filter(Boolean),
  }));
}
