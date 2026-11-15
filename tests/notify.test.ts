import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app';
import { openDatabase, type DB } from '../server/db';
import { hashPassword } from '../server/lib/auth';
import { availableSlots } from '../server/scheduling';
import { createNotifier, listNotifications, reminderTime, type Notifier } from '../server/notify';
import { MailError, ResendMailer, type Mailer, type OutgoingEmail } from '../server/notify/mailer';
import { buildIcs } from '../server/notify/ics';
import * as repo from '../server/repo';
import { MONROE } from '../shared/market';
import type { AppConfig } from '../server/config';

process.env.NODE_ENV = 'test';

class FakeMailer implements Mailer {
  readonly enabled = true;
  sent: OutgoingEmail[] = [];
  /** Return an error to make a matching send fail (checked on every attempt). */
  failWhen: (e: OutgoingEmail) => Error | null = () => null;
  async send(e: OutgoingEmail) {
    const f = this.failWhen(e);
    if (f) throw f;
    this.sent.push(e);
    return { status: 'sent' as const, providerId: `prov-${this.sent.length}` };
  }
  bySubject(re: RegExp) {
    return this.sent.filter((e) => re.test(e.subject));
  }
}

const config = (teamEmails: string[] = []): AppConfig => ({
  port: 0,
  databasePath: ':memory:',
  sessionSecret: 'x'.repeat(64),
  adminEmail: 'admin@example.com',
  adminPasswordHash: hashPassword('correct-horse-battery'),
  timezone: 'America/Detroit',
  siteUrl: 'https://livefiberconnect.com',
  isProduction: false,
  email: { resendApiKey: '', from: 'Fiber Connect <hello@mail.livefiberconnect.com>', teamEmails },
});

const lead = {
  firstName: 'Jamie',
  lastName: 'Rivera',
  email: 'jamie@example.com',
  phone: '7345550142',
  street: '123 E Front St',
  city: 'Monroe',
  zip: '48161',
  consent: true,
};

let db: DB;
let mailer: FakeMailer;
let notifier: Notifier;
let app: ReturnType<typeof createApp>;

function setup(teamEmails: string[] = [], marketTeam: string[] = ['team@spotlight.example']) {
  db = openDatabase(':memory:');
  repo.saveMarket(db, { ...MONROE, notifyEmails: marketTeam });
  mailer = new FakeMailer();
  notifier = createNotifier(db, config(teamEmails), mailer);
  app = createApp(config(teamEmails), db, { notifier });
}

beforeEach(() => setup());

const minutes = (n: number) => new Date(Date.now() + n * 60_000);

async function bookFirstSlot(l: { leadId: string; bookingToken: string }, dayIndex = 2) {
  const dates = (await request(app).get('/api/schedule/dates')).body.dates as string[];
  const slots = availableSlots(db, MONROE, dates[dayIndex]);
  const r = await request(app).post('/api/appointments').send({ leadId: l.leadId, token: l.bookingToken, startUtc: slots[0].startUtc }).expect(201);
  return { ...r.body.appointment, slots };
}

describe('team alerts', () => {
  it('emails the location team about a new lead with a link to the admin', async () => {
    const r = await request(app).post('/api/leads').send(lead).expect(201);
    await notifier.processDue();
    const [alert] = mailer.bySubject(/^New lead: Jamie Rivera — Monroe \(48161\)$/);
    expect(alert.to).toEqual(['team@spotlight.example']);
    expect(alert.replyTo).toEqual(['jamie@example.com']);
    expect(alert.html).toContain(`https://livefiberconnect.com/admin/leads/${r.body.leadId}`);
    expect(alert.text).toContain('Phone: (734) 555-0142');
    expect(alert.from).toBe('Fiber Connect <hello@mail.livefiberconnect.com>');
  });

  it('labels resubmissions as returning leads and does not re-send the customer follow-up', async () => {
    await request(app).post('/api/leads').send(lead);
    await request(app).post('/api/leads').send(lead);
    await notifier.processDue(minutes(30));
    expect(mailer.bySubject(/^Returning lead: Jamie Rivera/)).toHaveLength(1);
    expect(mailer.bySubject(/We got your request/)).toHaveLength(1);
  });

  it('falls back to TEAM_NOTIFY_EMAIL, and records a skip when no team inbox exists', async () => {
    setup(['owner@spotlight.example'], []);
    await request(app).post('/api/leads').send(lead);
    await notifier.processDue();
    expect(mailer.bySubject(/^New lead/)[0].to).toEqual(['owner@spotlight.example']);

    setup([], []);
    const r = await request(app).post('/api/leads').send(lead);
    await notifier.processDue();
    const row = listNotifications(db, r.body.leadId).find((n) => n.kind === 'team_new_lead')!;
    expect(row.status).toBe('skipped');
    expect(row.error).toMatch(/No team email/);
  });

  it('does not email for honeypot submissions', async () => {
    await request(app).post('/api/leads').send({ ...lead, website: 'spam' }).expect(201);
    await notifier.processDue(minutes(60));
    expect(mailer.sent).toHaveLength(0);
  });
});

