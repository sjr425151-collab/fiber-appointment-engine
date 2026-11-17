/**
 * Domain migration: trytucker.com is canonical; livefiberconnect.com keeps
 * working until redirects are switched on, then every page URL moves with its
 * path and query intact. No loops, no API breakage, no open redirects.
 */
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app';
import { loadConfig, type AppConfig } from '../server/config';
import { openDatabase } from '../server/db';
import { hashPassword } from '../server/lib/auth';

process.env.NODE_ENV = 'test';

const TEMPLATE =
  '<html><head><title>%%TITLE%%</title><meta name="robots" content="%%ROBOTS%%" /><link rel="canonical" href="%%CANONICAL%%" /><meta property="og:url" content="%%CANONICAL%%" /><meta property="og:site_name" content="%%SITE_NAME%%" /><meta property="og:image" content="%%OG_IMAGE%%" /><!--%%HEAD_DATA%%--></head><body></body></html>';
const LEGACY = ['livefiberconnect.com', 'www.livefiberconnect.com'];

const config = (legacyRedirects: boolean, over: Partial<AppConfig> = {}): AppConfig => ({
  port: 0,
  flags: { env: 'production', platform: true, sampleData: false },
  databasePath: ':memory:',
  sessionSecret: 'x'.repeat(64),
  adminEmail: 'admin@example.com',
  adminPasswordHash: hashPassword('correct-horse-battery'),
  timezone: 'America/Detroit',
  siteUrl: 'https://trytucker.com',
  domains: { legacyHosts: LEGACY, legacyRedirects },
  isProduction: true,
  email: { resendApiKey: '', from: 'Tucker <hello@mail.trytucker.com>', teamEmails: [], dailyCustomerLimit: 80, nonProductionAllowlist: [] },
  ...over,
});
const make = (legacyRedirects: boolean, over: Partial<AppConfig> = {}) => createApp(config(legacyRedirects, over), openDatabase(':memory:'), { htmlTemplate: TEMPLATE });
const get = (app: ReturnType<typeof make>, host: string, path: string) => request(app).get(path).set('Host', host);

afterEach(() => {
  delete process.env.TRUST_PROXY;
});

describe('canonical domain', () => {
  it('uses trytucker.com for canonical links, share data, structured data, robots and the sitemap', async () => {
    const app = make(false);
    for (const [path, canonical] of [
      ['/', 'https://trytucker.com/'],
      ['/savings', 'https://trytucker.com/savings'],
      ['/savings/assess', 'https://trytucker.com/savings/assess'],
      ['/privacy', 'https://trytucker.com/privacy'],
    ]) {
      const page = await get(app, 'trytucker.com', path).expect(200);
      expect(page.text).toContain(`<link rel="canonical" href="${canonical}" />`);
      expect(page.text).toContain(`<meta property="og:url" content="${canonical}" />`);
      expect(page.text).toContain('<meta property="og:site_name" content="Tucker" />');
      expect(page.text).toContain('content="https://trytucker.com/og-');
      expect(page.text).not.toMatch(/livefiberconnect|LiveFiberConnect|Fiber Connect/);
    }
    const home = await get(app, 'trytucker.com', '/');
    expect(home.text).toContain('"url":"https://trytucker.com/"');
    expect((await get(app, 'trytucker.com', '/robots.txt')).text).toContain('Sitemap: https://trytucker.com/sitemap.xml');
    const sitemap = (await get(app, 'trytucker.com', '/sitemap.xml')).text;
    expect(sitemap.match(/<loc>[^<]+<\/loc>/g)).toEqual(['<loc>https://trytucker.com/</loc>', '<loc>https://trytucker.com/savings</loc>', '<loc>https://trytucker.com/savings/assess</loc>', '<loc>https://trytucker.com/privacy</loc>']);
  });

  it('lists the savings pages in the sitemap only where they are switched on', async () => {
    const off = make(false, { flags: { env: 'production', platform: false, sampleData: false } });
    expect((await get(off, 'trytucker.com', '/sitemap.xml')).text).not.toContain('/savings');
  });

  it('sends www to the bare domain, keeping the path and query', async () => {
    const app = make(false);
    const r = await get(app, 'www.trytucker.com', '/savings/assess?utm_source=facebook&utm_campaign=a%20b').expect(301);
    expect(r.headers.location).toBe('https://trytucker.com/savings/assess?utm_source=facebook&utm_campaign=a%20b');
  });

  it('never redirects the canonical host, so there can be no loop', async () => {
    for (const on of [false, true]) {
      const app = make(on);
      for (const path of ['/', '/savings', '/privacy', '/admin/login', '/robots.txt', '/sitemap.xml', '/api/health']) {
        const r = await get(app, 'trytucker.com', path);
        expect({ path, status: r.status, location: r.headers.location }).toEqual({ path, status: 200, location: undefined });
      }
    }
  });
});

