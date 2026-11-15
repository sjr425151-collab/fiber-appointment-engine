import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app';
import { openDatabase, type DB } from '../server/db';
import { hashPassword } from '../server/lib/auth';
import { availableSlots, bookAppointment, candidateSlots } from '../server/scheduling';
import { MONROE, marketSchema, type Market } from '../shared/market';
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
  siteUrl: 'https://fiber.example.com',
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
    const rules = MONROE.schedule;
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
    const after = availableSlots(db, MONROE, (await request(app).get('/api/schedule/dates')).body.dates[0]);
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
    const slots = availableSlots(db, MONROE, date);
    bookAppointment(db, { leadId: l.leadId, token: l.bookingToken, startUtc: slots[0].startUtc, notes: '' });
    bookAppointment(db, { leadId: l.leadId, token: l.bookingToken, startUtc: slots[1].startUtc, notes: '' });
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

describe('conversion tracking & SEO', () => {
  it('stores attribution on leads and records server-side conversion events', async () => {
    const r = await request(app)
      .post('/api/leads')
      .send({ ...validLead, utmSource: 'facebook', utmCampaign: 'monroe_launch', clickId: 'fbclid:abc', referrer: 'https://m.facebook.com/', landingPage: '/?utm_source=facebook', sessionId: 's1' })
      .expect(201);
    const lead = repo.getLead(db, r.body.leadId)!;
    expect(lead.clickId).toBe('fbclid:abc');
    expect(lead.landingPage).toBe('/?utm_source=facebook');
    const slot = await firstOpenSlot();
    await request(app).post('/api/appointments').send({ leadId: r.body.leadId, token: r.body.bookingToken, startUtc: slot.startUtc }).expect(201);
    const stats = repo.conversionStats(db);
    expect(stats.funnel.lead_submit.events).toBe(1);
    expect(stats.funnel.appointment_booked.events).toBe(1);
    expect(stats.sources[0]).toMatchObject({ source: 'facebook', leads: 1, qualified: 1 });
  });

  it('accepts allowlisted client events and ignores spoofed server-side ones', async () => {
    await request(app).post('/api/events').send({ name: 'zip_check', sessionId: 's1', props: { status: 'verify' } }).expect(204);
    await request(app).post('/api/events').send({ name: 'lead_submit', sessionId: 's1' }).expect(204);
    await request(app).post('/api/events').send({ name: 'drop_tables' }).expect(400);
    const { funnel } = repo.conversionStats(db);
    expect(funnel.zip_check.sessions).toBe(1);
    expect(funnel.lead_submit).toBeUndefined();
  });

  it('serves robots.txt and sitemap.xml with the configured origin', async () => {
    const robots = await request(app).get('/robots.txt').expect(200);
    expect(robots.text).toContain('Sitemap: https://fiber.example.com/sitemap.xml');
    expect(robots.text).toContain('Disallow: /admin');
    const sitemap = await request(app).get('/sitemap.xml').expect(200);
    expect(sitemap.text).toContain('<loc>https://fiber.example.com/</loc>');
    expect(sitemap.text).toContain('<loc>https://fiber.example.com/privacy</loc>');
  });

  it('exposes conversion stats to admins only', async () => {
    await request(app).get('/api/admin/conversions').expect(401);
    const agent = await adminAgent();
    const r = await agent.get('/api/admin/conversions').expect(200);
    expect(r.body).toHaveProperty('funnel');
  });
});

