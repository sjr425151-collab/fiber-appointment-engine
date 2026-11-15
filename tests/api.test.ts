import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app';
import { openDatabase, type DB } from '../server/db';
import { hashPassword } from '../server/lib/auth';
import { availableSlots, bookAppointment, candidateSlots, rulesFromSettings } from '../server/scheduling';
import { zonedToUtc } from '../server/lib/time';
import * as repo from '../server/repo';
import type { AppConfig } from '../server/config';

process.env.NODE_ENV = 'test';
const TZ = 'America/Detroit';
const config: AppConfig = {
  port: 0,
  databasePath: ':memory:',
  sessionSecret: 'x'.repeat(64),
  adminEmail: 'admin@example.com',
  adminPasswordHash: hashPassword('correct-horse-battery'),
  timezone: TZ,
  isProduction: false,
};

const validLead = {
  firstName: 'Jamie',
  lastName: 'Rivera',
  email: 'Jamie@Example.com',
  phone: '(734) 555-0142',
  street: '123 E Front St',
  city: 'Monroe',
  zip: '48161',
  consent: true,
};

let db: DB;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDatabase(':memory:');
  app = createApp(config, db);
});

async function firstOpenSlot() {
  const { body } = await request(app).get('/api/schedule/dates');
  for (const date of body.dates as string[]) {
    const r = await request(app).get('/api/schedule/slots').query({ date });
    if (r.body.slots.length) return r.body.slots[0];
  }
  throw new Error('no slots');
}

async function adminAgent() {
  const agent = request.agent(app);
  await agent.post('/api/admin/login').send({ email: 'admin@example.com', password: 'correct-horse-battery' }).expect(200);
  return agent;
}

describe('time', () => {
  it('converts Detroit wall time to UTC across DST', () => {
    expect(zonedToUtc('2026-07-01', '09:00', TZ).toISOString()).toBe('2026-07-01T13:00:00.000Z'); // EDT
    expect(zonedToUtc('2026-12-01', '09:00', TZ).toISOString()).toBe('2026-12-01T14:00:00.000Z'); // EST
  });
});

describe('availability', () => {
  it('reports seeded Monroe ZIP as in the build area', async () => {
    const r = await request(app).get('/api/availability').query({ zip: '48161' }).expect(200);
    expect(r.body.status).toBe('verify');
    expect(r.body.city).toBe('Monroe');
  });
  it('handles unknown and invalid ZIPs', async () => {
    expect((await request(app).get('/api/availability').query({ zip: '90210' })).body.status).toBe('unknown');
    await request(app).get('/api/availability').query({ zip: 'abc' }).expect(400);
  });
});

describe('lead capture', () => {
  it('creates a lead with normalized data and a booking token', async () => {
    const r = await request(app).post('/api/leads').send(validLead).expect(201);
    expect(r.body.bookingToken).toHaveLength(43);
    const lead = repo.getLead(db, r.body.leadId)!;
    expect(lead.email).toBe('jamie@example.com');
    expect(lead.phone).toBe('7345550142');
    expect(lead.areaStatus).toBe('verify');
  });
  it('requires consent and returns field errors', async () => {
    const r = await request(app).post('/api/leads').send({ ...validLead, consent: false, phone: '123' }).expect(400);
    expect(r.body.fields).toHaveProperty('consent');
    expect(r.body.fields).toHaveProperty('phone');
  });
  it('dedupes resubmissions from the same email + phone', async () => {
    const a = await request(app).post('/api/leads').send(validLead);
    const b = await request(app).post('/api/leads').send(validLead);
    expect(b.body.leadId).toBe(a.body.leadId);
    expect(repo.listLeads(db).total).toBe(1);
  });
  it('silently drops honeypot submissions', async () => {
    await request(app).post('/api/leads').send({ ...validLead, website: 'spam.example' }).expect(201);
    expect(repo.listLeads(db).total).toBe(0);
  });
});