describe('previous domain before the switch', () => {
  it('keeps serving every page, already pointing search engines at the new domain', async () => {
    const app = make(false);
    for (const host of LEGACY) {
      const page = await get(app, host, '/savings?utm_source=old').expect(200);
      expect(page.text).toContain('<link rel="canonical" href="https://trytucker.com/savings" />');
    }
  });
});

describe('previous domain after the switch', () => {
  const app = () => make(true);

  it('permanently redirects each page to the same path and query on the new domain', async () => {
    const a = app();
    for (const host of LEGACY) {
      for (const path of ['/', '/savings', '/savings/assess?utm_source=facebook&fbclid=X1', '/savings/results/abc-123', '/monroe', '/privacy', '/admin/login', '/sitemap.xml', '/no-such-page?x=1']) {
        const r = await get(a, host, path);
        expect({ host, path, status: r.status, to: r.headers.location }).toEqual({ host, path, status: 301, to: `https://trytucker.com${path}` });
      }
    }
    const r = await get(a, 'livefiberconnect.com', '/savings');
    expect(r.headers['cache-control']).toBe('public, max-age=3600');
    // The redirect target itself answers 200: a single hop, no chain.
    const target = new URL(r.headers.location);
    await get(a, target.hostname, target.pathname).expect(200);
  });

  it('cannot be steered to another site', async () => {
    const a = app();
    for (const path of ['//evil.example/x', '/%2F%2Fevil.example', '/\\evil.example']) {
      const r = await get(a, 'livefiberconnect.com', path);
      expect(r.status).toBe(301);
      expect(new URL(r.headers.location).origin).toBe('https://trytucker.com');
    }
  });

  it('leaves the API and form submissions alone, so an open page on the old domain still works', async () => {
    const a = app();
    await get(a, 'livefiberconnect.com', '/api/health').expect(200);
    await get(a, 'livefiberconnect.com', '/api/availability?zip=48161').expect(200);
    const post = await request(a).post('/api/leads').set('Host', 'livefiberconnect.com').send({});
    expect(post.status).toBe(400); // validated as usual, not redirected
    const page = await request(a).post('/savings').set('Host', 'livefiberconnect.com');
    expect(page.status).not.toBe(301);
  });

  it('ignores hosts it does not know (Render address, health checks, localhost)', async () => {
    const a = app();
    for (const host of ['fiber-connect.onrender.com', 'localhost:3001', '10.0.0.5']) await get(a, host, '/savings').expect(200);
  });

  it('reads the public host behind the proxy', async () => {
    process.env.TRUST_PROXY = '1';
    const r = await request(app()).get('/savings?a=1').set('Host', 'internal:10000').set('X-Forwarded-Host', 'livefiberconnect.com');
    expect([r.status, r.headers.location]).toEqual([301, 'https://trytucker.com/savings?a=1']);
  });
});

describe('configuration safety', () => {
  const env = { NODE_ENV: 'production', SESSION_SECRET: 's'.repeat(40), ADMIN_PASSWORD_HASH: hashPassword('correct-horse-battery') };

  it('reads the migration settings, and a typo can never stop the site or switch redirects on', () => {
    const c = loadConfig({ ...env, SITE_URL: 'https://trytucker.com/', LEGACY_HOSTS: ' LiveFiberConnect.com , www.livefiberconnect.com, bad host! ', LEGACY_REDIRECTS: 'true' });
    expect(c.siteUrl).toBe('https://trytucker.com');
    expect(c.domains).toEqual({ legacyHosts: LEGACY, legacyRedirects: true });
    for (const v of ['on', 'yes', 'TRUE ', '', undefined]) {
      const parsed = loadConfig({ ...env, LEGACY_REDIRECTS: v }).domains!.legacyRedirects;
      expect(parsed).toBe(v === 'TRUE ');
    }
    expect(loadConfig(env).domains).toEqual({ legacyHosts: [], legacyRedirects: false });
  });

  it('does nothing if the canonical domain is itself listed as legacy', async () => {
    const stillOld = make(true, { siteUrl: 'https://livefiberconnect.com' });
    await get(stillOld, 'livefiberconnect.com', '/savings').expect(200);
    const r = await get(stillOld, 'www.livefiberconnect.com', '/savings').expect(301);
    expect(r.headers.location).toBe('https://livefiberconnect.com/savings');
  });
});