describe('multi-location markets', () => {
  const toledo = (): Market =>
    marketSchema.parse({
      ...MONROE,
      slug: 'toledo',
      name: 'Toledo',
      state: 'OH',
      timezone: 'America/New_York',
      phoneDisplay: '(419) 555-0100',
      phoneE164: '+14195550100',
      plans: [{ name: '500 Mbps', price: '$40/mo', highlights: ['No contracts'] }],
      schedule: { ...MONROE.schedule, capacityPerSlot: 1 },
      isDefault: false,
      ogImage: '',
    });

  async function addToledo() {
    const agent = await adminAgent();
    await agent.post('/api/admin/markets').set('X-Requested-With', 'fetch').send(toledo()).expect(201);
    await agent.put('/api/admin/service-areas').set('X-Requested-With', 'fetch').send({ zip: '43604', city: 'Toledo', status: 'available', marketId: 'toledo' }).expect(200);
    return agent;
  }

  it('seeds Monroe as the default market and exposes it publicly', async () => {
    const r = await request(app).get('/api/markets').expect(200);
    expect(r.body).toMatchObject({ defaultSlug: 'monroe', markets: [{ slug: 'monroe', name: 'Monroe', state: 'MI' }] });
    const m = await request(app).get('/api/markets/monroe').expect(200);
    expect(m.body.market.plans.map((p: { price: string }) => p.price)).toEqual(['$50/mo', '$70/mo']);
    await request(app).get('/api/markets/nowhere').expect(404);
  });

  it('creates a location from admin with validation and reserved-slug protection', async () => {
    const agent = await adminAgent();
    await agent.post('/api/admin/markets').set('X-Requested-With', 'fetch').send({ ...toledo(), slug: 'admin' }).expect(400);
    await agent.post('/api/admin/markets').set('X-Requested-With', 'fetch').send({ ...toledo(), phoneE164: '555' }).expect(400);
    await agent.post('/api/admin/markets').set('X-Requested-With', 'fetch').send(toledo()).expect(201);
    await agent.post('/api/admin/markets').set('X-Requested-With', 'fetch').send(toledo()).expect(409);
    expect((await request(app).get('/api/markets')).body.markets.map((m: { slug: string }) => m.slug)).toEqual(['monroe', 'toledo']);
  });

  it('keeps exactly one active default location', async () => {
    const agent = await addToledo();
    await agent.put('/api/admin/markets/monroe').set('X-Requested-With', 'fetch').send({ ...MONROE, isDefault: false }).expect(400);
    await agent.put('/api/admin/markets/toledo').set('X-Requested-With', 'fetch').send({ ...toledo(), isDefault: true }).expect(200);
    expect((await request(app).get('/api/markets')).body.defaultSlug).toBe('toledo');
    expect(repo.getMarket(db, 'monroe')!.isDefault).toBe(false);
    await agent.put('/api/admin/markets/toledo').set('X-Requested-With', 'fetch').send({ ...toledo(), isDefault: true, active: false }).expect(400);
  });

  it('describes availability with the provider of the market that owns the ZIP', async () => {
    await addToledo();
    const r = await request(app).get('/api/availability').query({ zip: '43604' }).expect(200);
    expect(r.body).toMatchObject({ status: 'available', city: 'Toledo', market: { slug: 'toledo' } });
  });

  it('routes leads to the owning market and uses that market’s calendar and capacity', async () => {
    await addToledo();
    // Toledo ZIP submitted from the Monroe page → same provider → Toledo lead
    const a = await request(app).post('/api/leads').send({ ...validLead, zip: '43604', city: 'Toledo', market: 'monroe' }).expect(201);
    expect(a.body.market).toBe('toledo');
    expect(repo.getLead(db, a.body.leadId)!.marketId).toBe('toledo');

    const dates = (await request(app).get('/api/schedule/dates').query({ market: 'toledo' })).body;
    expect(dates.timezone).toBe('America/New_York');
    const toledoMarket = repo.getMarket(db, 'toledo')!;
    let slot = null;
    for (const d of dates.dates) {
      const s = availableSlots(db, toledoMarket, d);
      if (s.length) { slot = s[0]; break; }
    }
    await request(app).post('/api/appointments').send({ leadId: a.body.leadId, token: a.body.bookingToken, startUtc: slot!.startUtc }).expect(201);
    // Toledo capacity is 1 → slot now full in Toledo…
    const b = await request(app).post('/api/leads').send({ ...validLead, email: 'b@example.com', zip: '43604', city: 'Toledo' });
    await request(app).post('/api/appointments').send({ leadId: b.body.leadId, token: b.body.bookingToken, startUtc: slot!.startUtc }).expect(409);
    // …but Monroe's calendar at the same instant is untouched.
    expect(repo.countBookedAt(db, 'monroe', slot!.startUtc)).toBe(0);
    expect(repo.listAppointments(db, { fromUtc: '', market: 'toledo' })).toHaveLength(1);
    expect(repo.conversionStats(db, 30, 'toledo').funnel.appointment_booked.events).toBe(1);
  });

  it('records the consent wording for the provider shown on the page', async () => {
    const r = await request(app).post('/api/leads').send(validLead).expect(201);
    const row = db.prepare('SELECT consent_text FROM leads WHERE id = ?').get(r.body.leadId) as { consent_text: string };
    expect(row.consent_text).toContain('on behalf of Omni Fiber');
  });

  it('lists active locations in the sitemap (default market at the root)', async () => {
    await addToledo();
    const sitemap = (await request(app).get('/sitemap.xml')).text;
    expect(sitemap).toContain('<loc>https://fiber.example.com/</loc>');
    expect(sitemap).toContain('<loc>https://fiber.example.com/toledo</loc>');
    expect(sitemap).not.toContain('/monroe</loc>');
  });

  it('filters admin leads and CSV by location', async () => {
    await addToledo();
    await request(app).post('/api/leads').send(validLead);
    await request(app).post('/api/leads').send({ ...validLead, email: 't@example.com', zip: '43604', city: 'Toledo' });
    const agent = await adminAgent();
    expect((await agent.get('/api/admin/leads').query({ market: 'toledo' })).body.total).toBe(1);
    expect((await agent.get('/api/admin/leads').query({ market: 'monroe' })).body.total).toBe(1);
    const csv = (await agent.get('/api/admin/leads.csv').query({ market: 'toledo' })).text;
    expect(csv.split('\n')).toHaveLength(2);
    expect(csv).toContain('"toledo"');
  });
});

