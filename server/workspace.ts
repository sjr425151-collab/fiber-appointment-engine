/**
 * Agent Workspace API (mounted on the signed-in team router under /api/admin).
 *
 * Roles (server-enforced on every route):
 *  - rep: only leads assigned to them; their own follow-ups.
 *  - manager: every lead; can reassign, reopen, lift Do Not Contact and confirm wins.
 *  - admin (owner account): everything a manager can, plus configuration elsewhere.
 * Every change is recorded on the lead's timeline with who made it.
 */
import type express from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import { BEST_TIMES } from '../shared/platform/handoff';
import { CONTACT_METHODS, leadInputSchema, type Lead } from '../shared/schemas';
import {
  applyDisposition,
  CONTACT_TASKS,
  DISPOSITION_LABEL,
  DISPOSITIONS,
  KPI_DEFINITIONS,
  NOTE_CATEGORIES,
  needsFollowUpTime,
  QUEUES,
  reopenStatus,
  TASK_KIND_LABEL,
  TASK_KINDS,
  TASK_PRIORITIES,
  validTimeZone,
  type WorkRole,
} from '../shared/team/workspace';
import type { DB } from './db';
import * as repo from './repo';
import { listNotifications, markNotificationsRead } from './repo-team';
import * as ws from './repo-workspace';

z.config({ jitless: true });

export class WorkError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export interface WorkDeps {
  db: DB;
  parse: <T extends z.ZodType>(schema: T, data: unknown) => z.output<T>;
}

/** The signed-in person's workspace role. The owner account from the environment is the admin. */
export const workRole = (req: Request): WorkRole => (!req.rep ? 'admin' : req.rep.role === 'manager' || req.rep.role === 'admin' ? 'manager' : 'rep');
/** Lead owners the person may see: null means every lead. */
export const ownerScope = (req: Request): string[] | null => (workRole(req) === 'rep' ? [req.rep!.id] : null);
/** Who an action is attributed to: a representative's name, or the owner account's email. */
export const actorName = (req: Request) => (req.rep ? req.rep.name : req.session!.email);
/** Identity used for task ownership and note authorship checks. */
const meId = (req: Request) => (req.rep ? req.rep.id : 'owner');
const isManager = (req: Request) => workRole(req) !== 'rep';

const requestId = z.string().uuid().optional();
const tz = z.string().trim().max(60).refine(validTimeZone, 'Unknown time zone');
const isoTime = z.string().datetime({ offset: true });
const followUpSchema = z.object({
  kind: z.enum(TASK_KINDS).default('general'),
  title: z.string().trim().min(1).max(120).optional(),
  dueAt: isoTime,
  timeZone: tz,
  priority: z.enum(TASK_PRIORITIES).default('normal'),
  notes: z.string().trim().max(1000).default(''),
});
const optText = (max: number) => z.string().trim().max(max);
const contactSchema = z
  .object({
    version: z.number().int().min(1),
    requestId,
    firstName: leadInputSchema.shape.firstName.optional(),
    lastName: optText(60).optional(),
    preferredName: optText(60).optional(),
    phone: leadInputSchema.shape.phone.optional(),
    email: z.union([z.literal(''), z.string().trim().toLowerCase().email('Enter a valid email').max(254)]).optional(),
    street: optText(120).optional(),
    unit: optText(30).optional(),
    city: optText(60).optional(),
    zip: leadInputSchema.shape.zip.optional(),
    preferredContact: z.enum(CONTACT_METHODS).optional(),
    bestTime: z.enum(BEST_TIMES).optional(),
    householdNotes: optText(2000).optional(),
    currentProvider: optText(80).optional(),
  })
  .strict();