describe('scheduling', () => {
  it('never offers slots inside the minimum lead time or on closed days', () => {
    const rules = rulesFromSettings(repo.getSettings(db));
    const now = new Date('2026-11-16T15:00:00Z'); // Monday 10am Detroit
    expect(candidateSlots('2026-11-16', rules, TZ, now)).toHaveLength(0); // all < 12h out
    expect(candidateSlots('2026-11-22', rules, TZ, now)).toHaveLength(0); // Sunday
    expect(candidateSlots('2026-11-17', rules, TZ, now).length).toBe(10); // 9am–7pm hourly
  });

  it('books a slot, marks the lead, and enforces capacity', async () => {
    const slot = await firstOpenSlot();
    const leads = [];
    for (let i = 0; i < 3; i++) {
      const r = await request(app).post('/api/leads').send({ ...validLead, email: `p${i}@example.com` });
      leads.push(r.body);
    }
    const book = (l: { leadId: string; bookingToken: string }) =>
      request(app).post('/api/appointments').send({ leadId: l.leadId, token: l.bookingToken, startUtc: slot.startUtc });
    await book(leads[0]).expect(201);
    await book(leads[1]).expect(201);
    await book(leads[2]).expect(409); // capacity 2
    expect(repo.getLead(db, leads[0].leadId)!.status).toBe('appointment_set');
    const after = availableSlots(db, (await request(app).get('/api/schedule/dates')).body.dates[0], TZ);
    expect(after.find((s) => s.startUtc === slot.startUtc)).toBeUndefined();
  });

  it('rejects a bad token and off-grid times', async () => {
    const slot = await firstOpenSlot();
    const { body: l } = await request(app).post('/api/leads').send(validLead);
    await request(app).post('/api/appointments').send({ leadId: l.leadId, token: 'x'.repeat(43), startUtc: slot.startUtc }).expect(403);
    const offGrid = new Date(new Date(slot.startUtc).getTime() + 17 * 60000).toISOString();
    await request(app).post('/api/appointments').send({ leadId: l.leadId, token: l.bookingToken, startUtc: offGrid }).expect(400);
  });

  it('reschedules instead of double-booking a lead', async () => {
    const { body: l } = await request(app).post('/api/leads').send(validLead);
    const date = (await request(app).get('/api/schedule/dates')).body.dates.at(-1);
    const slots = availableSlots(db, date, TZ);
    bookAppointment(db, { leadId: l.leadId, token: l.bookingToken, startUtc: slots[0].startUtc, notes: '' }, TZ);
    bookAppointment(db, { leadId: l.leadId, token: l.bookingToken, startUtc: slots[1].startUtc, notes: '' }, TZ);
    const appts = repo.listAppointments(db, { leadId: l.leadId });
    expect(appts.filter((a) => a.status === 'scheduled')).toHaveLength(1);
    expect(appts.filter((a) => a.status === 'cancelled')).toHaveLength(1);
  });
});

describe('admin', () => {
  it('blocks unauthenticated access and bad passwords', async () => {
    await request(app).get('/api/admin/leads').expect(401);
    await request(app).post('/api/admin/login').send({ email: 'admin@example.com', password: 'nope' }).expect(401);
  });
  it('lists leads, updates status with CSRF header, exports CSV', async () => {
    await request(app).post('/api/leads').send({ ...validLead, firstName: '=HYPERLINK("x")' });
    const agent = await adminAgent();
    const { body } = await agent.get('/api/admin/leads').expect(200);
    expect(body.total).toBe(1);
    const id = body.leads[0].id;
    await agent.patch(`/api/admin/leads/${id}`).send({ status: 'contacted' }).expect(403); // no header
    const r = await agent.patch(`/api/admin/leads/${id}`).set('X-Requested-With', 'fetch').send({ status: 'contacted', note: 'Left voicemail' }).expect(200);
    expect(r.body.lead.status).toBe('contacted');
    expect(r.body.notes.map((n: { body: string }) => n.body)).toContain('Left voicemail');
    const csv = await agent.get('/api/admin/leads.csv').expect(200);
    expect(csv.text).toContain(`"'=HYPERLINK(""x"")"`);
  });
  it('rejects tampered session cookies', async () => {
    await request(app).get('/api/admin/me').set('Cookie', 'fae_session=eyJlbWFpbCI6ImEifQ.forged').expect(401);
  });
});