describe('per-location page rendering', () => {
  const tpl =
    '<title>%%TITLE%%</title><meta name="description" content="%%DESCRIPTION%%" /><meta name="robots" content="%%ROBOTS%%" />' +
    '<link rel="canonical" href="%%CANONICAL%%" /><meta property="og:image" content="%%OG_IMAGE%%" /><!--%%HEAD_DATA%%-->';

  it('renders location-specific SEO tags and boot data', async () => {
    const { renderHtml } = await import('../server/html');
    const html = renderHtml(tpl, {
      siteUrl: 'https://x.test',
      canonicalPath: '/',
      boot: { market: MONROE, markets: [{ slug: 'monroe', name: 'Monroe', state: 'MI' }], defaultSlug: 'monroe' },
    });
    expect(html).toContain('<title>Omni Fiber Internet in Monroe, MI');
    expect(html).toContain('1 Gig for $50/mo or 2 Gig for $70/mo');
    expect(html).toContain('<link rel="canonical" href="https://x.test/" />');
    expect(html).toContain('content="https://x.test/og-monroe.jpg"');
    expect(html).toContain('content="index, follow"');
    expect(html).toContain('"@type":"FAQPage"');
    expect(html).toContain('<script type="application/json" id="boot-data">');
    expect(html).not.toContain('%%');
  });

  it('escapes hostile location text in attributes and embedded JSON', async () => {
    const { renderHtml } = await import('../server/html');
    const evil = { ...MONROE, name: '</script><script>alert(1)</script>"' };
    const html = renderHtml(tpl, { siteUrl: 'https://x.test', canonicalPath: '/x', noindex: true, boot: { market: evil, markets: [], defaultSlug: 'monroe' } });
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('\\u003c/script>');
    expect(html).toContain('content="noindex, nofollow"');
  });
});