const money = z.number().int().min(0).max(1_000_000).nullable();
const serviceSchema = z
  .object({
    provider: optText(80).default(''),
    monthlyCents: money.default(null),
    plan: optText(120).default(''),
    concerns: optText(1000).default(''),
    details: z
      .object({
        lines: z.number().int().min(1).max(20).optional(),
        devicePaymentsCents: money.optional(),
        mustHave: optText(300).optional(),
        services: optText(300).optional(),
        usageKwh: z.number().int().min(0).max(100_000).optional(),
        ownsHome: z.boolean().optional(),
        solarInterest: z.enum(['', 'yes', 'maybe', 'no']).optional(),
        qualificationNotes: optText(500).optional(),
      })
      .strict()
      .default({}),
  })
  .strict();

export function workspaceRoutes(r: express.Router, d: WorkDeps) {
  const { db, parse } = d;

  /** A lead the person may work on; anything else looks missing. */
  const leadFor = (req: Request, id: string): Lead => {
    const lead = repo.getLead(db, id);
    const scope = ownerScope(req);
    if (!lead || (scope && !scope.includes(lead.assignedRepId ?? ''))) throw new WorkError(404, 'Lead not found.');
    return lead;
  };
  const managerOnly = (req: Request) => {
    if (!isManager(req)) throw new WorkError(403, 'A manager or admin does this.');
  };
  const taskFor = (req: Request, id: string) => {
    const t = ws.getTask(db, id);
    if (!t) throw new WorkError(404, 'Follow-up not found.');
    leadFor(req, t.leadId);
    if (!isManager(req) && t.assigneeId !== meId(req)) throw new WorkError(404, 'Follow-up not found.');
    return t;
  };
  const noteFor = (req: Request, id: string, edit: boolean) => {
    const n = ws.getNote(db, id);
    if (!n || n.kind !== 'note' || n.archivedAt) throw new WorkError(404, 'Note not found.');
    leadFor(req, n.leadId);
    // Representatives may change their own notes; managers and admins any note.
    if (edit && !isManager(req) && n.author !== actorName(req)) throw new WorkError(403, 'Only the author or a manager can change this note.');
    return n;
  };
  const viewerTz = (req: Request) => {
    const t = typeof req.query.tz === 'string' && validTimeZone(req.query.tz) ? req.query.tz : 'America/New_York';
    return t;
  };

  // ---------------------------------------------------------------- overview
  r.get('/work/overview', (req, res) => {
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);
    const scope = ownerScope(req);
    const zone = viewerTz(req);
    const at = new Date();
    const tasks = ws.bucketTasks(ws.listTasks(db, { assigneeIds: scope ?? (req.rep ? [req.rep.id] : null), open: true, limit: 200 }), at, zone);
    res.json({
      role: workRole(req),
      ...ws.overview(db, scope, zone, days, at),
      definitions: KPI_DEFINITIONS,
      nextActions: ws.nextActions(db, scope, at),
      tasks: { overdue: tasks.overdue.slice(0, 10), today: tasks.today.slice(0, 10) },
      notifications: req.rep ? listNotifications(db, req.rep.id, 10) : { items: [], unread: 0 },
    });
  });

  // ------------------------------------------------------------------ queues
  const listQuery = z.object({
    queue: z.enum(QUEUES.map((q) => q.id) as [string, ...string[]]).optional(),
    q: z.string().trim().max(100).optional(),
    sort: z.enum(['newest', 'oldest', 'activity', 'followup']).optional(),
    stage: z.string().trim().max(40).optional(),
    disposition: z.string().trim().max(40).optional(),
    qualification: z.string().trim().max(40).optional(),
    source: z.string().trim().max(40).optional(),
    owner: z.string().trim().max(40).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    tz: z.string().optional(),
  });
  r.get('/work/leads', (req, res) => {
    const f = parse(listQuery, req.query);
    if (f.queue === 'unassigned') managerOnly(req);
    const { tz: _tz, ...rest } = f;
    const scope = ownerScope(req);
    res.json(ws.listWorkLeads(db, { ...rest, queue: rest.queue as never, owner: scope ? undefined : rest.owner, ownerIds: scope, dueBefore: ws.endOfLocalDay(new Date(), viewerTz(req)) }));
  });

  r.post('/work/bulk-assign', (req, res) => {
    managerOnly(req);
    const b = parse(z.object({ leadIds: z.array(z.string().uuid()).min(1).max(200), repId: z.union([z.string().uuid(), z.null()]) }).strict(), req.body);
    const rep = b.repId ? repo.getRep(db, b.repId) : null;
    if (b.repId && !rep?.active) throw new WorkError(400, 'Choose an active representative.');
    const results = b.leadIds.map((id) => {
      const lead = repo.getLead(db, id);
      if (!lead) return { id, ok: false, error: 'Not found' };
      if (lead.assignedRepId === b.repId) return { id, ok: true, unchanged: true };
      repo.assignLead(db, id, b.repId, { outcome: b.repId ? 'assigned' : 'queued', reason: 'Manual bulk assignment', actor: actorName(req) });
      return { id, ok: true };
    });
    res.json({ results, ok: results.filter((x) => x.ok).length, failed: results.filter((x) => !x.ok).length });
  });

  // ---------------------------------------------------------------- profile
  r.get('/leads/:id/workspace', (req, res) => {
    const lead = leadFor(req, String(req.params.id));
    const manager = isManager(req);
    const reps = manager ? repo.listReps(db).filter((x) => x.active) : [];
    res.json({
      lead,
      timeline: ws.timeline(db, lead),
      notes: repo.listNotes(db, lead.id).filter((n) => n.kind === 'note'),
      tasks: ws.listTasks(db, { leadId: lead.id, limit: 100 }),
      services: ws.listServices(db, lead.id),
      duplicates: ws.possibleDuplicates(db, lead, ownerScope(req)),
      me: { role: workRole(req), name: actorName(req), id: meId(req) },
      can: { reassign: manager, verifyWins: manager, reopen: manager, clearDnc: manager, editAnyNote: manager },
      representatives: manager ? reps.map((x) => ({ id: x.id, name: x.name, openLeads: x.openLeads, accepting: x.accepting })) : undefined,
    });
  });

  const dispositionSchema = z
    .object({
      code: z.enum(DISPOSITIONS as [string, ...string[]]),
      reason: optText(500).default(''),
      evidence: optText(200).default(''),
      followUp: followUpSchema.optional(),
      requestId,
    })
    .strict();
  r.post('/leads/:id/disposition', (req, res) => {
    const b = parse(dispositionSchema, req.body);
    const lead = leadFor(req, String(req.params.id));
    if (ws.seenRequest(db, lead.id, b.requestId)) {
      res.json({ lead, repeat: true });
      return;
    }
    const code = b.code as (typeof DISPOSITIONS)[number];
    const result = applyDisposition({ status: lead.status, qualification: lead.qualification as never, outcome: lead.outcome as never, doNotContact: lead.doNotContact }, code, {
      role: workRole(req),
      evidence: b.evidence,
      reason: b.reason,
    });
    if (!result.ok) throw new WorkError(400, result.error);
    if (needsFollowUpTime(code) && !b.followUp) throw new WorkError(400, 'Choose a date and time for the next step.', { field: 'followUp' });
    const blocksContact = lead.doNotContact || !!result.changes.doNotContact;
    if (b.followUp && blocksContact && CONTACT_TASKS.includes(b.followUp.kind)) throw new WorkError(400, 'This customer asked not to be contacted, so a call or message cannot be scheduled.');
    const updated = ws.recordDisposition(db, lead, { code, label: DISPOSITION_LABEL[code], changes: result.changes, reason: b.reason, evidence: b.evidence, actor: actorName(req), requestId: b.requestId });
    let task = null;
    if (b.followUp) {
      const kind = b.followUp.kind;
      task = ws.createTask(db, {
        leadId: lead.id,
        assigneeId: lead.assignedRepId ?? meId(req),
        kind,
        title: b.followUp.title || result.suggestion?.title || TASK_KIND_LABEL[kind],
        priority: b.followUp.priority,
        notes: b.followUp.notes,
        dueAt: new Date(b.followUp.dueAt).toISOString(),
        timeZone: b.followUp.timeZone,
        actor: actorName(req),
      });
    }
    res.json({ lead: repo.getLead(db, updated.id), task, followUp: result.followUp, suggestion: result.suggestion });
  });

  r.post('/leads/:id/reopen', (req, res) => {
    managerOnly(req);
    const b = parse(z.object({ reason: z.string().trim().min(3, 'Say why it is being reopened').max(500), requestId }).strict(), req.body);
    const lead = leadFor(req, String(req.params.id));
    if (!lead.outcome) throw new WorkError(400, 'This lead is not closed.');
    if (ws.seenRequest(db, lead.id, b.requestId)) {
      res.json({ lead, repeat: true });
      return;
    }
    res.json({ lead: ws.reopenLead(db, lead, reopenStatus(lead.firstContactAt, !!lead.assignedRepId), b.reason, actorName(req), b.requestId) });
  });

  r.post('/leads/:id/dnc/clear', (req, res) => {
    managerOnly(req);
    const b = parse(z.object({ reason: z.string().trim().min(10, 'Record how the customer gave permission again').max(500), requestId }).strict(), req.body);
    const lead = leadFor(req, String(req.params.id));
    if (!lead.doNotContact) throw new WorkError(400, 'This lead is not marked Do Not Contact.');
    res.json({ lead: ws.clearDoNotContact(db, lead, b.reason, actorName(req), b.requestId) });
  });

  r.patch('/leads/:id/contact', (req, res) => {
    const b = parse(contactSchema, req.body);
    const lead = leadFor(req, String(req.params.id));
    if (ws.seenRequest(db, lead.id, b.requestId)) {
      res.json({ lead, changed: [], repeat: true });
      return;
    }
    const { version, requestId: rid, ...fields } = b;
    const nextContact = fields.preferredContact ?? lead.preferredContact;
    const nextEmail = fields.email ?? lead.email;
    if (nextContact === 'email' && !nextEmail) throw new WorkError(400, 'Add an email address, or choose phone or text.', { field: 'email' });
    const r2 = ws.updateContact(db, lead.id, version, fields, actorName(req), rid);
    if (!r2.ok) throw new WorkError(409, 'Someone else changed this lead while you were editing. Review their changes, then save again.', { lead: r2.lead });
    res.json({ lead: r2.lead, changed: r2.changed });
  });

  r.put('/leads/:id/services/:category', (req, res) => {
    const category = z.enum(['internet', 'mobile', 'tv', 'electricity', 'security']).parse(req.params.category);
    const b = parse(serviceSchema, req.body);
    const lead = leadFor(req, String(req.params.id));
    ws.saveService(db, lead.id, { category, ...b, details: b.details as Record<string, unknown> }, actorName(req));
    res.json({ services: ws.listServices(db, lead.id), lead: repo.getLead(db, lead.id) });
  });

  // ------------------------------------------------------------------ notes
  r.post('/leads/:id/notes', (req, res) => {
    const b = parse(z.object({ body: z.string().trim().min(1, 'Write a note first').max(4000), category: z.enum(NOTE_CATEGORIES).default('general'), pinned: z.boolean().default(false), requestId }).strict(), req.body);
    const lead = leadFor(req, String(req.params.id));
    if (!ws.seenRequest(db, lead.id, b.requestId)) {
      const note = repo.addNote(db, lead.id, b.body, actorName(req), { category: b.category, pinned: b.pinned });
      // Marks the request as applied (the note itself is what the timeline shows).
      ws.addEvent(db, { leadId: lead.id, kind: 'note_request', code: note.id, title: 'Note added', actor: actorName(req), requestId: b.requestId });
    }
    res.status(201).json({ notes: repo.listNotes(db, lead.id).filter((n) => n.kind === 'note') });
  });
  r.patch('/notes/:id', (req, res) => {
    const b = parse(z.object({ body: z.string().trim().min(1).max(4000).optional(), category: z.enum(NOTE_CATEGORIES).optional(), pinned: z.boolean().optional() }).strict(), req.body);
    const editing = b.body !== undefined || b.category !== undefined;
    let n = noteFor(req, String(req.params.id), editing);
    if (editing && (b.body !== n.body || b.category !== n.category)) n = ws.editNote(db, n, b.body ?? n.body, b.category ?? n.category, actorName(req));
    if (b.pinned !== undefined && b.pinned !== n.pinned) n = ws.pinNote(db, n, b.pinned, actorName(req));
    res.json({ note: n, notes: repo.listNotes(db, n.leadId).filter((x) => x.kind === 'note') });
  });
  r.post('/notes/:id/archive', (req, res) => {
    const n = noteFor(req, String(req.params.id), true);
    ws.archiveNote(db, n, actorName(req));
    res.json({ notes: repo.listNotes(db, n.leadId).filter((x) => x.kind === 'note') });
  });

  // ------------------------------------------------------------------ tasks
  r.post('/leads/:id/tasks', (req, res) => {
    const b = parse(followUpSchema.extend({ requestId }).strict(), req.body);
    const lead = leadFor(req, String(req.params.id));
    if (lead.doNotContact && CONTACT_TASKS.includes(b.kind)) throw new WorkError(400, 'This customer asked not to be contacted, so a call or message cannot be scheduled.');
    if (lead.outcome) throw new WorkError(400, 'This lead is closed. Reopen it before scheduling follow-ups.');
    if (new Date(b.dueAt).getTime() < Date.now() - 86_400_000) throw new WorkError(400, 'Choose a time that has not passed.', { field: 'dueAt' });
    if (ws.seenRequest(db, lead.id, b.requestId)) {
      res.json({ tasks: ws.listTasks(db, { leadId: lead.id }), lead, repeat: true });
      return;
    }
    ws.createTask(db, {
      leadId: lead.id,
      assigneeId: lead.assignedRepId ?? meId(req),
      kind: b.kind,
      title: b.title || TASK_KIND_LABEL[b.kind],
      priority: b.priority,
      notes: b.notes,
      dueAt: new Date(b.dueAt).toISOString(),
      timeZone: b.timeZone,
      actor: actorName(req),
      requestId: b.requestId,
    });
    res.status(201).json({ tasks: ws.listTasks(db, { leadId: lead.id }), lead: repo.getLead(db, lead.id) });
  });
  r.get('/work/tasks', (req, res) => {
    const zone = viewerTz(req);
    const assignee = typeof req.query.assignee === 'string' && req.query.assignee ? req.query.assignee : null;
    const ids = workRole(req) === 'rep' ? [req.rep!.id] : assignee ? [assignee] : null;
    const tasks = ws.listTasks(db, { assigneeIds: ids, doneSince: new Date(Date.now() - 14 * 86_400_000).toISOString(), limit: 500 });
    res.json({ buckets: ws.bucketTasks(tasks, new Date(), zone), timeZone: zone });
  });
  r.patch('/tasks/:id', (req, res) => {
    const b = parse(z.discriminatedUnion('action', [z.object({ action: z.literal('complete'), note: optText(500).default('') }), z.object({ action: z.literal('reschedule'), dueAt: isoTime, timeZone: tz })]), req.body);
    const t = taskFor(req, String(req.params.id));
    if (b.action === 'complete') {
      res.json({ task: ws.completeTask(db, t, actorName(req), b.note) });
      return;
    }
    if (t.doneAt) throw new WorkError(400, 'This follow-up is already done.');
    if (new Date(b.dueAt).getTime() < Date.now() - 60_000) throw new WorkError(400, 'Choose a time that has not passed.', { field: 'dueAt' });
    res.json({ task: ws.rescheduleTask(db, t, new Date(b.dueAt).toISOString(), b.timeZone, actorName(req)) });
  });

  // ---------------------------------------------------------- notifications
  r.get('/work/notifications', (req, res) => res.json(req.rep ? listNotifications(db, req.rep.id, 30) : { items: [], unread: 0 }));
  r.post('/work/notifications/read', (req, res) => {
    if (req.rep) markNotificationsRead(db, req.rep.id);
    res.json({ ok: true });
  });
}
