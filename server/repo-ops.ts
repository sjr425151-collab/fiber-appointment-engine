/**
 * Storage for the sales operation: providers and products, orders with their
 * status history, and the reporting queries. Parameterized SQL only.
 * An order's status only moves through checked transitions, each recorded.
 * (By the owner's decision, no commission, earnings or payout data is kept.)
 */
import { randomUUID } from 'node:crypto';
import { OPEN_ORDER_STATUSES, stageForOrder, type OrderCategory, type OrderStatus, type PartnershipStatus } from '../shared/team/pipeline';
import { OPEN_LEAD_STATUSES } from '../shared/schemas';
import { transaction, type DB } from './db';
import * as repo from './repo';

type Row = Record<string, unknown>;
const now = () => new Date().toISOString();
const marks = (n: number) => Array.from({ length: n }, () => '?').join(',');
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

// --------------------------------------------------------------- providers --
export interface Provider {
  id: string;
  name: string;
  categories: string[];
  partnershipStatus: PartnershipStatus;
  orderMethod: string;
  coverage: string;
  notes: string;
  updatedAt: string;
}
const toProvider = (r: Row): Provider => ({
  id: r.id as string,
  name: r.name as string,
  categories: JSON.parse(r.categories as string) as string[],
  partnershipStatus: r.partnership_status as PartnershipStatus,
  orderMethod: r.order_method as string,
  coverage: r.coverage as string,
  notes: r.notes as string,
  updatedAt: r.updated_at as string,
});
export type ProviderInput = Omit<Provider, 'id' | 'updatedAt'>;
export function listProviders(db: DB): Provider[] {
  return (db.prepare('SELECT * FROM providers ORDER BY name').all() as Row[]).map(toProvider);
}
export function getProvider(db: DB, id: string): Provider | null {
  const r = db.prepare('SELECT * FROM providers WHERE id = ?').get(id) as Row | undefined;
  return r ? toProvider(r) : null;
}
export function saveProvider(db: DB, id: string | null, p: ProviderInput): Provider {
  const ts = now();
  const pid = id ?? randomUUID();
  if (id) {
    db.prepare('UPDATE providers SET name = ?, categories = ?, partnership_status = ?, order_method = ?, coverage = ?, notes = ?, updated_at = ? WHERE id = ?').run(
      p.name, JSON.stringify(p.categories), p.partnershipStatus, p.orderMethod, p.coverage, p.notes, ts, id,
    );
  } else {
    db.prepare('INSERT INTO providers (id, name, categories, partnership_status, order_method, coverage, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      pid, p.name, JSON.stringify(p.categories), p.partnershipStatus, p.orderMethod, p.coverage, p.notes, ts, ts,
    );
  }
  return getProvider(db, pid)!;
}

