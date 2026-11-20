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

describe('client previews', () => {
  it('serves the Dynamic Construction preview with noindex and its own CSP', async () => {
    const r = await request(app()).get('/preview/dynamicconstruction/').expect(200);
    expect(r.text).toContain('Dynamic Construction');
    expect(r.headers['x-robots-tag']).toBe('noindex, nofollow');
    expect(r.headers['content-security-policy']).toContain("script-src 'self' 'unsafe-inline'");
  });

  it('adds the trailing slash to directory pages', async () => {
    const r = await request(app()).get('/preview/dynamicconstruction/services').expect(301);
    expect(r.headers.location).toBe('/preview/dynamicconstruction/services/');
  });

  it("returns the preview's own 404 page for unknown paths", async () => {
    const r = await request(app()).get('/preview/dynamicconstruction/nope/').expect(404);
    expect(r.text).toContain('on the plans');
  });

  it('does not change Tucker headers outside /preview', async () => {
    const r = await request(app()).get('/api/health');
    expect(r.headers['x-robots-tag']).toBeUndefined();
    expect(r.headers['content-security-policy']).toContain("default-src 'self'");
  });
});
