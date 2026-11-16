import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app';
import type { AppConfig } from '../server/config';
import { openDatabase, type DB } from '../server/db';
import { hashPassword } from '../server/lib/auth';
import { createNotifier } from '../server/notify';
import * as repo from '../server/repo';

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

const ASSESSMENT = {
  zip: '48161',
  categories: ['internet', 'mobile'],
  internet: { provider: 'Comcast', monthlyCents: 9000, equipmentFeeCents: 1500 },
  mobile: { carrier: 'BigCarrier', monthlyCents: 16000, lines: 2, dataNeed: 'unlimited' },
};
const CONTACT = { firstName: 'Ana', lastName: 'Lopez', email: 'ana@example.com', phone: '(734) 555-0190', preferredContact: 'phone', consent: true, intent: 'appointment' };

let db: DB;
let app: ReturnType<typeof createApp>;
const setup = (sampleData = true) => {
  db = openDatabase(':memory:');
  const c = cfg(sampleData);
  app = createApp(c, db, { notifier: createNotifier(db, c) });
};
beforeEach(() => setup());

const submit = () => request(app).post('/api/platform/assessments').send({ assessment: ASSESSMENT, sessionId: 's-1', utmSource: 'facebook', utmCampaign: 'pilot' });

describe('assessment submission & results access', () => {
  it('stores an immutable analysis snapshot and returns a private results token', async () => {
    const r = await submit().expect(201);
    expect(r.body.token).toHaveLength(43);
    expect(r.body.analysis.status).toBe('complete');
    expect(r.body.analysis.categories.map((c: { category: string }) => c.category)).toEqual(['internet', 'mobile']);
    const row = repo.getAssessment(db, r.body.id)!;
    expect(row).toMatchObject({ zip: '48161', status: 'complete', currentMonthlyCents: 10500 + 16000, includeSamples: true, utmSource: 'facebook', leadId: null });
    expect(row.potentialSavingsCents).toBeGreaterThan(0);
    // No contact details live on an assessment.
    const raw = JSON.stringify(db.prepare('SELECT * FROM assessments').get());
    expect(raw).not.toMatch(/@|555-0190|Ana/);
    // Server-side conversion event
    expect(repo.conversionStats(db).funnel.assessment_complete.events).toBe(1);
  });

  it('only returns results with the right token (same 404 otherwise)', async () => {
    const { body } = await submit();
    const ok = await request(app).get(`/api/platform/assessments/${body.id}`).query({ t: body.token }).expect(200);
    expect(ok.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(ok.body.analysis)).toBe(JSON.stringify(body.analysis));
    const wrong = await request(app).get(`/api/platform/assessments/${body.id}`).query({ t: 'x'.repeat(43) }).expect(404);
    const missing = await request(app).get('/api/platform/assessments/does-not-exist').query({ t: body.token }).expect(404);
    expect(wrong.body).toEqual(missing.body);
    await request(app).get(`/api/platform/assessments/${body.id}`).expect(404);
  });

  it('validates the assessment and reports field errors', async () => {
    const r = await request(app).post('/api/platform/assessments').send({ assessment: { zip: '12', categories: [] } }).expect(400);
    expect(r.body.fields).toHaveProperty('zip');
    expect(r.body.fields).toHaveProperty('categories');
  });

  it('never includes sample offers when sample data is off', async () => {
    setup(false);
    const { body } = await submit().expect(201);
    const kinds = body.analysis.categories.flatMap((c: { options: { kind: string }[] }) => c.options.map((o) => o.kind));
    expect(kinds).not.toContain('sample');
    expect(body.analysis.includeSamples).toBe(false);
  });
});

describe('advisor request → lead → booking', () => {
  it('creates a consented lead linked to the assessment, and booking works', async () => {
    const { body: a } = await submit();
    await request(app).post(`/api/platform/assessments/${a.id}/contact`).send({ ...CONTACT, token: 'y'.repeat(43) }).expect(404);
    await request(app).post(`/api/platform/assessments/${a.id}/contact`).send({ ...CONTACT, token: a.token, consent: false }).expect(400);
    const c = await request(app).post(`/api/platform/assessments/${a.id}/contact`).send({ ...CONTACT, token: a.token, sessionId: 's-1' }).expect(201);

    const lead = repo.getLead(db, c.body.leadId)!;
    expect(lead).toMatchObject({ source: 'platform_assessment', zip: '48161', phone: '7345550190', assessmentId: a.id, utmSource: 'facebook', marketId: 'monroe' });
    expect(repo.getAssessment(db, a.id)!.leadId).toBe(lead.id);
    const [consent] = repo.listConsents(db, lead.id);
    expect(consent.consentText).toMatch(/^\[platform-2026-11-16\] .*household services/);

    const date = (await request(app).get('/api/schedule/dates').query({ market: c.body.market })).body.dates.at(-1);
    const slot = (await request(app).get('/api/schedule/slots').query({ date, market: c.body.market })).body.slots[0];
    await request(app).post('/api/appointments').send({ leadId: lead.id, token: c.body.bookingToken, startUtc: slot.startUtc }).expect(201);
    expect(repo.getLead(db, lead.id)!.status).toBe('appointment_set');

    const after = await request(app).get(`/api/platform/assessments/${a.id}`).query({ t: a.token });
    expect(after.body.contacted).toBe(true);
    expect(repo.conversionStats(db).funnel.advisor_request.events).toBe(1);
  });

  it('shows assessments only to signed-in admins, and on the lead page', async () => {
    const { body: a } = await submit();
    const c = await request(app).post(`/api/platform/assessments/${a.id}/contact`).send({ ...CONTACT, token: a.token });
    await request(app).get('/api/admin/assessments').expect(401);
    await request(app).get(`/api/admin/assessments/${a.id}`).expect(401);
    const agent = request.agent(app);
    await agent.post('/api/admin/login').send({ email: 'admin@example.com', password: 'correct-horse-battery' }).expect(200);
    const list = (await agent.get('/api/admin/assessments').expect(200)).body;
    expect(list.total).toBe(1);
    expect(list.stats).toMatchObject({ completed: 1, withLead: 1 });
    expect(list.assessments[0]).not.toHaveProperty('answers');
    const detail = (await agent.get(`/api/admin/leads/${c.body.leadId}`).expect(200)).body;
    expect(detail.assessment.id).toBe(a.id);
  });
});
