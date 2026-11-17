/** Operational readiness: health checks, request correlation, safe error logs, config validation. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app';
import { loadConfig, type AppConfig } from '../server/config';
import { openDatabase } from '../server/db';
import { hashPassword } from '../server/lib/auth';
import { allowedOutsideProduction, createNotifier } from '../server/notify';

process.env.NODE_ENV = 'test';

const cfg: AppConfig = {
  port: 0,
  flags: { env: 'production', platform: false, sampleData: false },
  databasePath: ':memory:',
  sessionSecret: 'x'.repeat(64),
  adminEmail: 'admin@example.com',
  adminPasswordHash: hashPassword('correct-horse-battery'),
  timezone: 'America/Detroit',
  siteUrl: 'https://example.test',
  isProduction: false,
  email: { resendApiKey: '', from: 'x <x@example.com>', teamEmails: [], dailyCustomerLimit: 80, nonProductionAllowlist: [] },
};
const make = () => {
  const db = openDatabase(':memory:');
  return { db, app: createApp(cfg, db, { notifier: createNotifier(db, cfg) }) };
};
afterEach(() => vi.restoreAllMocks());

describe('health check', () => {
  it('reports the database and the deployed version', async () => {
    const { app } = make();
    const r = await request(app).get('/api/health').expect(200);
    expect(r.body).toMatchObject({ ok: true, db: 'ok', env: 'production' });
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('fails with 503 when the database is unavailable (so Render stops routing traffic)', async () => {
    const { app, db } = make();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db.close();
    const r = await request(app).get('/api/health').expect(503);
    expect(r.body).toEqual({ ok: false, db: 'error' });
  });
});

describe('request ids and error logs', () => {
  it('tags every response with a request id, reusing a well-formed upstream id', async () => {
    const { app } = make();
    const a = await request(app).get('/api/health');
    expect(a.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const b = await request(app).get('/api/health').set('rndr-id', 'abc12345-render');
    expect(b.headers['x-request-id']).toBe('abc12345-render');
    const c = await request(app).get('/api/health').set('X-Request-Id', 'bad id with spaces <script>');
    expect(c.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('logs unexpected errors as one JSON line without query strings, bodies or contact details', async () => {
    const { app, db } = make();
    const lines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((l: unknown) => void lines.push(String(l)));
    db.close(); // every query now throws
    const r = await request(app).post('/api/leads?t=SECRET-TOKEN').send({ firstName: 'Jamie', lastName: 'Rivera', email: 'jamie@example.com', phone: '7345550142', street: '1 Main', city: 'Monroe', zip: '48161', consent: true });
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: 'Something went wrong. Please try again.', requestId: r.headers['x-request-id'] });
    const entry = JSON.parse(lines.find((l) => l.includes('unhandled_error'))!);
    expect(entry).toMatchObject({ level: 'error', event: 'unhandled_error', requestId: r.headers['x-request-id'], method: 'POST', path: '/api/leads' });
    expect(lines.join('\n')).not.toMatch(/SECRET-TOKEN|jamie@example\.com|7345550142|Rivera/);
  });
});

describe('configuration', () => {
  const base = { NODE_ENV: 'production', SESSION_SECRET: 's'.repeat(40), ADMIN_EMAIL: 'a@example.com', ADMIN_PASSWORD_HASH: hashPassword('correct-horse-battery') };

  it('defaults to the live-site behaviour with no new variables', () => {
    expect(loadConfig(base).flags).toEqual({ env: 'production', platform: true, sampleData: false });
  });

  it('rejects unsafe or malformed settings', () => {
    expect(() => loadConfig({ ...base, SAMPLE_DATA_ENABLED: 'true' })).toThrow(/production/);
    expect(() => loadConfig({ ...base, APP_ENV: 'prod' })).toThrow(/APP_ENV/);
  });

  it('parses the staging email allow-list', () => {
    const c = loadConfig({ ...base, APP_ENV: 'staging', STAGING_EMAIL_ALLOWLIST: ' QA@Spotlight.example , @example.com ' });
    expect(c.email.nonProductionAllowlist).toEqual(['qa@spotlight.example', '@example.com']);
    expect(allowedOutsideProduction('qa@spotlight.example', c.email.nonProductionAllowlist)).toBe(true);
    expect(allowedOutsideProduction('anyone@example.com', c.email.nonProductionAllowlist)).toBe(true);
    expect(allowedOutsideProduction('customer@gmail.com', c.email.nonProductionAllowlist)).toBe(false);
    expect(allowedOutsideProduction('x@notexample.com', c.email.nonProductionAllowlist)).toBe(false);
  });
});

describe('hero photo preload', () => {
  it('is sent only on the home page, which is the only page that shows the hero image', async () => {
    const { renderHtml } = await import('../server/html');
    const { readFileSync } = await import('node:fs');
    const { MONROE } = await import('../shared/market');
    const template = readFileSync('index.html', 'utf8');
    const boot = { market: MONROE, markets: [], defaultSlug: 'monroe', flags: { env: 'production' as const, platform: true, sampleData: false } };
    const other = renderHtml(template, { siteUrl: 'https://trytucker.com', canonicalPath: '/privacy', boot });
    const home = renderHtml(template, { siteUrl: 'https://trytucker.com', canonicalPath: '/', heroPreload: true, boot });
    expect(other).not.toMatch(/tucker-hero|hero-preload/);
    expect(home.match(/rel="preload" as="image"/g)).toHaveLength(1);
    expect(home).toContain('/media/tucker-hero-1280.webp');
    expect(other).toContain('<script type="application/json" id="boot-data">');
  });

});