describe('customer emails', () => {
  it('sends a confirmation with a calendar invite and a team booking alert', async () => {
    const { body: l } = await request(app).post('/api/leads').send(lead);
    const appt = await bookFirstSlot(l);
    await notifier.processDue();

    const [confirm] = mailer.bySubject(/^You're booked: fiber consultation on /);
    expect(confirm.to).toEqual(['jamie@example.com']);
    expect(confirm.replyTo).toEqual(['team@spotlight.example']);
    expect(confirm.text).toContain('123 E Front St');
    expect(confirm.text).toContain('(734) 731-1946');
    const ics = Buffer.from(confirm.attachments![0].content, 'base64').toString();
    expect(confirm.attachments![0].filename).toBe('fiber-consultation.ics');
    expect(ics).toContain(`DTSTART:${appt.startUtc.replace(/[-:]/g, '').replace('.000', '')}`);
    expect(ics).toContain('LOCATION:123 E Front St\\, Monroe\\, MI 48161');

    expect(mailer.bySubject(/^Booked: Jamie Rivera — /)[0].to).toEqual(['team@spotlight.example']);
  });

  it('sends the "we got your request" follow-up only if the lead has not booked', async () => {
    const { body: a } = await request(app).post('/api/leads').send(lead);
    await request(app).post('/api/leads').send({ ...lead, email: 'b@example.com', phone: '7345550199' });
    await bookFirstSlot(a);
    await notifier.processDue(minutes(5));
    expect(mailer.bySubject(/We got your request/)).toHaveLength(0); // not due yet
    await notifier.processDue(minutes(25));
    const followups = mailer.bySubject(/We got your request/);
    expect(followups.map((e) => e.to[0])).toEqual(['b@example.com']);
    const skipped = listNotifications(db, a.leadId).find((n) => n.kind === 'customer_lead_received')!;
    expect(skipped.status).toBe('skipped');
  });

  it('schedules a reminder the day before and sends it then', async () => {
    const { body: l } = await request(app).post('/api/leads').send(lead);
    const appt = await bookFirstSlot(l, 3);
    const row = listNotifications(db, l.leadId).find((n) => n.kind === 'customer_reminder')!;
    expect(new Date(row.sendAfter).getTime()).toBe(new Date(appt.startUtc).getTime() - 24 * 3600_000);
    await notifier.processDue();
    expect(mailer.bySubject(/^Reminder:/)).toHaveLength(0);
    await notifier.processDue(new Date(row.sendAfter));
    expect(mailer.bySubject(/^Reminder: your fiber consultation is /)).toHaveLength(1);
  });

  it('skips the reminder if the appointment is cancelled, and reminds about the new time after a reschedule', async () => {
    const { body: l } = await request(app).post('/api/leads').send(lead);
    const first = await bookFirstSlot(l, 3);
    // Reschedule to the next slot (same token)
    await request(app).post('/api/appointments').send({ leadId: l.leadId, token: l.bookingToken, startUtc: first.slots[1].startUtc }).expect(201);
    const reminders = listNotifications(db, l.leadId).filter((n) => n.kind === 'customer_reminder');
    expect(reminders).toHaveLength(2);
    await notifier.processDue(new Date(new Date(first.startUtc).getTime() - 60_000));
    const sent = mailer.bySubject(/^Reminder:/);
    expect(sent).toHaveLength(1); // only the new appointment's reminder
    const statuses = listNotifications(db, l.leadId).filter((n) => n.kind === 'customer_reminder').map((n) => n.status).sort();
    expect(statuses).toEqual(['sent', 'skipped']);
  });

  it('does not email twice when the same slot is submitted again', async () => {
    const { body: l } = await request(app).post('/api/leads').send(lead);
    const appt = await bookFirstSlot(l);
    await request(app).post('/api/appointments').send({ leadId: l.leadId, token: l.bookingToken, startUtc: appt.startUtc }).expect(201);
    await notifier.processDue();
    expect(mailer.bySubject(/^You're booked/)).toHaveLength(1);
  });

  it('escapes visitor input in HTML and keeps subjects on one line', async () => {
    await request(app)
      .post('/api/leads')
      .send({ ...lead, firstName: '<img src=x onerror=alert(1)>', lastName: 'Evil\r\nBcc: x@evil.test', street: '1 <b>Main</b> St' });
    await notifier.processDue();
    const [alert] = mailer.bySubject(/^New lead/);
    expect(alert.html).not.toContain('<img src=x');
    expect(alert.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(alert.html).toContain('1 &lt;b&gt;Main&lt;/b&gt; St');
    expect(alert.subject).not.toMatch(/[\r\n]/);
  });
});

describe('delivery & retries', () => {
  const isTeamAlertFor = (e: OutgoingEmail, who: string) => e.tags?.[0].value === 'team_new_lead' && e.replyTo?.[0] === who;

  it('retries transient failures with backoff, then succeeds', async () => {
    let failuresLeft = 1;
    mailer.failWhen = (e) => (isTeamAlertFor(e, 'jamie@example.com') && failuresLeft-- > 0 ? new MailError('Resend 429: rate limited', true) : null);
    const { body: l } = await request(app).post('/api/leads').send(lead);
    await notifier.processDue();
    const row = listNotifications(db, l.leadId).find((n) => n.kind === 'team_new_lead')!;
    expect(row).toMatchObject({ status: 'pending', attempts: 1, error: 'Resend 429: rate limited' });
    expect(new Date(row.sendAfter).getTime()).toBeGreaterThan(Date.now() + 50_000); // 1 minute backoff
    await notifier.processDue(minutes(2));
    expect(listNotifications(db, l.leadId).find((n) => n.kind === 'team_new_lead')).toMatchObject({ status: 'sent', attempts: 2, error: '' });
  });

  it('gives up after 5 attempts', async () => {
    mailer.failWhen = (e) => (isTeamAlertFor(e, 'jamie@example.com') ? new MailError('Resend 500', true) : null);
    const { body: l } = await request(app).post('/api/leads').send(lead);
    for (const m of [0, 2, 8, 25, 90, 200]) await notifier.processDue(minutes(m));
    expect(listNotifications(db, l.leadId).find((n) => n.kind === 'team_new_lead')).toMatchObject({ status: 'failed', attempts: 5, error: 'Resend 500' });
  });

  it('does not retry permanent errors', async () => {
    mailer.failWhen = (e) => (isTeamAlertFor(e, 'jamie@example.com') ? new MailError('Resend 422: invalid from address', false) : null);
    const { body: l } = await request(app).post('/api/leads').send(lead);
    await notifier.processDue(minutes(60));
    expect(listNotifications(db, l.leadId).find((n) => n.kind === 'team_new_lead')).toMatchObject({ status: 'failed', attempts: 1 });
  });

  it('marks emails as "logged" when no provider is configured', async () => {
    const quiet = openDatabase(':memory:');
    repo.saveMarket(quiet, { ...MONROE, notifyEmails: ['team@spotlight.example'] });
    const n = createNotifier(quiet, config());
    const a = createApp(config(), quiet, { notifier: n });
    const { body: l } = await request(a).post('/api/leads').send(lead);
    await n.processDue();
    expect(n.enabled).toBe(false);
    expect(listNotifications(quiet, l.leadId).find((x) => x.kind === 'team_new_lead')!.status).toBe('logged');
  });

  it('shows email history on the admin lead page and reports email status', async () => {
    const { body: l } = await request(app).post('/api/leads').send(lead);
    await notifier.processDue();
    const agent = request.agent(app);
    await agent.post('/api/admin/login').send({ email: 'admin@example.com', password: 'correct-horse-battery' }).expect(200);
    const detail = (await agent.get(`/api/admin/leads/${l.leadId}`)).body;
    expect(detail.notifications.map((n: { kind: string; status: string }) => `${n.kind}:${n.status}`)).toContain('team_new_lead:sent');
    const me = (await agent.get('/api/admin/me')).body;
    expect(me).toMatchObject({ emailEnabled: true, locationsWithoutTeamEmail: [] });
  });
});

describe('Resend client', () => {
  const email: OutgoingEmail = {
    from: 'Fiber Connect <hello@mail.livefiberconnect.com>',
    to: ['a@example.com'],
    subject: 'Hi',
    html: '<p>Hi</p>',
    text: 'Hi',
    replyTo: ['team@example.com'],
    attachments: [{ filename: 'x.ics', content: 'QUJD' }],
    tags: [{ name: 'kind', value: 'customer_confirmation' }],
    idempotencyKey: 'row-123',
  };

  it('sends the documented REST payload with auth and idempotency headers', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      captured = { url, init };
      return new Response(JSON.stringify({ id: 'abc' }), { status: 200 });
    }) as unknown as typeof fetch;
    const res = await new ResendMailer('re_test', fakeFetch).send(email);
    expect(res).toEqual({ status: 'sent', providerId: 'abc' });
    expect(captured!.url).toBe('https://api.resend.com/emails');
    const headers = captured!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer re_test');
    expect(headers['Idempotency-Key']).toBe('row-123');
    expect(JSON.parse(captured!.init.body as string)).toEqual({
      from: email.from,
      to: ['a@example.com'],
      subject: 'Hi',
      html: '<p>Hi</p>',
      text: 'Hi',
      reply_to: ['team@example.com'],
      attachments: [{ filename: 'x.ics', content: 'QUJD' }],
      tags: [{ name: 'kind', value: 'customer_confirmation' }],
    });
  });

  it('classifies errors as retryable or permanent', async () => {
    const respond = (status: number) => (async () => new Response(JSON.stringify({ message: 'nope' }), { status })) as unknown as typeof fetch;
    await expect(new ResendMailer('k', respond(429)).send(email)).rejects.toMatchObject({ retryable: true });
    await expect(new ResendMailer('k', respond(503)).send(email)).rejects.toMatchObject({ retryable: true });
    await expect(new ResendMailer('k', respond(422)).send(email)).rejects.toMatchObject({ retryable: false, message: 'Resend 422: nope' });
    const offline = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(new ResendMailer('k', offline).send(email)).rejects.toMatchObject({ retryable: true });
  });
});

describe('helpers', () => {
  it('times reminders 24h before, else 3h before, else not at all', () => {
    const now = new Date('2026-11-16T12:00:00Z');
    expect(reminderTime('2026-11-18T14:00:00Z', now)!.toISOString()).toBe('2026-11-17T14:00:00.000Z');
    expect(reminderTime('2026-11-17T06:00:00Z', now)!.toISOString()).toBe('2026-11-17T03:00:00.000Z');
    expect(reminderTime('2026-11-16T14:00:00Z', now)).toBeNull();
  });

  it('builds a valid, escaped and folded calendar invite', () => {
    const ics = buildIcs({
      uid: 'a1@fiber-connect',
      startUtc: '2026-11-17T14:00:00.000Z',
      endUtc: '2026-11-17T15:00:00.000Z',
      summary: 'Free fiber consultation (Omni Fiber)',
      description: 'Line one; with, punctuation\nLine two ' + 'x'.repeat(120),
      location: '123 E Front St, Monroe, MI 48161',
      now: new Date('2026-11-15T00:00:00Z'),
    });
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('DTSTART:20261117T140000Z\r\n');
    expect(ics).toContain('DESCRIPTION:Line one\\; with\\, punctuation\\nLine two');
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
  });
});