export interface Product {
  id: string;
  providerId: string;
  category: string;
  name: string;
  priceCents: number;
  promoPriceCents: number | null;
  promoMonths: number;
  feesNote: string;
  eligibility: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  active: boolean;
}
const toProduct = (r: Row): Product => ({
  id: r.id as string,
  providerId: r.provider_id as string,
  category: r.category as string,
  name: r.name as string,
  priceCents: r.price_cents as number,
  promoPriceCents: num(r.promo_price_cents),
  promoMonths: r.promo_months as number,
  feesNote: r.fees_note as string,
  eligibility: r.eligibility as string,
  effectiveFrom: r.effective_from as string,
  effectiveTo: (r.effective_to as string) ?? null,
  active: !!r.active,
});
export type ProductInput = Omit<Product, 'id'>;
export function listProducts(db: DB, providerId?: string): Product[] {
  const rows = providerId ? db.prepare('SELECT * FROM products WHERE provider_id = ? ORDER BY name').all(providerId) : db.prepare('SELECT * FROM products ORDER BY name').all();
  return (rows as Row[]).map(toProduct);
}
export function getProduct(db: DB, id: string): Product | null {
  const r = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Row | undefined;
  return r ? toProduct(r) : null;
}
export function saveProduct(db: DB, id: string | null, p: ProductInput): Product {
  const ts = now();
  const pid = id ?? randomUUID();
  const vals = [p.providerId, p.category, p.name, p.priceCents, p.promoPriceCents, p.promoMonths, p.feesNote, p.eligibility, p.effectiveFrom, p.effectiveTo, p.active ? 1 : 0];
  if (id) {
    db.prepare('UPDATE products SET provider_id = ?, category = ?, name = ?, price_cents = ?, promo_price_cents = ?, promo_months = ?, fees_note = ?, eligibility = ?, effective_from = ?, effective_to = ?, active = ?, updated_at = ? WHERE id = ?').run(...vals, ts, id);
  } else {
    db.prepare('INSERT INTO products (provider_id, category, name, price_cents, promo_price_cents, promo_months, fees_note, eligibility, effective_from, effective_to, active, id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(...vals, pid, ts, ts);
  }
  return getProduct(db, pid)!;
}

// ------------------------------------------------------------------ orders --
export interface Order {
  id: string;
  orderNo: string;
  leadId: string;
  leadName: string;
  opportunityId: string;
  repId: string | null;
  category: OrderCategory;
  providerId: string;
  providerName: string;
  productId: string | null;
  productName: string;
  monthlyPriceCents: number | null;
  submissionChannel: string;
  externalRef: string;
  status: OrderStatus;
  submittedAt: string | null;
  activatedAt: string | null;
  completedAt: string | null;
  cancellationReason: string;
  providerConfirmed: boolean;
  version: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
const ORDER_SELECT = `SELECT o.*, TRIM(l.first_name || ' ' || l.last_name) AS lead_name, p.name AS provider_name FROM orders o JOIN leads l ON l.id = o.lead_id JOIN providers p ON p.id = o.provider_id`;
const toOrder = (r: Row): Order => ({
  id: r.id as string,
  orderNo: r.order_no as string,
  leadId: r.lead_id as string,
  leadName: r.lead_name as string,
  opportunityId: r.opportunity_id as string,
  repId: (r.rep_id as string) ?? null,
  category: r.category as OrderCategory,
  providerId: r.provider_id as string,
  providerName: r.provider_name as string,
  productId: (r.product_id as string) ?? null,
  productName: r.product_name as string,
  monthlyPriceCents: num(r.monthly_price_cents),
  submissionChannel: r.submission_channel as string,
  externalRef: r.external_ref as string,
  status: r.status as OrderStatus,
  submittedAt: (r.submitted_at as string) ?? null,
  activatedAt: (r.activated_at as string) ?? null,
  completedAt: (r.completed_at as string) ?? null,
  cancellationReason: r.cancellation_reason as string,
  providerConfirmed: !!r.provider_confirmed,
  version: r.version as number,
  createdBy: r.created_by as string,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});
export function getOrder(db: DB, id: string): Order | null {
  const r = db.prepare(`${ORDER_SELECT} WHERE o.id = ?`).get(id) as Row | undefined;
  return r ? toOrder(r) : null;
}
export interface OrderFilter {
  leadId?: string;
  status?: string;
  /** Scope: orders credited to these people. */
  repIds?: string[];
  limit?: number;
  offset?: number;
}
export function listOrders(db: DB, f: OrderFilter = {}): { orders: Order[]; total: number } {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (f.leadId) {
    where.push('o.lead_id = ?');
    params.push(f.leadId);
  }
  if (f.status) {
    where.push('o.status = ?');
    params.push(f.status);
  }
  if (f.repIds) {
    where.push(`o.rep_id IN (${marks(f.repIds.length) || "''"})`);
    params.push(...f.repIds);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM orders o ${clause}`).get(...params) as { n: number };
  const rows = db.prepare(`${ORDER_SELECT} ${clause} ORDER BY o.created_at DESC LIMIT ? OFFSET ?`).all(...params, Math.min(f.limit ?? 50, 200), f.offset ?? 0) as Row[];
  return { orders: rows.map(toOrder), total: n };
}
export interface OrderEvent {
  id: string;
  from: string;
  to: string;
  note: string;
  evidence: string;
  actor: string;
  createdAt: string;
}
export function listOrderEvents(db: DB, orderId: string): OrderEvent[] {
  return (db.prepare('SELECT * FROM order_events WHERE order_id = ? ORDER BY created_at, rowid').all(orderId) as Row[]).map((r) => ({
    id: r.id as string,
    from: r.from_status as string,
    to: r.to_status as string,
    note: r.note as string,
    evidence: r.evidence as string,
    actor: r.actor as string,
    createdAt: r.created_at as string,
  }));
}
const addOrderEvent = (db: DB, orderId: string, from: string, to: string, note: string, evidence: string, actor: string) =>
  db.prepare('INSERT INTO order_events (id, order_id, from_status, to_status, note, evidence, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), orderId, from, to, note, evidence, actor, now());

export class OrderError extends Error {}

export interface NewOrder {
  opportunityId: string;
  repId: string | null;
  category: OrderCategory;
  providerId: string;
  productId: string | null;
  productName: string;
  monthlyPriceCents: number | null;
  idempotencyKey: string | null;
  createdBy: string;
}
/**
 * Start an order for an accepted opportunity. Safe to repeat: the same
 * idempotency key returns the order it already made, and an opportunity can
 * only have one open order at a time.
 */
export function createOrder(db: DB, o: NewOrder): { order: Order; repeated: boolean } {
  return transaction(db, () => {
    if (o.idempotencyKey) {
      const same = db.prepare('SELECT id FROM orders WHERE idempotency_key = ?').get(o.idempotencyKey) as { id: string } | undefined;
      if (same) return { order: getOrder(db, same.id)!, repeated: true };
    }
    const opp = repo.getOpportunity(db, o.opportunityId);
    if (!opp) throw new OrderError('Opportunity not found.');
    const open = db.prepare(`SELECT order_no FROM orders WHERE opportunity_id = ? AND status IN (${marks(OPEN_ORDER_STATUSES.length)}) LIMIT 1`).get(o.opportunityId, ...OPEN_ORDER_STATUSES) as { order_no: string } | undefined;
    if (open) throw new OrderError(`This opportunity already has an open order (${open.order_no}).`);
    const id = randomUUID();
    const ts = now();
    const { n } = db.prepare('SELECT COUNT(*) AS n FROM orders').get() as { n: number };
    db.prepare(
      `INSERT INTO orders (id, order_no, lead_id, opportunity_id, rep_id, category, provider_id, product_id, product_name, monthly_price_cents, status, idempotency_key, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)`,
    ).run(id, `T-${100001 + n}`, opp.leadId, opp.id, o.repId, o.category, o.providerId, o.productId, o.productName, o.monthlyPriceCents, o.idempotencyKey, o.createdBy, ts, ts);
    addOrderEvent(db, id, '', 'draft', 'Order started', '', o.createdBy);
    repo.setOpportunityStage(db, opp.id, 'order_pending', o.createdBy);
    return { order: getOrder(db, id)!, repeated: false };
  });
}

/** How and where the order was placed with the provider. Only while it has not been submitted. */
export function setOrderSubmission(db: DB, id: string, s: { submissionChannel: string; externalRef: string; monthlyPriceCents: number | null }): Order {
  const o = getOrder(db, id);
  if (!o) throw new OrderError('Order not found.');
  if (!['draft', 'awaiting_qualification', 'ready', 'failed'].includes(o.status)) throw new OrderError('Submission details can only be changed before the order is submitted.');
  try {
    db.prepare('UPDATE orders SET submission_channel = ?, external_ref = ?, monthly_price_cents = ?, version = version + 1, updated_at = ? WHERE id = ?').run(s.submissionChannel, s.externalRef, s.monthlyPriceCents, now(), id);
  } catch (err) {
    if (err instanceof Error && /UNIQUE constraint failed: orders.provider_id, orders.external_ref/.test(err.message)) throw new OrderError('Another order already uses that provider reference.');
    throw err;
  }
  return getOrder(db, id)!;
}

/**
 * Move an order to a new status. The caller has already checked the move is
 * allowed for the person making it. `expectedVersion` stops two people
 * overwriting each other: if the order changed meanwhile, nothing happens.
 */
export function moveOrder(db: DB, id: string, to: OrderStatus, m: { note: string; evidence: string; actor: string; expectedVersion: number }): Order {
  return transaction(db, () => {
    const o = getOrder(db, id);
    if (!o) throw new OrderError('Order not found.');
    if (o.version !== m.expectedVersion) throw new OrderError('This order was changed by someone else. Reload and try again.');
    const ts = now();
    const stamp = to === 'submitted' ? 'submitted_at' : to === 'activated' ? 'activated_at' : to === 'completed' ? 'completed_at' : null;
    db.prepare(
      `UPDATE orders SET status = ?, version = version + 1, updated_at = ?, cancellation_reason = CASE WHEN ? <> '' THEN ? ELSE cancellation_reason END,
         provider_confirmed = CASE WHEN ? = 1 THEN 1 ELSE provider_confirmed END ${stamp ? `, ${stamp} = COALESCE(${stamp}, ?)` : ''} WHERE id = ?`,
    ).run(...[to, ts, ['rejected', 'canceled', 'failed', 'reversed'].includes(to) ? m.note : '', m.note, ['activated', 'completed'].includes(to) ? 1 : 0, ...(stamp ? [ts] : []), id]);
    addOrderEvent(db, id, o.status, to, m.note, m.evidence, m.actor);
    repo.setOpportunityStage(db, o.opportunityId, stageForOrder(to), m.actor);
    return getOrder(db, id)!;
  });
}

// --------------------------------------------------------------- reporting --
interface Range {
  from: string;
  to: string;
}
const inList = (ids: string[] | null, col: string) => (ids === null ? { sql: '', args: [] as string[] } : { sql: ` AND ${col} IN (${marks(ids.length) || "''"})`, args: ids });

/**
 * A representative's (or a group's) numbers. Definitions:
 *  - assigned: open leads assigned now;  newLeads: leads assigned during the period
 *  - followUpsDue: open tasks due by now;  appointments: scheduled appointments from now on
 *  - ordersSubmitted / activations / cancellations: orders whose submission, activation or cancellation happened in the period
 *  - pendingActivations: orders with the provider now;  atRisk: failed orders, or with the provider for more than 14 days
 */
export function workMetrics(db: DB, repIds: string[] | null, p: Range, at = new Date()) {
  const lead = inList(repIds, 'assigned_rep_id');
  const ord = inList(repIds, 'rep_id');
  const task = inList(repIds, 'assignee_id');
  const one = (sql: string, ...args: (string | number)[]) => (db.prepare(sql).get(...args) as { n: number }).n ?? 0;
  const nowIso = at.toISOString();
  const pending = ['submitted', 'provider_pending', 'installation_scheduled', 'activation_pending'];
  return {
    assigned: one(`SELECT COUNT(*) AS n FROM leads WHERE status IN (${marks(OPEN_LEAD_STATUSES.length)})${repIds === null ? ' AND assigned_rep_id IS NOT NULL' : lead.sql}`, ...OPEN_LEAD_STATUSES, ...lead.args),
    newLeads: one(`SELECT COUNT(*) AS n FROM leads WHERE assigned_at >= ? AND assigned_at < ?${lead.sql}`, p.from, p.to, ...lead.args),
    uncontacted: one(`SELECT COUNT(*) AS n FROM leads WHERE status IN ('new','assigned') AND first_contact_at IS NULL${repIds === null ? '' : lead.sql}`, ...lead.args),
    followUpsDue: one(`SELECT COUNT(*) AS n FROM tasks WHERE done_at IS NULL AND due_at <= ?${task.sql}`, nowIso, ...task.args),
    appointments: one(`SELECT COUNT(*) AS n FROM appointments a JOIN leads l ON l.id = a.lead_id WHERE a.status = 'scheduled' AND a.start_utc >= ?${inList(repIds, 'l.assigned_rep_id').sql}`, nowIso, ...lead.args),
    ordersSubmitted: one(`SELECT COUNT(*) AS n FROM orders WHERE submitted_at >= ? AND submitted_at < ?${ord.sql}`, p.from, p.to, ...ord.args),
    activations: one(`SELECT COUNT(*) AS n FROM orders WHERE activated_at >= ? AND activated_at < ?${ord.sql}`, p.from, p.to, ...ord.args),
    cancellations: one(`SELECT COUNT(*) AS n FROM orders WHERE status IN ('canceled','rejected','reversed') AND updated_at >= ? AND updated_at < ?${ord.sql}`, p.from, p.to, ...ord.args),
    pendingActivations: one(`SELECT COUNT(*) AS n FROM orders WHERE status IN (${marks(pending.length)})${ord.sql}`, ...pending, ...ord.args),
    atRisk: one(`SELECT COUNT(*) AS n FROM orders WHERE (status = 'failed' OR (status IN (${marks(pending.length)}) AND submitted_at < ?))${ord.sql}`, ...pending, new Date(at.getTime() - 14 * 86_400_000).toISOString(), ...ord.args),
  };
}

/** One row per person for a manager: the same definitions as `workMetrics`, plus response time. */
export function teamPerformance(db: DB, repIds: string[] | null, p: Range) {
  const members = repo.listReps(db).filter((r) => (repIds === null ? r.role === 'rep' || r.role === 'manager' : repIds.includes(r.id)));
  return members.map((m) => {
    const w = workMetrics(db, [m.id], p);
    const r = db
      .prepare(
        `SELECT SUM(CASE WHEN first_contact_at IS NOT NULL THEN 1 ELSE 0 END) AS contacted,
                AVG(CASE WHEN first_contact_at IS NOT NULL AND assigned_at IS NOT NULL THEN (julianday(first_contact_at) - julianday(assigned_at)) * 1440 END) AS response
         FROM leads WHERE assigned_rep_id = ? AND assigned_at >= ? AND assigned_at < ?`,
      )
      .get(m.id, p.from, p.to) as { contacted: number | null; response: number | null };
    return { id: m.id, name: m.name, repCode: m.repCode, status: m.status, accepting: m.accepting, openLeads: m.openLeads, ...w, contacted: r.contacted ?? 0, avgMinutesToContact: r.response === null ? null : Math.max(0, Math.round(r.response)) };
  });
}

/**
 * The business overview for a period. Every figure counts whole leads or whole
 * orders once (a household with three orders is one lead and three orders).
 */
export function businessOverview(db: DB, p: Range) {
  const one = (sql: string, ...args: (string | number)[]) => (db.prepare(sql).get(...args) as { n: number | null }).n ?? 0;
  const range = [p.from, p.to];
  const leads = one('SELECT COUNT(*) AS n FROM leads WHERE created_at >= ? AND created_at < ?', ...range);
  const qualified = one(
    `SELECT COUNT(*) AS n FROM leads WHERE created_at >= ? AND created_at < ? AND (status IN ('qualified','sold','install_scheduled','installed')
       OR EXISTS (SELECT 1 FROM lead_history h WHERE h.lead_id = leads.id AND h.kind = 'status' AND h.to_value = 'qualified'))`,
    ...range,
  );
  const converted = one("SELECT COUNT(*) AS n FROM leads WHERE created_at >= ? AND created_at < ? AND EXISTS (SELECT 1 FROM orders o WHERE o.lead_id = leads.id AND o.status IN ('activated','completed'))", ...range);
  const submitted = one('SELECT COUNT(*) AS n FROM orders WHERE submitted_at >= ? AND submitted_at < ?', ...range);
  const activated = one('SELECT COUNT(*) AS n FROM orders WHERE activated_at >= ? AND activated_at < ?', ...range);
  const fellThrough = one("SELECT COUNT(*) AS n FROM orders WHERE submitted_at >= ? AND submitted_at < ? AND status IN ('canceled','rejected','reversed')", ...range);
  const bySource = db
    .prepare(
      `SELECT COALESCE(NULLIF(utm_source, ''), source) AS source, COUNT(*) AS leads,
              SUM(CASE WHEN EXISTS (SELECT 1 FROM orders o WHERE o.lead_id = leads.id AND o.submitted_at IS NOT NULL) THEN 1 ELSE 0 END) AS withOrder,
              SUM(CASE WHEN EXISTS (SELECT 1 FROM orders o WHERE o.lead_id = leads.id AND o.status IN ('activated','completed')) THEN 1 ELSE 0 END) AS activated
       FROM leads WHERE created_at >= ? AND created_at < ? GROUP BY 1 ORDER BY leads DESC LIMIT 12`,
    )
    .all(...range) as { source: string; leads: number; withOrder: number; activated: number }[];
  const byCategory = db
    .prepare(
      `SELECT category, COUNT(*) AS orders, SUM(CASE WHEN status IN ('activated','completed') THEN 1 ELSE 0 END) AS activated
       FROM orders WHERE created_at >= ? AND created_at < ? GROUP BY category ORDER BY orders DESC`,
    )
    .all(...range) as { category: string; orders: number; activated: number }[];
  const byProvider = db
    .prepare(
      `SELECT p.name AS provider, COUNT(*) AS orders, SUM(CASE WHEN o.status IN ('activated','completed') THEN 1 ELSE 0 END) AS activated
       FROM orders o JOIN providers p ON p.id = o.provider_id WHERE o.created_at >= ? AND o.created_at < ? GROUP BY p.name ORDER BY orders DESC LIMIT 12`,
    )
    .all(...range) as { provider: string; orders: number; activated: number }[];
  const perDay = db
    .prepare('SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS leads FROM leads WHERE created_at >= ? AND created_at < ? GROUP BY 1 ORDER BY 1')
    .all(...range) as { day: string; leads: number }[];
  const nowIso = now();
  return {
    leads: { total: leads, qualified, converted, conversionBps: leads ? Math.round((converted * 10_000) / leads) : null, bySource, perDay },
    orders: { submitted, activated, fellThrough, cancellationBps: submitted ? Math.round((fellThrough * 10_000) / submitted) : null, byCategory, byProvider },
    people: { active: one("SELECT COUNT(*) AS n FROM representatives WHERE status = 'active' AND role IN ('rep','manager')"), accepting: one("SELECT COUNT(*) AS n FROM representatives WHERE status = 'active' AND accepting = 1") },
    exceptions: {
      unassignedLeads: one(`SELECT COUNT(*) AS n FROM leads WHERE assigned_rep_id IS NULL AND status IN (${marks(OPEN_LEAD_STATUSES.length)})`, ...OPEN_LEAD_STATUSES),
      staleLeads: one(`SELECT COUNT(*) AS n FROM leads WHERE status IN ('new','assigned') AND first_contact_at IS NULL AND created_at < ?`, new Date(Date.now() - 48 * 3_600_000).toISOString()),
      overdueFollowUps: one('SELECT COUNT(*) AS n FROM tasks WHERE done_at IS NULL AND due_at < ?', nowIso),
      failedOrders: one("SELECT COUNT(*) AS n FROM orders WHERE status = 'failed'"),
      failedAlerts: one("SELECT COUNT(*) AS n FROM notifications WHERE status = 'failed'"),
    },
  };
}
