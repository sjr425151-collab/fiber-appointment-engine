/**
 * Representative handoff: the short "Get My Exact Pricing" request, routing,
 * what a representative may see, and that nothing is ever lost or invented.
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
import { handoffSchema, previewFromBills } from '../shared/platform/handoff';
import { routeLead, type RoutableRep } from '../shared/platform/routing';
import type { Lead } from '../shared/schemas';

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
  sent: OutgoingEmail[] = [];
  fail = false;
  async send(email: OutgoingEmail) {
    if (this.fail) throw new Error('provider down');
    this.sent.push(email);
    return { status: 'sent' as const, providerId: `id-${this.sent.length}` };
  }
}

let db: DB;
let app: ReturnType<typeof createApp>;
let mailer: TestMailer;
let notifier: ReturnType<typeof createNotifier>;
beforeEach(() => {
  db = openDatabase(':memory:');
  mailer = new TestMailer();
  notifier = createNotifier(db, cfg, mailer);
  app = createApp(cfg, db, { notifier });
});

const KEY = '7b0e9a54-3f0e-4c57-9a10-1f6f1f3b7a11';
const REQUEST = {
  firstName: 'Dana',
  phone: '(734) 555-0177',
  zip: '48161',
  consent: true,
  bills: { internet: 9500, mobile: 19000, tv: 12000, electricity: 26000 },
  mobileLines: 3,
  ownsHome: true,
  showExtras: true,
  utmSource: 'facebook',
  utmCampaign: 'monroe-launch',
  clickId: 'fbclid-123',
  landingPage: '/',
  sessionId: 'sess-1',
};
const handoff = (extra: object = {}) => request(app).post('/api/platform/handoff').send({ ...REQUEST, ...extra });
const signIn = async (email = 'admin@example.com', password = 'correct-horse-battery') => {
  const agent = request.agent(app);
  await agent.post('/api/admin/login').send({ email, password }).expect(200);
  return agent;
};
const addRep = (over: Partial<repo.RepInput> = {}) =>
  repo.createRep(db, { name: 'Alex Rivera', email: 'alex@example.com', phone: '', active: true, accepting: true, markets: ['*'], categories: [], maxOpenLeads: 0, passwordHash: hashPassword('alex-password-123'), ...over });
const lead = (id: string) => repo.getLead(db, id) as Lead;
const post = { 'X-Requested-With': 'fetch' };

describe('routing rules', () => {
  const rep = (id: string, over: Partial<RoutableRep> = {}): RoutableRep => ({ id, active: true, accepting: true, markets: ['*'], categories: [], maxOpenLeads: 0, openLeads: 0, lastAssignedAt: null, ...over });
  const input = { marketId: 'monroe', categories: ['internet' as const], existingOwnerId: null };

  it('gives the lead to the matching representative with the fewest open leads, and breaks ties the same way every time', () => {
    expect(routeLead(input, [rep('a', { openLeads: 3 }), rep('b', { openLeads: 1 })])).toEqual({ outcome: 'assigned', repId: 'b', reason: 'least_loaded' });
    // Same load: whoever was assigned longest ago; then by id.
    expect(routeLead(input, [rep('a', { lastAssignedAt: '2026-11-17T10:00:00Z' }), rep('b', { lastAssignedAt: '2026-11-16T10:00:00Z' })])).toMatchObject({ repId: 'b' });
    expect(routeLead(input, [rep('b'), rep('a')])).toMatchObject({ repId: 'a' });
    expect(routeLead(input, [rep('a'), rep('b')])).toMatchObject({ repId: 'a' });
  });

  it('respects location, service, availability and workload', () => {
    expect(routeLead(input, [rep('a', { markets: ['toledo'] })])).toEqual({ outcome: 'queued', reason: 'no_match' });
    expect(routeLead(input, [rep('a', { categories: ['electricity'] })])).toEqual({ outcome: 'queued', reason: 'no_match' });
    expect(routeLead(input, [rep('a', { accepting: false })])).toEqual({ outcome: 'queued', reason: 'none_accepting' });
    expect(routeLead(input, [rep('a', { maxOpenLeads: 2, openLeads: 2 })])).toEqual({ outcome: 'queued', reason: 'at_capacity' });
    expect(routeLead(input, [rep('a', { active: false })])).toEqual({ outcome: 'queued', reason: 'no_representatives' });
    expect(routeLead(input, [])).toEqual({ outcome: 'queued', reason: 'no_representatives' });
  });

  it('keeps a household with the representative already helping it, and never assigns an unserved ZIP', () => {
    expect(routeLead({ ...input, existingOwnerId: 'a' }, [rep('a', { accepting: false, openLeads: 9 }), rep('b')])).toEqual({ outcome: 'assigned', repId: 'a', reason: 'existing_owner' });
    expect(routeLead({ ...input, existingOwnerId: 'gone' }, [rep('b')])).toMatchObject({ repId: 'b' });
    expect(routeLead({ ...input, marketId: null }, [rep('a')])).toEqual({ outcome: 'unsupported', reason: 'zip_not_served' });
  });
});

describe('requesting a pricing review from the preview', () => {
  it('needs only a first name, phone, ZIP and consent, and saves everything the customer already told us', async () => {
    const alex = addRep();
    const r = await handoff({ requestKey: KEY }).expect(201);
    expect(r.body).toMatchObject({ repeat: false, market: 'monroe', routing: { outcome: 'assigned', representative: null } });

    const l = lead(r.body.leadId);
    expect(l).toMatchObject({
      firstName: 'Dana', lastName: '', email: '', phone: '7345550177', zip: '48161', city: '', street: '',
      source: 'platform_handoff', status: 'assigned', assignedRepId: alex.id, routingOutcome: 'assigned',
      utmSource: 'facebook', utmCampaign: 'monroe-launch', clickId: 'fbclid-123', landingPage: '/', marketingConsent: false, bestTime: 'anytime',
    });
    // The preview is recomputed on the server in integer cents and is always marked unverified.
    expect(l.preview).toMatchObject({ source: 'home_preview', illustrative: true, verified: false, currentMonthlyCents: 66500, monthlyDifferenceCents: 20000, annualDifferenceCents: 240000, mobileLines: 3 });
    expect((l.preview as { rows: unknown[] }).rows).toEqual([
      { category: 'internet', currentMonthlyCents: 9500, comparisonMonthlyCents: 5500, comparison: 'Tucker benchmark', differenceCents: 4000 },
      { category: 'mobile', currentMonthlyCents: 19000, comparisonMonthlyCents: 13500, comparison: 'Tucker benchmark', differenceCents: 5500 },
      { category: 'tv', currentMonthlyCents: 12000, comparisonMonthlyCents: 7500, comparison: 'Tucker benchmark', differenceCents: 4500 },
      { category: 'electricity', currentMonthlyCents: 26000, comparisonMonthlyCents: 20000, comparison: 'Tucker benchmark', differenceCents: 6000 },
    ]);

    // Consent: exact wording, version and where it came from.
    const consents = repo.listConsents(db, l.id);
    expect(consents).toHaveLength(1);
    expect(consents[0].consentText).toMatch(/^\[handoff-2026-11-17\] By checking this box, I ask Tucker/);

    // The same bills became a full assessment with opportunities, linked to the lead, and a private results link.
    expect(l.assessmentId).toBe(r.body.results.id);
    const opps = repo.opportunitiesForLead(db, l.id);
    expect(opps.map((o) => o.category)).toEqual(['internet', 'mobile', 'tv', 'electricity']);
    // Mobile has no real plan on file: an advisor quote is needed. It is never stored as a priced order.
    expect(opps.find((o) => o.category === 'mobile')).toMatchObject({ kind: 'advisor', estimate: true });
    await request(app).get(`/api/platform/assessments/${r.body.results.id}?t=${r.body.results.token}`).expect(200);

    // History and funnel events.
    expect(repo.listLeadHistory(db, l.id).map((h) => [h.kind, h.from, h.to, h.actor])).toEqual([
      ['assignment', '', alex.id, 'routing'],
      ['status', 'new', 'assigned', 'routing'],
    ]);
    const events = (db.prepare("SELECT name, props FROM events WHERE name IN ('handoff_submit','rep_assigned') ORDER BY id").all() as { name: string; props: string }[]).map((e) => [e.name, JSON.parse(e.props)]);
    expect(events).toEqual([['handoff_submit', { from: 'home', categories: 4 }], ['rep_assigned', { reason: 'least_loaded' }]]);
    // No name, phone or address ever goes into an analytics event.
    expect(JSON.stringify(db.prepare('SELECT * FROM events').all())).not.toMatch(/Dana|7345550177|555/);
  });

  it('refuses without consent or a usable phone, and never trusts totals sent by the browser', async () => {
    const noConsent = await handoff({ consent: false }).expect(400);
    expect(noConsent.body.fields.consent).toMatch(/check the box/);
    expect((await handoff({ phone: '555' }).expect(400)).body.fields.phone).toMatch(/10-digit/);
    expect((await handoff({ zip: '4816' }).expect(400)).body.fields.zip).toBeTruthy();
    expect((await handoff({ bills: { internet: null, mobile: null, tv: null, electricity: null } }).expect(400)).body.fields.bills).toMatch(/at least one/);
    expect((await handoff({ preferredContact: 'email' }).expect(400)).body.fields.email).toMatch(/email address/);
    expect(repo.listLeads(db).total).toBe(0);

    const r = await handoff({ monthlyDifferenceCents: 99999900, preview: { monthlyDifferenceCents: 99999900 } }).expect(201);
    expect(lead(r.body.leadId).preview).toMatchObject({ monthlyDifferenceCents: 20000 });
  });

  it('keeps optional marketing permission separate from the request', async () => {
    const plain = await handoff().expect(201);
    expect(lead(plain.body.leadId).marketingConsent).toBe(false);
    const opted = await handoff({ phone: '7345550188', marketingConsent: true, email: 'DANA@Example.com', preferredContact: 'text', bestTime: 'evening' }).expect(201);
    const l = lead(opted.body.leadId);
    expect(l).toMatchObject({ marketingConsent: true, email: 'dana@example.com', preferredContact: 'text', bestTime: 'evening' });
    expect(repo.listConsents(db, l.id).map((c) => [c.source, c.consentText.slice(0, 22)])).toEqual([
      ['lead_form', '[handoff-2026-11-17] B'],
      ['marketing_optin', '[marketing-2026-11-17]'],
    ]);
  });

  it('returns the same lead when the same form is sent again, without a second alert', async () => {
    addRep();
    const first = await handoff({ requestKey: KEY }).expect(201);
    const again = await handoff({ requestKey: KEY }).expect(201);
    expect(again.body).toMatchObject({ leadId: first.body.leadId, repeat: true, bookingToken: first.body.bookingToken, results: first.body.results, routing: first.body.routing });
    expect(repo.listLeads(db).total).toBe(1);
    await notifier.processDue();
    expect(mailer.sent.filter((e) => /New lead/.test(e.subject))).toHaveLength(1);
  });

  it('links a later request from the same phone to the first and keeps it with the same representative', async () => {
    const alex = addRep();
    const sam = addRep({ name: 'Sam Lee', email: 'sam@example.com' });
    const first = await handoff().expect(201);
    const owner = lead(first.body.leadId).assignedRepId;
    const second = await handoff({ bills: { internet: 8000, mobile: null, tv: null, electricity: null } }).expect(201);
    const l2 = lead(second.body.leadId);
    expect(l2.id).not.toBe(first.body.leadId);
    expect(l2.duplicateOf).toBe(first.body.leadId);
    expect(l2.assignedRepId).toBe(owner);
    expect(repo.listLeadHistory(db, l2.id)[0].detail).toMatch(/Already working with this household/);
    // The first lead is untouched apart from a note.
    expect(lead(first.body.leadId).preview).toMatchObject({ monthlyDifferenceCents: 20000 });
    expect([alex.id, sam.id]).toContain(owner);
  });

  it('queues the request when nobody can take it, and it stays recoverable', async () => {
    addRep({ accepting: false });
    const r = await handoff().expect(201);
    expect(r.body.routing).toEqual({ outcome: 'queued', representative: null });
    expect(lead(r.body.leadId)).toMatchObject({ status: 'new', assignedRepId: null, routingOutcome: 'queued', routingReason: 'No representative is accepting new leads right now' });
    const admin = await signIn();
    const queue = await admin.get('/api/admin/leads?assigned=unassigned').expect(200);
    expect(queue.body.leads.map((l: Lead) => l.id)).toEqual([r.body.leadId]);
  });

  it('treats every ZIP the same: no location record is needed to preview, request or be assigned', async () => {
    const alex = addRep();
    const r = await handoff({ zip: '60601' }).expect(201);
    expect(r.body.routing).toEqual({ outcome: 'assigned', representative: null });
    const l = lead(r.body.leadId);
    expect(l).toMatchObject({ assignedRepId: alex.id, routingOutcome: 'assigned', areaStatus: 'unknown', zip: '60601' });
    // Every category is a benchmark comparison: work for a representative, never a priced offer.
    expect(repo.opportunitiesForLead(db, l.id).every((o) => o.kind === 'advisor' && o.estimate)).toBe(true);
    // Removing every service area and switching the old location record off changes nothing.
    db.prepare('DELETE FROM service_areas').run();
    const again = await handoff({ zip: '99501', phone: '7345550155' }).expect(201);
    expect(again.body.routing.outcome).toBe('assigned');
  });

  it('sends alerts to the central address list from Settings, and reports when none is set', async () => {
    const admin = await signIn();
    const before = (await admin.get('/api/admin/settings').expect(200)).body;
    expect(before).toMatchObject({ teamEmails: [], fallbackTeamEmails: ['team@example.com'] });
    expect((await admin.put('/api/admin/settings').set(post).send({ teamEmails: ['not-an-email'] }).expect(400)).body.fields).toBeTruthy();
    await admin.put('/api/admin/settings').set(post).send({ teamEmails: ['Ops@Example.com', 'owner@example.com'] }).expect(200);
    await handoff().expect(201);
    await notifier.processDue();
    expect(mailer.sent[0].to).toEqual(['ops@example.com', 'owner@example.com']);
    expect((await admin.get('/api/admin/me').expect(200)).body.locationsWithoutTeamEmail).toEqual([]);
  });

  it('never loses a lead when the email provider fails, and records the failure for retry', async () => {
    addRep();
    mailer.fail = true;
    const r = await handoff().expect(201);
    await notifier.processDue();
    expect(lead(r.body.leadId).status).toBe('assigned');
    const row = db.prepare("SELECT status, error, attempts FROM notifications WHERE lead_id = ? AND kind = 'team_new_lead'").get(r.body.leadId) as { status: string; error: string; attempts: number };
    expect(row).toMatchObject({ status: 'pending', error: 'provider down', attempts: 1 });
    mailer.fail = false;
    await notifier.processDue(new Date(Date.now() + 2 * 60_000));
    expect(mailer.sent).toHaveLength(1);
  });

  it('alerts the team and the assigned representative, with the preview clearly marked unverified, and skips customer email when none was given', async () => {
    addRep();
    const r = await handoff().expect(201);
    await notifier.processDue(new Date(Date.now() + 30 * 60_000));
    const alert = mailer.sent.find((e) => /New lead: Dana —/.test(e.subject))!;
    expect(alert.to).toEqual(['team@example.com', 'alex@example.com']);
    expect(alert.replyTo).toBeUndefined();
    expect(alert.text).toMatch(/Assigned to: Alex Rivera/);
    expect(alert.text).toMatch(/Previewed difference: \$200\/mo \(\$2,400\/yr\)\. Illustrative, not verified pricing\./);
    expect(alert.html).not.toMatch(/mailto:"/);
    const customer = db.prepare("SELECT status, error FROM notifications WHERE lead_id = ? AND kind = 'customer_lead_received'").get(r.body.leadId);
    expect(customer).toEqual({ status: 'skipped', error: 'No email address on this lead' });
  });

  it('pretends success for bots and creates nothing', async () => {
    const r = await handoff({ website: 'http://spam.example' }).expect(201);
    expect(r.body.routing.outcome).toBe('queued');
    expect(repo.listLeads(db).total).toBe(0);
  });

  it('shares its validation with the browser form', () => {
    expect(handoffSchema.safeParse({ ...REQUEST, phone: '+1 (734) 555-0177' }).success).toBe(true);
    expect(previewFromBills({ bills: { internet: 5000, mobile: null, tv: null, electricity: 30000, security: null }, mobileLines: 1, ownsHome: false, showExtras: false })).toMatchObject({
      monthlyDifferenceCents: 0,
      rows: [{ differenceCents: -500 }, { comparisonMonthlyCents: null, differenceCents: null, comparison: 'Not compared (solar pricing is for homeowners who ask)' }],
    });
  });

  it('prices solar and home security only for a homeowner who asked, and never stores what was not shown', async () => {
    const bills = { internet: 9500, mobile: null, tv: null, electricity: 26000, security: 6000 };
    // Owner who did not ask: no solar or security figure, and no security service on the lead.
    const quiet = await handoff({ bills, ownsHome: true, showExtras: false }).expect(201);
    const q = lead(quiet.body.leadId).preview as { rows: { category: string; comparisonMonthlyCents: number | null }[]; monthlyDifferenceCents: number };
    expect(q.rows.map((r) => [r.category, r.comparisonMonthlyCents])).toEqual([['internet', 5500], ['electricity', null]]);
    expect(q.monthlyDifferenceCents).toBe(4000);
    expect(repo.opportunitiesForLead(db, quiet.body.leadId).map((o) => o.category)).not.toContain('security');
    // A renter who ticks "show extras" still sees nothing extra (the box only appears for owners, and the server checks too).
    const renter = await handoff({ bills, ownsHome: false, showExtras: true, phone: '7345550144' }).expect(201);
    expect((lead(renter.body.leadId).preview as { rows: { category: string }[] }).rows.map((r) => r.category)).toEqual(['internet', 'electricity']);
    // Owner who asked: solar at $200 and security at $80 are compared.
    const asked = await handoff({ bills, ownsHome: true, showExtras: true, phone: '7345550133' }).expect(201);
    const a = lead(asked.body.leadId).preview as { rows: { category: string; comparisonMonthlyCents: number | null; differenceCents: number | null }[]; monthlyDifferenceCents: number };
    expect(a.rows.map((r) => [r.category, r.comparisonMonthlyCents, r.differenceCents])).toEqual([
      ['internet', 5500, 4000],
      ['electricity', 20000, 6000],
      ['security', 8000, -2000],
    ]);
    // Security at $60 is below the $80 benchmark: shown as a possible extra cost and left out of the total.
    expect(a.monthlyDifferenceCents).toBe(10000);
    const opps = repo.opportunitiesForLead(db, asked.body.leadId);
    expect(opps.map((o) => o.category)).toEqual(['internet', 'electricity']);
  });
});

describe('results page request', () => {
  it('accepts the same short details and routes the lead', async () => {
    const alex = addRep();
    const a = await request(app).post('/api/platform/assessments').send({ assessment: { zip: '48161', categories: ['internet'], internet: { monthlyCents: 9000 } } }).expect(201);
    const r = await request(app)
      .post(`/api/platform/assessments/${a.body.id}/contact`)
      .send({ firstName: 'Lee', phone: '7345550123', consent: true, intent: 'callback', token: a.body.token, requestKey: KEY })
      .expect(201);
    expect(r.body.routing).toEqual({ outcome: 'assigned', representative: null });
    const l = lead(r.body.leadId);
    expect(l).toMatchObject({ lastName: '', email: '', source: 'platform_assessment', assignedRepId: alex.id, status: 'assigned' });
    expect(l.preview).toMatchObject({ source: 'results', illustrative: true, verified: false });
    const again = await request(app)
      .post(`/api/platform/assessments/${a.body.id}/contact`)
      .send({ firstName: 'Lee', phone: '7345550123', consent: true, intent: 'callback', token: a.body.token, requestKey: KEY })
      .expect(201);
    expect(again.body).toMatchObject({ leadId: r.body.leadId, repeat: true, bookingToken: r.body.bookingToken });
    expect(repo.listLeads(db).total).toBe(1);
  });
});

describe('representative workspace', () => {
  it('lets a representative see and work only their own leads', async () => {
    const alex = addRep();
    const mine = (await handoff().expect(201)).body.leadId;
    repo.setRepAccepting(db, alex.id, false);
    const sam = addRep({ name: 'Sam Lee', email: 'sam@example.com', passwordHash: hashPassword('sam-password-1234') });
    const theirs = (await handoff({ phone: '7345550199', firstName: 'Pat' }).expect(201)).body.leadId;
    expect(lead(theirs).assignedRepId).toBe(sam.id);

    const rep = await signIn('alex@example.com', 'alex-password-123');
    const me = await rep.get('/api/admin/me').expect(200);
    expect(me.body).toMatchObject({ role: 'rep', rep: { name: 'Alex Rivera', accepting: false, openLeads: 1 }, crm: { configured: false } });

    const list = await rep.get('/api/admin/leads?assigned=unassigned').expect(200); // the filter cannot widen their view
    expect(list.body.leads.map((l: Lead) => l.id)).toEqual([mine]);
    await rep.get(`/api/admin/leads/${theirs}`).expect(404);
    await rep.patch(`/api/admin/leads/${theirs}`).set(post).send({ status: 'contacted' }).expect(404);
    const otherOpp = repo.opportunitiesForLead(db, theirs)[0];
    await rep.patch(`/api/admin/opportunities/${otherOpp.id}`).set(post).send({ status: 'won' }).expect(404);
    for (const path of ['/api/admin/leads.csv', '/api/admin/markets', '/api/admin/reps', '/api/admin/assessments', '/api/admin/opportunities', '/api/admin/stats', '/api/admin/handoff-funnel', '/api/admin/service-areas']) {
      await rep.get(path).expect(403);
    }
    await rep.patch(`/api/admin/leads/${mine}`).set(post).send({ assignRepId: sam.id }).expect(403);

    // Their own lead: a summary with the unverified preview, and a status they set themselves.
    const detail = await rep.get(`/api/admin/leads/${mine}`).expect(200);
    expect(detail.body).toMatchObject({ representative: 'Alex Rivera', lead: { firstName: 'Dana', preview: { verified: false } } });
    expect(detail.body.representatives).toBeUndefined();
    expect(detail.body.opportunities).toHaveLength(4);
    await rep.patch(`/api/admin/leads/${mine}`).set(post).send({ status: 'contact_attempted', note: 'Left a voicemail.' }).expect(200);
    expect(lead(mine).firstContactAt).toBeNull(); // an attempt is not a contact
    const contacted = await rep.patch(`/api/admin/leads/${mine}`).set(post).send({ status: 'contacted' }).expect(200);
    expect(contacted.body.lead.firstContactAt).toBeTruthy();
    expect(contacted.body.history.map((h: { to: string; actor: string }) => [h.to, h.actor]).slice(-2)).toEqual([
      ['contact_attempted', 'alex@example.com'],
      ['contacted', 'alex@example.com'],
    ]);
    const on = await rep.patch('/api/admin/reps/me').set(post).send({ accepting: true }).expect(200);
    expect(on.body.representative.accepting).toBe(true);
  });

  it('signs a representative out the moment they are deactivated, and never accepts a wrong password', async () => {
    const alex = addRep();
    await request(app).post('/api/admin/login').send({ email: 'alex@example.com', password: 'wrong-password-123' }).expect(401);
    const noPassword = addRep({ name: 'No Login', email: 'nologin@example.com', passwordHash: undefined });
    expect(noPassword.canSignIn).toBe(false);
    await request(app).post('/api/admin/login').send({ email: 'nologin@example.com', password: '' }).expect(400);
    await request(app).post('/api/admin/login').send({ email: 'nologin@example.com', password: 'anything-at-all-1' }).expect(401);
    const rep = await signIn('alex@example.com', 'alex-password-123');
    await rep.get('/api/admin/leads').expect(200);
    repo.updateRep(db, alex.id, { name: alex.name, email: alex.email, phone: '', active: false, accepting: false, markets: ['*'], categories: [], maxOpenLeads: 0 });
    await rep.get('/api/admin/leads').expect(401);
    await request(app).post('/api/admin/login').send({ email: 'alex@example.com', password: 'alex-password-123' }).expect(401);
  });

  it('lets an admin manage representatives, reassign leads and read the funnel', async () => {
    const admin = await signIn();
    const created = await admin
      .post('/api/admin/reps')
      .set(post)
      .send({ name: 'Alex Rivera', email: 'Alex@Example.com', markets: ['monroe'], categories: ['internet', 'mobile'], accepting: true, maxOpenLeads: 5, password: 'alex-password-123' })
      .expect(201);
    const alex = created.body.representative;
    expect(alex).toMatchObject({ email: 'alex@example.com', markets: ['monroe'], categories: ['internet', 'mobile'], accepting: true, canSignIn: true, openLeads: 0 });
    expect(JSON.stringify(created.body)).not.toMatch(/scrypt|password/i);
    expect((await admin.post('/api/admin/reps').set(post).send({ name: 'Dup', email: 'alex@example.com' }).expect(400)).body.error).toMatch(/already uses that email/);
    expect((await admin.post('/api/admin/reps').set(post).send({ name: 'A', email: 'admin@example.com' }).expect(400)).body.error).toMatch(/admin account/);
    expect((await admin.post('/api/admin/reps').set(post).send({ name: 'Short', email: 's@example.com', password: 'short' }).expect(400)).body.fields.password).toMatch(/12 characters/);
    await admin.put(`/api/admin/reps/${alex.id}`).set(post).send({ name: 'Alex Rivera', email: 'alex@example.com', markets: ['monroe'], categories: ['internet', 'mobile'], accepting: false }).expect(200);
    await signIn('alex@example.com', 'alex-password-123'); // editing without a password keeps the old one

    // Nobody accepting: the request waits in the queue until the admin hands it over.
    const id = (await handoff().expect(201)).body.leadId;
    expect(lead(id).routingOutcome).toBe('queued');
    const assigned = await admin.patch(`/api/admin/leads/${id}`).set(post).send({ assignRepId: alex.id }).expect(200);
    expect(assigned.body).toMatchObject({ representative: 'Alex Rivera', lead: { status: 'assigned', assignedRepId: alex.id, routingReason: 'Assigned by hand' } });
    await admin.patch(`/api/admin/leads/${id}`).set(post).send({ assignRepId: '7b0e9a54-3f0e-4c57-9a10-1f6f1f3b7a99' }).expect(400);
    const back = await admin.patch(`/api/admin/leads/${id}`).set(post).send({ assignRepId: null }).expect(200);
    expect(back.body.lead).toMatchObject({ status: 'new', assignedRepId: null, routingOutcome: 'queued' });
    await admin.patch(`/api/admin/leads/${id}`).set(post).send({ assignRepId: alex.id }).expect(200);

    // Outcomes are recorded only when a person sets them.
    await admin.patch(`/api/admin/leads/${id}`).set(post).send({ status: 'contacted' }).expect(200);
    await admin.patch(`/api/admin/leads/${id}`).set(post).send({ status: 'qualified' }).expect(200);
    await admin.patch(`/api/admin/leads/${id}`).set(post).send({ status: 'sold' }).expect(200);
    const funnel = await admin.get('/api/admin/handoff-funnel').expect(200);
    expect(funnel.body.leads).toMatchObject({ total: 1, assigned: 1, queued: 0, unsupported: 0, contacted: 1, appointments: 0, qualified: 1, converted: 1 });
    expect(funnel.body.leads.avgMinutesToFirstContact).toBe(0);
    expect(funnel.body.events.handoff_submit).toEqual({ events: 1, sessions: 1 });
    const names = (db.prepare("SELECT name FROM events WHERE name LIKE 'lead_%' OR name = 'rep_assigned' ORDER BY id").all() as { name: string }[]).map((e) => e.name);
    expect(names).toEqual(['rep_assigned', 'rep_assigned', 'lead_qualified', 'lead_converted']);

    // A request after a closed lead starts fresh instead of being linked to it.
    await admin.patch(`/api/admin/leads/${id}`).set(post).send({ status: 'not_interested' }).expect(200);
    const fresh = (await handoff().expect(201)).body.leadId;
    expect(lead(fresh).duplicateOf).toBeNull();
  });

  it('ignores conversion events sent from a browser', async () => {
    for (const name of ['handoff_submit', 'rep_assigned', 'lead_qualified', 'lead_converted']) await request(app).post('/api/events').send({ name, sessionId: 's' }).expect(204);
    for (const name of ['preview_view', 'handoff_cta_view', 'handoff_cta_click', 'handoff_start', 'handoff_error']) await request(app).post('/api/events').send({ name, sessionId: 's' }).expect(204);
    expect((db.prepare('SELECT name FROM events ORDER BY id').all() as { name: string }[]).map((e) => e.name)).toEqual(['preview_view', 'handoff_cta_view', 'handoff_cta_click', 'handoff_start', 'handoff_error']);
  });
});
