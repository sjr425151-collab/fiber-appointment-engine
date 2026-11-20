/** Client website previews: static, isolated from Tucker, never indexed. */
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app';
import { type AppConfig } from '../server/config';
import { openDatabase } from '../server/db';
import { hashPassword } from '../server/lib/auth';
import { createNotifier } from '../server/notify';

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
const app = () => {
  const db = openDatabase(':memory:');
  return createApp(cfg, db, { notifier: createNotifier(db, cfg) });
};

const LIVE = 'livefiberconnect.com';
const P = '/preview/dynamicconstruction';

describe('Dynamic Construction preview', () => {
  it('serves the preview on livefiberconnect.com with noindex and its own CSP', async () => {
    const r = await request(app()).get(`${P}/`).set('Host', LIVE).expect(200);
    expect(r.text).toContain('Dynamic Construction');
    expect(r.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(r.headers['content-security-policy']).toContain("script-src 'self' 'unsafe-inline'");
  });

  it('serves nested pages and adds the trailing slash', async () => {
    await request(app()).get(`${P}/services/pole-barns/`).set('Host', LIVE).expect(200);
    const r = await request(app()).get(`${P}/services`).set('Host', LIVE).expect(301);
    expect(r.headers.location).toBe(`${P}/services/`);
  });

  it("returns the preview's own 404 for unknown paths inside the preview", async () => {
    const r = await request(app()).get(`${P}/nope/`).set('Host', LIVE).expect(404);
    expect(r.text).toContain('on the plans');
  });

  it('is invisible on trytucker.com and any other host: Tucker answers exactly as for any unknown path', async () => {
    for (const host of ['trytucker.com', 'www.trytucker.com', 'example.test']) {
      const baseline = await request(app()).get('/some-unrelated-path/').set('Host', host);
      const r = await request(app()).get(`${P}/`).set('Host', host);
      expect(r.status).toBe(baseline.status);
      expect(r.headers['content-security-policy']).toBe(baseline.headers['content-security-policy']);
      expect(r.headers['x-robots-tag']).toBeUndefined();
      expect(r.text).not.toContain('Built to');
    }
  });

  it('does not answer on any other /preview path, even on livefiberconnect.com', async () => {
    const baseline = await request(app()).get('/some-unrelated-path/').set('Host', LIVE);
    for (const path of ['/preview', '/preview/', '/preview/other/', '/preview/dynamicconstruction-x/']) {
      const r = await request(app()).get(path).set('Host', LIVE);
      expect(r.status).toBe(baseline.status);
      expect(r.text).not.toContain('Built to');
      expect(r.headers['x-robots-tag']).toBeUndefined();
    }
  });

  it('leaves Tucker routes and headers unchanged on livefiberconnect.com', async () => {
    const r = await request(app()).get('/api/health').set('Host', LIVE).expect(200);
    expect(r.headers['x-robots-tag']).toBeUndefined();
    expect(r.headers['content-security-policy']).toContain("default-src 'self'");
  });
});
