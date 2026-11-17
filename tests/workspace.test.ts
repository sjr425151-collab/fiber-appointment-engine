/**
 * Agent Workspace: the acceptance scenario end to end against the API, plus
 * disposition rules, notes, follow-ups and time zones, contact edits with
 * conflicts, roles and scope, idempotency and reassignment.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app';
import type { AppConfig } from '../server/config';
import { openDatabase, type DB } from '../server/db';
import { hashPassword } from '../server/lib/auth';
import { createNotifier } from '../server/notify';
import type { Mailer, OutgoingEmail } from '../server/notify/mailer';
import * as repo from '../server/repo';
import * as ws from '../server/repo-workspace';
import { applyDisposition, localDate, taskBucket } from '../shared/team/workspace';

process.env.NODE_ENV = 'test';

const cfg: AppConfig = {
  port: 0,
  flags: { env: 'production', platform: true, sampleData: false },
  databasePath: ':memory:',
  sessionSecret: 'x'.repeat(64),
  adminEmail: 'admin@example.com',
  adminPasswordHash: hashPassword('correct-horse-battery'),
  timezone: 'America/Detroit',
  siteUrl: 'https://trytucker.com',
  isProduction: false,
  email: { resendApiKey: '', from: 'Tucker <hello@mail.trytucker.com>', teamEmails: ['team@example.com'], dailyCustomerLimit: 80, nonProductionAllowlist: [] },
};
class TestMailer implements Mailer {
  enabled = true;
  async send(_e: OutgoingEmail) {
    return { status: 'sent' as const, providerId: 'x' };
  }
}

const H = { 'X-Requested-With': 'fetch' };
let db: DB;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDatabase(':memory:');
  app = createApp(cfg, db, { notifier: createNotifier(db, cfg, new TestMailer()) });
});

const addPerson = (name: string, email: string, role: 'rep' | 'manager' = 'rep', accepting = true) =>
  repo.createRep(db, { name, email, phone: '', active: true, accepting, markets: ['*'], categories: [], maxOpenLeads: 0, passwordHash: hashPassword('a-long-password-123'), role });
const signIn = async (email: string, password = 'a-long-password-123') => {
  const agent = request.agent(app);
  await agent.post('/api/admin/login').set(H).send({ email, password }).expect(200);
  return agent;
};
const inquiry = (extra: object = {}) =>
  request(app)
    .post('/api/platform/handoff')
    .set(H)
    .send({
      firstName: 'Dana',
      phone: '(734) 555-0177',
      zip: '48161',
      consent: true,
      bills: { internet: 9500, mobile: 19000 },
      mobileLines: 3,
      ownsHome: false,
      showExtras: false,
      requestKey: crypto.randomUUID(),
      landingPage: '/',
      sessionId: 's1',
      ...extra,
    });
const soon = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const TZ = 'America/Detroit';

describe('disposition rules', () => {
  const open = { status: 'assigned' as const, qualification: 'unknown' as const, outcome: '' as const, doNotContact: false };
  it('keeps stage, qualification and outcome separate and only moves the stage forward', () => {
    expect(applyDisposition(open, 'no_answer', { role: 'rep' })).toMatchObject({ ok: true, changes: { status: 'contact_attempted' }, followUp: 'suggested' });
    expect(applyDisposition({ ...open, status: 'qualified' }, 'no_answer', { role: 'rep' })).toMatchObject({ ok: true, changes: {} });
    expect(applyDisposition(open, 'qualified', { role: 'rep' })).toMatchObject({ ok: true, changes: { qualification: 'qualified', status: 'qualified' } });
    expect(applyDisposition(open, 'callback_requested', { role: 'rep' })).toMatchObject({ ok: true, followUp: 'required', changes: { status: 'contacted' } });
    expect(applyDisposition(open, 'do_not_contact', { role: 'rep' })).toMatchObject({ ok: true, changes: { doNotContact: true } });
  });
  it('never records a win without verification by a manager', () => {
    expect(applyDisposition(open, 'closed_won', { role: 'rep', evidence: 'ORD-1234' })).toMatchObject({ ok: false });
    expect(applyDisposition(open, 'closed_won', { role: 'manager' })).toMatchObject({ ok: false });
    expect(applyDisposition(open, 'closed_won', { role: 'manager', evidence: 'ORD-1234' })).toMatchObject({ ok: true, changes: { outcome: 'won' } });
    expect(applyDisposition(open, 'order_submitted', { role: 'rep' })).toMatchObject({ ok: false });
    expect(applyDisposition({ ...open, outcome: 'lost' }, 'interested', { role: 'manager' })).toMatchObject({ ok: false });
  });
  it('puts follow-ups in the right bucket in the viewer’s time zone, across daylight saving', () => {
    // 2026-11-01 is the US fall-back day: 23:30 local on Oct 31 in Detroit is still "Oct 31".
    expect(localDate('2026-11-01T03:30:00Z', TZ)).toBe('2026-10-31');
    expect(localDate('2026-11-01T03:30:00Z', 'UTC')).toBe('2026-11-01');
    const at = new Date('2026-11-17T15:00:00Z'); // 10:00 in Detroit
    expect(taskBucket({ dueAt: '2026-11-17T14:00:00Z', doneAt: null }, at, TZ)).toBe('overdue');
    expect(taskBucket({ dueAt: '2026-11-18T04:00:00Z', doneAt: null }, at, TZ)).toBe('today'); // 23:00 local
    expect(taskBucket({ dueAt: '2026-11-18T05:30:00Z', doneAt: null }, at, TZ)).toBe('upcoming'); // 00:30 next day local
    expect(taskBucket({ dueAt: '2026-11-17T14:00:00Z', doneAt: '2026-11-17T14:10:00Z' }, at, TZ)).toBe('completed');
  });
});

describe('acceptance scenario: website inquiry to qualified lead', () => {
  it('runs the whole representative workflow on persisted data', async () => {
    const alex = addPerson('Alex Rivera', 'alex@example.com');
    const morgan = addPerson('Morgan Lee', 'morgan@example.com', 'manager', false);
    // 1–3. Inquiry creates a lead routed to Alex's queue.
    const created = await inquiry().expect(201);
    const id = created.body.leadId as string;
    const a = await signIn('alex@example.com');
    const queue = await a.get('/api/admin/work/leads?queue=new').expect(200);
    expect(queue.body.leads.map((l: { id: string }) => l.id)).toEqual([id]);
    const notif = await a.get('/api/admin/work/notifications').expect(200);
    expect(notif.body.unread).toBe(1);

    // 4–6. Profile with everything submitted and the labelled preview.
    const p = await a.get(`/api/admin/leads/${id}/workspace`).expect(200);
    expect(p.body.lead).toMatchObject({ firstName: 'Dana', phone: '7345550177', zip: '48161', disposition: '', qualification: 'unknown', outcome: '' });
    expect(p.body.notes.some((n: { category: string }) => n.category === 'handoff')).toBe(true);
    expect(p.body.can.reassign).toBe(false);
    const detail = await a.get(`/api/admin/leads/${id}`).expect(200);
    expect(detail.body.lead.preview).toMatchObject({ illustrative: true, verified: false });

    // 8–9. Contact attempt, shown in the timeline.
    const rid = crypto.randomUUID();
    const d1 = await a.post(`/api/admin/leads/${id}/disposition`).set(H).send({ code: 'no_answer', requestId: rid }).expect(200);
    expect(d1.body.lead).toMatchObject({ disposition: 'no_answer', status: 'contact_attempted' });
    expect(d1.body.suggestion).toMatchObject({ kind: 'call' });
    // A double click is applied once.
    await a.post(`/api/admin/leads/${id}/disposition`).set(H).send({ code: 'no_answer', requestId: rid }).expect(200);
    const tl = (await a.get(`/api/admin/leads/${id}/workspace`).expect(200)).body.timeline as { type: string; title: string; actor: string }[];
    expect(tl.filter((t) => t.type === 'disposition')).toHaveLength(1);
    expect(tl.find((t) => t.type === 'disposition')).toMatchObject({ title: 'No answer', actor: 'Alex Rivera' });

    // 10–11. Internal note with author and time.
    const nr = crypto.randomUUID();
    await a.post(`/api/admin/leads/${id}/notes`).set(H).send({ body: 'Pays about $95 for internet; wants faster upload.', category: 'preferences', requestId: nr }).expect(201);
    const notes = (await a.post(`/api/admin/leads/${id}/notes`).set(H).send({ body: 'Pays about $95 for internet; wants faster upload.', category: 'preferences', requestId: nr }).expect(201)).body.notes;
    const mine = notes.filter((n: { author: string }) => n.author === 'Alex Rivera');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ category: 'preferences', pinned: false });
    expect(mine[0].createdAt).toMatch(/^\d{4}-/);

    // 12–14. Callback requested needs a time; the task lands in the follow-up queue.
    await a.post(`/api/admin/leads/${id}/disposition`).set(H).send({ code: 'callback_requested' }).expect(400);
    const cb = await a
      .post(`/api/admin/leads/${id}/disposition`)
      .set(H)
      .send({ code: 'callback_requested', followUp: { kind: 'call', dueAt: soon(1), timeZone: TZ, priority: 'high' } })
      .expect(200);
    expect(cb.body.task).toMatchObject({ kind: 'call', assigneeId: alex.id, priority: 'high', title: 'Call back (customer asked)' });
    expect(cb.body.lead.nextFollowUpAt).toBe(cb.body.task.dueAt);
    const tasks = (await a.get(`/api/admin/work/tasks?tz=${encodeURIComponent(TZ)}`).expect(200)).body.buckets;
    expect([...tasks.today, ...tasks.upcoming].map((t: { id: string }) => t.id)).toContain(cb.body.task.id);

    // 15. Callback done; 16. lead qualified.
    await a.patch(`/api/admin/tasks/${cb.body.task.id}`).set(H).send({ action: 'complete', note: 'Spoke for 10 minutes' }).expect(200);
    const again = await a.patch(`/api/admin/tasks/${cb.body.task.id}`).set(H).send({ action: 'complete' }).expect(200);
    expect(again.body.task.doneAt).toBeTruthy();
    await a.post(`/api/admin/leads/${id}/disposition`).set(H).send({ code: 'qualified' }).expect(200);
    const q = repo.getLead(db, id)!;
    expect(q).toMatchObject({ status: 'qualified', qualification: 'qualified', nextFollowUpAt: null });
    expect(q.firstContactAt).toBeTruthy();
    // A representative cannot record a win.
    await a.post(`/api/admin/leads/${id}/disposition`).set(H).send({ code: 'closed_won', evidence: 'ORD-55' }).expect(400);

    // 17. The manager sees the activity and can confirm a verified win.
    const m = await signIn('morgan@example.com');
    const mt = (await m.get(`/api/admin/leads/${id}/workspace`).expect(200)).body;
    expect(mt.can.reassign).toBe(true);
    expect(mt.timeline.filter((t: { type: string }) => t.type === 'task').length).toBeGreaterThanOrEqual(2);
    await m.post(`/api/admin/leads/${id}/disposition`).set(H).send({ code: 'closed_won', evidence: 'Provider order 88123' }).expect(200);

    // 18. Dashboard numbers come from the stored data.
    const ov = (await a.get(`/api/admin/work/overview?tz=${encodeURIComponent(TZ)}`).expect(200)).body;
    expect(ov.kpis).toMatchObject({ contacted: 1, won: 1, overdue: 0, leadToContact: 100, contactToQualified: 100, qualifiedToWon: 100 });
    expect(ov.definitions.won.definition).toMatch(/provider reference/);

    // 19. Scope: another rep sees nothing; Morgan is a manager.
    addPerson('Sam Ortiz', 'sam@example.com', 'rep', false);
    const s = await signIn('sam@example.com');
    await s.get(`/api/admin/leads/${id}/workspace`).expect(404);
    await s.get(`/api/admin/leads/${id}`).expect(404);
    await s.post(`/api/admin/leads/${id}/notes`).set(H).send({ body: 'x' }).expect(404);
    expect((await s.get('/api/admin/work/leads').expect(200)).body.total).toBe(0);
    await s.get('/api/admin/work/leads?queue=unassigned').expect(403);
    await s
      .post('/api/admin/work/bulk-assign')
      .set(H)
      .send({ leadIds: [id], repId: null })
      .expect(403);
    expect(morgan.role).toBe('manager');
  });
});

describe('profile editing, notes and safeguards', () => {
  const setup = async () => {
    const alex = addPerson('Alex Rivera', 'alex@example.com');
    const id = (await inquiry().expect(201)).body.leadId as string;
    return { alex, id, a: await signIn('alex@example.com') };
  };

  it('edits contact details with validation and stops conflicting saves', async () => {
    const { id, a } = await setup();
    const v = repo.getLead(db, id)!.version;
    await a.patch(`/api/admin/leads/${id}/contact`).set(H).send({ version: v, phone: '12' }).expect(400);
    await a.patch(`/api/admin/leads/${id}/contact`).set(H).send({ version: v, firstName: '' }).expect(400);
    await a.patch(`/api/admin/leads/${id}/contact`).set(H).send({ version: v, preferredContact: 'email' }).expect(400);
    const ok = await a.patch(`/api/admin/leads/${id}/contact`).set(H).send({ version: v, lastName: 'Brooks', email: 'dana@example.com', preferredName: 'Dee' }).expect(200);
    expect(ok.body.changed.sort()).toEqual(['email', 'lastName', 'preferredName']);
    // A second editor still holding the old version is told, and gets the current lead back.
    const stale = await a.patch(`/api/admin/leads/${id}/contact`).set(H).send({ version: v, lastName: 'Other' }).expect(409);
    expect(stale.body.lead.lastName).toBe('Brooks');
    const tl = ws.timeline(db, repo.getLead(db, id)!);
    expect(tl.find((t) => t.type === 'contact')!.detail).toMatchObject({ changes: { lastName: { from: '', to: 'Brooks' } } });
  });

  it('lets authors edit and archive notes, keeps the history, and blocks others', async () => {
    const { id, a } = await setup();
    const notes = (await a.post(`/api/admin/leads/${id}/notes`).set(H).send({ body: 'First version' }).expect(201)).body.notes;
    const noteId = notes.find((n: { body: string }) => n.body === 'First version').id;
    await a.patch(`/api/admin/notes/${noteId}`).set(H).send({ body: 'Second version', pinned: true }).expect(200);
    const n = ws.getNote(db, noteId)!;
    expect(n).toMatchObject({ body: 'Second version', pinned: true, editedBy: 'Alex Rivera' });
    const handoff = repo.listNotes(db, id).find((x) => x.category === 'handoff')!;
    await a.patch(`/api/admin/notes/${handoff.id}`).set(H).send({ body: 'rewrite' }).expect(403);
    await a.post(`/api/admin/notes/${noteId}/archive`).set(H).expect(200);
    expect(repo.listNotes(db, id).some((x) => x.id === noteId)).toBe(false);
    const archived = ws.timeline(db, repo.getLead(db, id)!).find((t) => t.title === 'Note archived')!;
    expect(archived.detail).toMatchObject({ body: 'Second version' });
    // The timeline cannot be rewritten.
    expect(() => db.prepare("UPDATE lead_events SET title = 'x'").run()).toThrow(/append-only/);
  });

  it('honours Do Not Contact and closed leads', async () => {
    const { id, a } = await setup();
    await a.post(`/api/admin/leads/${id}/disposition`).set(H).send({ code: 'do_not_contact' }).expect(200);
    await a
      .post(`/api/admin/leads/${id}/tasks`)
      .set(H)
      .send({ kind: 'call', dueAt: soon(2), timeZone: TZ })
      .expect(400);
    await a
      .post(`/api/admin/leads/${id}/tasks`)
      .set(H)
      .send({ kind: 'review_savings', dueAt: soon(2), timeZone: TZ })
      .expect(201);
    await a.post(`/api/admin/leads/${id}/dnc/clear`).set(H).send({ reason: 'Customer called in and asked us to call back' }).expect(403);
    await a.post(`/api/admin/leads/${id}/disposition`).set(H).send({ code: 'not_interested', reason: 'Happy with current provider' }).expect(200);
    expect(repo.getLead(db, id)).toMatchObject({ status: 'not_interested', outcome: 'lost' });
    await a.post(`/api/admin/leads/${id}/disposition`).set(H).send({ code: 'interested' }).expect(400);
    await a.post(`/api/admin/leads/${id}/reopen`).set(H).send({ reason: 'Changed mind' }).expect(403);
    const admin = await signIn('admin@example.com', 'correct-horse-battery');
    await admin.post(`/api/admin/leads/${id}/reopen`).set(H).send({ reason: 'Customer called back, wants a quote' }).expect(200);
    // They spoke to the customer (Not interested), so the lead returns to Contacted.
    expect(repo.getLead(db, id)).toMatchObject({ outcome: '', status: 'contacted' });
  });

  it('moves open follow-ups with the lead when it is reassigned, and notifies the new owner', async () => {
    const { alex, id, a } = await setup();
    await a
      .post(`/api/admin/leads/${id}/tasks`)
      .set(H)
      .send({ kind: 'call', dueAt: soon(3), timeZone: TZ })
      .expect(201);
    const jo = addPerson('Jo Park', 'jo@example.com', 'rep', false);
    const admin = await signIn('admin@example.com', 'correct-horse-battery');
    const bulk = await admin
      .post('/api/admin/work/bulk-assign')
      .set(H)
      .send({ leadIds: [id, crypto.randomUUID()], repId: jo.id })
      .expect(200);
    expect(bulk.body).toMatchObject({ ok: 1, failed: 1 });
    expect(ws.listTasks(db, { leadId: id, open: true }).every((t) => t.assigneeId === jo.id)).toBe(true);
    const j = await signIn('jo@example.com');
    expect((await j.get('/api/admin/work/notifications').expect(200)).body.items[0]).toMatchObject({ kind: 'lead_assigned', leadId: id });
    // Alex no longer sees the lead or its follow-up.
    await a.get(`/api/admin/leads/${id}/workspace`).expect(404);
    expect(alex.id).not.toBe(jo.id);
  });

  it('finds the lead by phone, email or id, and lists possible duplicates', async () => {
    const { id, a } = await setup();
    const second = (await inquiry({ firstName: 'Dana', requestKey: crypto.randomUUID() }).expect(201)).body.leadId;
    expect((await a.get('/api/admin/work/leads?q=555-0177').expect(200)).body.total).toBe(2);
    expect((await a.get(`/api/admin/work/leads?q=${id.slice(0, 8)}`).expect(200)).body.leads[0].id).toBe(id);
    const p = (await a.get(`/api/admin/leads/${id}/workspace`).expect(200)).body;
    expect(p.duplicates).toEqual([expect.objectContaining({ id: second, matchedOn: ['phone'] })]);
  });

  it('records service details separately from what the customer typed', async () => {
    const { id, a } = await setup();
    await a
      .put(`/api/admin/leads/${id}/services/mobile`)
      .set(H)
      .send({ provider: 'Verizon', monthlyCents: 18000, details: { lines: 3, devicePaymentsCents: 4500 }, concerns: 'Bill keeps rising' })
      .expect(200);
    await a
      .put(`/api/admin/leads/${id}/services/mobile`)
      .set(H)
      .send({ details: { hack: 1 } })
      .expect(400);
    expect(ws.listServices(db, id)[0]).toMatchObject({ category: 'mobile', provider: 'Verizon', monthlyCents: 18000, details: { lines: 3 }, updatedBy: 'Alex Rivera' });
    // The original preview snapshot is untouched.
    expect(repo.getLead(db, id)!.preview).toMatchObject({ verified: false });
  });
});
