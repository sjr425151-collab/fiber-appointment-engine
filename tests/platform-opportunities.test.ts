/**
 * The household journey from the database's point of view: an advisor request
 * persists one opportunity per service AS THE CUSTOMER SELECTED IT, figures are
 * re-derived on the server (never trusted from the browser), and only a
 * signed-in admin can read or change them.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app';
import type { AppConfig } from '../server/config';
import { openDatabase, type DB } from '../server/db';
import { hashPassword } from '../server/lib/auth';
import { createNotifier } from '../server/notify';
import * as repo from '../server/repo';
import { opportunitiesFrom } from '../shared/platform/opportunity';
import { buildAnalysis } from '../shared/platform/analysis';
import { assessmentSchema } from '../shared/platform/assessment';

process.env.NODE_ENV = 'test';

const cfg = (sampleData: boolean): AppConfig => ({
  port: 0,
  flags: { env: 'staging', platform: true, sampleData },
  databasePath: ':memory:',
  sessionSecret: 'x'.repeat(64),
  adminEmail: 'admin@example.com',
  adminPasswordHash: hashPassword('correct-horse-battery'),
  timezone: 'America/Detroit',
  siteUrl: 'https://staging.example',
  isProduction: false,
  email: { resendApiKey: '', from: 'x <x@example.com>', teamEmails: [], dailyCustomerLimit: 80, nonProductionAllowlist: [] },
});

const HOUSEHOLD = {
  zip: '48161',
  categories: ['internet', 'mobile', 'electricity'],
  internet: { provider: 'Comcast', monthlyCents: 9000, equipmentFeeCents: 1500 },
  mobile: { carrier: 'BigCarrier', monthlyCents: 16000, lines: 2, dataNeed: 'unlimited' },
  electricity: { utility: 'DTE', monthlyCents: 16000, homeownership: 'own', roofSun: 'mostly_sunny' },
};
const CONTACT = { firstName: 'Ana', lastName: 'Lopez', email: 'ana@example.com', phone: '(734) 555-0190', preferredContact: 'phone', consent: true, intent: 'advisor' };

let db: DB;
let app: ReturnType<typeof createApp>;
const setup = (sampleData = true) => {
  db = openDatabase(':memory:');
  const c = cfg(sampleData);
  app = createApp(c, db, { notifier: createNotifier(db, c) });
};
beforeEach(() => setup());

const submit = (assessment: object = HOUSEHOLD) => request(app).post('/api/platform/assessments').send({ assessment });
const contact = (a: { id: string; token: string }, extra: object = {}) =>
  request(app).post(`/api/platform/assessments/${a.id}/contact`).send({ ...CONTACT, token: a.token, ...extra });
const admin = async () => {
  const agent = request.agent(app);
  await agent.post('/api/admin/login').send({ email: 'admin@example.com', password: 'correct-horse-battery' }).expect(200);
  return agent;
};

describe('opportunities from an advisor request', () => {
  it('records the options the customer selected, not our defaults', async () => {
    const { body: a } = await submit().expect(201);
    expect(a.analysis.categories.find((c: { category: string }) => c.category === 'internet').selected).toBe('monroe-1-gig');
    // Customer switches internet to 2 Gig and keeps their mobile plan.
    const c = await contact(a, { selections: { internet: 'monroe-2-gig', mobile: 'keep' } }).expect(201);
    const opps = repo.opportunitiesForLead(db, c.body.leadId);
    expect(opps.map((o) => [o.category, o.offerId, o.kind, o.status])).toEqual([
      ['internet', 'monroe-2-gig', 'pending_address', 'new'],
      ['electricity', 'sample-solar-ppa', 'sample', 'new'],
    ]);
    const net = opps[0];
    // 2 Gig is $70 against $105 now (bill + equipment): figures come from the engine.
    expect(net).toMatchObject({ currentMonthlyCents: 10500, proposedMonthlyCents: 7000, monthlySavingsCents: 3500, estimate: false });
    expect(opps[1]).toMatchObject({ estimate: true, proposedMonthlyCents: 11360 });
    expect(repo.listNotes(db, c.body.leadId).map((n) => n.body).join(" | ")).toMatch(/internet → 2 Gig; electricity → Sample Solar Agreement \(25 years\) \[SAMPLE\]/);
  });

  it('ignores forged or unknown selections and never takes prices from the request', async () => {
    const { body: a } = await submit().expect(201);
    const c = await contact(a, { selections: { internet: 'not-a-real-offer', mobile: 'sample-unlimited' }, monthlySavingsCents: 999999, proposedMonthlyCents: 1 }).expect(201);
    const opps = repo.opportunitiesForLead(db, c.body.leadId);
    // Unknown id → our default (1 Gig); valid sample id is honoured.
    expect(opps.find((o) => o.category === 'internet')!.offerId).toBe('monroe-1-gig');
    expect(opps.find((o) => o.category === 'mobile')!.offerId).toBe('sample-unlimited');
    expect(opps.every((o) => (o.monthlySavingsCents ?? 0) < 999999)).toBe(true);
    // Unknown categories in selections are rejected outright.
    await contact(a, { selections: { gas: 'x' } }).expect(400);
  });

  it('records a benchmark comparison as work for an advisor, never as an offer (production-like data)', async () => {
    setup(false);
    const { body: a } = await submit({ zip: '60601', categories: ['electricity'], electricity: { ...HOUSEHOLD.electricity, monthlyCents: 26000 } }).expect(201);
    expect(a.analysis.categories[0]).toMatchObject({ solar: 'estimated', selected: 'benchmark-electricity' });
    const c = await contact(a).expect(201);
    const [o] = repo.opportunitiesForLead(db, c.body.leadId);
    expect(o).toMatchObject({
      category: 'electricity',
      kind: 'advisor', // a real plan still has to be found and quoted
      estimate: true,
      planName: 'Tucker benchmark: electricity with solar',
      currentMonthlyCents: 26000,
      proposedMonthlyCents: 20000,
      monthlySavingsCents: 6000,
    });
    // Benchmark figures never count toward the pipeline's real-offer savings.
    const agent = await admin();
    expect((await agent.get('/api/admin/opportunities')).body.stats.new).toEqual({ count: 1, monthlySavingsCents: 0 });
  });

  it('uses real plans where they exist and benchmarks elsewhere (production-like data)', async () => {
    setup(false);
    const { body: a } = await submit().expect(201);
    // Monroe has real internet plans; mobile ($160 for 2 lines vs $90) uses the benchmark; electricity ($160) is below the $200 solar benchmark.
    expect(a.analysis.categories.map((c: { category: string; selected: string }) => [c.category, c.selected])).toEqual([
      ['internet', 'monroe-1-gig'],
      ['mobile', 'benchmark-mobile'],
      ['electricity', 'keep'],
    ]);
    expect(a.analysis.projectionBasis).toBe('benchmark');
    const c = await contact(a, { street: '12 W Front St', city: 'Monroe' }).expect(201);
    expect(repo.opportunitiesForLead(db, c.body.leadId).map((o) => [o.category, o.planName, o.kind, o.monthlySavingsCents])).toEqual([
      ['internet', '1 Gig', 'pending_address', 5500],
      ['mobile', 'Tucker benchmark: mobile', 'advisor', 7000],
    ]);
    expect(repo.getLead(db, c.body.leadId)).toMatchObject({ street: '12 W Front St', city: 'Monroe' });
    // The customer can keep a service out of the request.
    const { body: b } = await submit().expect(201);
    const d = await contact(b, { selections: { mobile: 'keep' }, email: 'other@example.com' }).expect(201);
    expect(repo.opportunitiesForLead(db, d.body.leadId).map((o) => o.category)).toEqual(['internet']);
  });

  it('uses each location’s own plans, and explains "coming soon" areas', async () => {
    setup(false);
    // 48166 (Newport) is seeded as coming soon.
    const soon = (await submit({ zip: '48166', categories: ['internet'], internet: HOUSEHOLD.internet }).expect(201)).body;
    expect(soon.analysis.categories[0].options.map((o: { kind: string }) => o.kind)).toEqual(['benchmark']);
    expect(soon.analysis.categories[0].notes.join(' ')).toMatch(/Omni Fiber is coming to Newport but isn’t available to order yet/);
    // A ZIP nobody serves: no offers, generic note.
    const none = (await submit({ zip: '10001', categories: ['internet'], internet: HOUSEHOLD.internet }).expect(201)).body;
    expect(none.analysis.categories[0].options.map((o: { offerId: string }) => o.offerId)).toEqual(['benchmark-internet']);
    // Changing a location's prices in the admin changes new analyses, with no code change.
    const monroe = repo.getMarket(db, 'monroe')!;
    repo.saveMarket(db, { ...monroe, plans: [{ name: '1 Gig', speed: 'Fiber', price: '$60/mo', highlights: [] }] });
    const updated = (await submit({ zip: '48161', categories: ['internet'], internet: HOUSEHOLD.internet }).expect(201)).body;
    expect(updated.analysis.categories[0].options.map((o: { planName: string; monthlyPrice: number }) => [o.planName, o.monthlyPrice])).toEqual([['1 Gig', 6000]]);
    // …while an earlier customer's stored snapshot keeps the prices they saw.
    const earlier = (await submit().expect(201)).body;
    repo.saveMarket(db, { ...monroe, plans: [] });
    const c = await contact(earlier).expect(201);
    expect(repo.opportunitiesForLead(db, c.body.leadId)[0]).toMatchObject({ planName: '1 Gig', proposedMonthlyCents: 6000 });
  });

  it('records a general review when the customer keeps everything', async () => {
    const { body: a } = await submit().expect(201);
    const c = await contact(a, { selections: { internet: 'keep', mobile: 'keep', electricity: 'keep' } }).expect(201);
    const opps = repo.opportunitiesForLead(db, c.body.leadId);
    expect(opps).toHaveLength(1);
    expect(opps[0]).toMatchObject({ category: 'household', kind: 'advisor', currentMonthlyCents: 10500 + 16000 + 16000 });
  });

  it('does not create opportunities for honeypot submissions or bad tokens', async () => {
    const { body: a } = await submit().expect(201);
    await contact(a, { website: 'http://spam.example' }).expect(201);
    await request(app).post(`/api/platform/assessments/${a.id}/contact`).send({ ...CONTACT, token: 'z'.repeat(43) }).expect(404);
    expect(db.prepare('SELECT COUNT(*) AS n FROM opportunities').get()).toMatchObject({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM leads').get()).toMatchObject({ n: 0 });
  });

  it('derives opportunities deterministically (unit)', () => {
    const a = assessmentSchema.parse(HOUSEHOLD);
    const at = '2026-11-16T12:00:00.000Z';
    const one = opportunitiesFrom(buildAnalysis(a, { includeSamples: true, computedAt: at, selections: { internet: 'omni-monroe-500' } }));
    const two = opportunitiesFrom(buildAnalysis(a, { includeSamples: true, computedAt: at, selections: { internet: 'omni-monroe-500' } }));
    expect(one).toEqual(two);
    expect(one.find((o) => o.category === 'internet')!.planName).toBe('500 Mbps');
  });
});

describe('admin management of opportunities', () => {
  it('lists, filters and updates status with an audit note', async () => {
    const { body: a } = await submit().expect(201);
    const c = await contact(a).expect(201);
    const agent = await admin();
    const list = (await agent.get('/api/admin/opportunities').expect(200)).body;
    expect(list.total).toBe(3);
    expect(list.opportunities[0].leadName).toBe('Ana Lopez');
    // Pipeline savings count only real offers (internet pending-address), never samples.
    const net = list.opportunities.find((o: { category: string }) => o.category === 'internet');
    expect(list.stats.new).toEqual({ count: 3, monthlySavingsCents: net.monthlySavingsCents });

    const r = await agent.patch(`/api/admin/opportunities/${net.id}`).set('X-Requested-With', 'fetch').send({ status: 'contacted' }).expect(200);
    expect(r.body.opportunity.status).toBe('contacted');
    expect(r.body.notes[0]).toMatchObject({ author: 'admin@example.com' });
    expect(r.body.notes[0].body).toMatch(/New → Contacted/);
    // Same status again is a no-op (no duplicate note).
    await agent.patch(`/api/admin/opportunities/${net.id}`).set('X-Requested-With', 'fetch').send({ status: 'contacted' }).expect(200);
    expect(repo.listNotes(db, c.body.leadId).filter((n) => /Contacted/.test(n.body))).toHaveLength(1);

    expect((await agent.get('/api/admin/opportunities').query({ status: 'contacted' })).body.total).toBe(1);
    expect((await agent.get('/api/admin/opportunities').query({ category: 'electricity' })).body.total).toBe(1);
    const detail = (await agent.get(`/api/admin/leads/${c.body.leadId}`).expect(200)).body;
    expect(detail.opportunities).toHaveLength(3);
  });

  it('validates updates and filters', async () => {
    const { body: a } = await submit().expect(201);
    await contact(a).expect(201);
    const agent = await admin();
    const [o] = (await agent.get('/api/admin/opportunities')).body.opportunities;
    const patch = (id: string, body: object) => agent.patch(`/api/admin/opportunities/${id}`).set('X-Requested-With', 'fetch').send(body);
    await patch(o.id, { status: 'archived' }).expect(400);
    await patch(o.id, { status: 'won', monthlySavingsCents: 1 }).expect(400); // no other fields may be changed
    await patch('missing-id', { status: 'won' }).expect(404);
    await agent.get('/api/admin/opportunities').query({ status: 'bogus' }).expect(400);
    await agent.get('/api/admin/opportunities').query({ category: "x' OR 1=1" }).expect(400);
    await agent.get('/api/admin/opportunities').query({ limit: 100000 }).expect(400);
  });
});

describe('authorization', () => {
  const ADMIN_GETS = ['/api/admin/me', '/api/admin/stats', '/api/admin/leads', '/api/admin/leads.csv', '/api/admin/opportunities', '/api/admin/assessments', '/api/admin/appointments', '/api/admin/markets', '/api/admin/service-areas', '/api/admin/conversions'];

  it('rejects every admin read without a session, and with a forged cookie', async () => {
    for (const path of ADMIN_GETS) {
      await request(app).get(path).expect(401);
      await request(app).get(path).set('Cookie', 'fae_session=eyJlbWFpbCI6ImFkbWluQGV4YW1wbGUuY29tIn0.forged').expect(401);
    }
  });

  it('rejects admin writes without a session or without the anti-CSRF header', async () => {
    const { body: a } = await submit().expect(201);
    await contact(a).expect(201);
    const id = (db.prepare('SELECT id FROM opportunities LIMIT 1').get() as { id: string }).id;
    await request(app).patch(`/api/admin/opportunities/${id}`).set('X-Requested-With', 'fetch').send({ status: 'won' }).expect(401);
    const agent = await admin();
    await agent.patch(`/api/admin/opportunities/${id}`).send({ status: 'won' }).expect(403);
    expect(repo.getOpportunity(db, id)!.status).toBe('new');
  });

  it('rejects wrong passwords and does not reveal which part was wrong', async () => {
    const bad1 = await request(app).post('/api/admin/login').send({ email: 'admin@example.com', password: 'wrong-password-123' }).expect(401);
    const bad2 = await request(app).post('/api/admin/login').send({ email: 'other@example.com', password: 'correct-horse-battery' }).expect(401);
    expect(bad1.body).toEqual(bad2.body);
  });

  it('needs no feature switch: the savings API is part of the application in production', async () => {
    const c = { ...cfg(false), flags: { env: 'production' as const, platform: true, sampleData: false } };
    const prodDb = openDatabase(':memory:');
    const prod = createApp(c, prodDb, { notifier: createNotifier(prodDb, c) });
    const r = await request(prod).post('/api/platform/assessments').send({ assessment: HOUSEHOLD }).expect(201);
    expect(r.body.analysis.includeSamples).toBe(false);
    expect(JSON.stringify(r.body.analysis.categories)).not.toMatch(/"kind":"sample"/);
    await request(prod).post('/api/platform/assessments/x/contact').send({ ...CONTACT, token: 'x'.repeat(43) }).expect(404);
  });
});
