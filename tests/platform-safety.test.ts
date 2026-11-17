import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app';
import { loadConfig, type AppConfig } from '../server/config';
import { openDatabase } from '../server/db';
import { hashPassword } from '../server/lib/auth';
import { marketSchema, MONROE } from '../shared/market';

process.env.NODE_ENV = 'test';

const TEMPLATE =
  '<html><head><title>%%TITLE%%</title><meta name="robots" content="%%ROBOTS%%" /><link rel="canonical" href="%%CANONICAL%%" /><!--%%HEAD_DATA%%--></head><body></body></html>';

const base = (flags: AppConfig['flags']): AppConfig => ({
  port: 0,
  flags,
  databasePath: ':memory:',
  sessionSecret: 'x'.repeat(64),
  adminEmail: 'admin@example.com',
  adminPasswordHash: hashPassword('correct-horse-battery'),
  timezone: 'America/Detroit',
  siteUrl: 'https://livefiberconnect.com',
  isProduction: true,
  email: { resendApiKey: '', from: 'x <x@example.com>', teamEmails: [], dailyCustomerLimit: 80, nonProductionAllowlist: [] },
});
const PROD = base({ env: 'production', platform: true, sampleData: false });
const STAGING = base({ env: 'staging', platform: true, sampleData: true });
const app = (c: AppConfig) => createApp(c, openDatabase(':memory:'), { htmlTemplate: TEMPLATE });

describe('production configuration', () => {
  it('runs Tucker as the application in production, with sample data off', () => {
    const c = loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(44), ADMIN_PASSWORD: 'correct-horse-battery' });
    expect(c.flags).toEqual({ env: 'production', platform: true, sampleData: false });
    // The retired launch switch is ignored, whatever it holds.
    expect(loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(44), ADMIN_PASSWORD: 'correct-horse-battery', PLATFORM_ENABLED: 'false' }).flags.platform).toBe(true);
  });

  it('refuses sample data in production and rejects malformed settings', () => {
    const env = { NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(44), ADMIN_PASSWORD: 'correct-horse-battery' };
    expect(() => loadConfig({ ...env, SAMPLE_DATA_ENABLED: 'true' })).toThrow(/cannot be used when APP_ENV=production/);
    expect(() => loadConfig({ ...env, APP_ENV: 'prod' })).toThrow(/APP_ENV/);
    expect(loadConfig({ ...env, APP_ENV: 'staging', SAMPLE_DATA_ENABLED: 'true' }).flags).toEqual({ env: 'staging', platform: true, sampleData: true });
  });

  it('serves Tucker’s national home at the root, indexable, with no location or provider in its metadata', async () => {
    const a = app(PROD);
    const home = await request(a).get('/').expect(200);
    expect(home.text).toContain('<title>Tucker | Preview Potential Savings on Your Household Bills</title>');
    expect(home.text).toContain('content="index, follow"');
    expect(home.text).toContain('"sampleData":false');
    expect(home.text.replace(/<script type="application\/json" id="boot-data">.*?<\/script>/s, '')).not.toMatch(/Monroe|Omni|Fiber/);
    expect(home.text).toContain('"@type":"Organization"');
    await request(a).get('/savings/assess').expect(200);
    const results = await request(a).get('/savings/results/abc').expect(200);
    expect(results.text).toContain('content="noindex, nofollow"'); // private results are never indexed
    await request(a).get('/savings/unknown').expect(404);
    await request(a).get('/no-such-page').expect(404);
    expect((await request(a).get('/robots.txt')).text).toContain('Disallow: /admin');
  });

  it('reserves platform paths so no location can take them', () => {
    expect(marketSchema.safeParse({ ...MONROE, slug: 'savings' }).success).toBe(false);
    expect(marketSchema.safeParse({ ...MONROE, slug: 'platform' }).success).toBe(false);
    expect(marketSchema.safeParse({ ...MONROE, slug: 'internet' }).success).toBe(false);
  });
});

describe('platform code and styles stay out of the fiber site', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));

  it('keeps platform styles in their own lazily loaded stylesheet', () => {
    const main = readFileSync('src/index.css', 'utf8');
    expect(main).toContain("@source not './platform'");
    expect(main).not.toMatch(/--color-pf-/);
    expect(readFileSync('src/platform/PlatformApp.tsx', 'utf8')).toContain("import './platform.css'");
  });

  it('uses platform classes only inside src/platform (they are not generated elsewhere)', () => {
    const outside = walk('src')
      .filter((f) => /\.(tsx?|css)$/.test(f) && !f.startsWith(join('src', 'platform')))
      .filter((f) => /\b(?:bg|text|border|ring|outline|shadow)-pf-/.test(readFileSync(f, 'utf8')));
    expect(outside).toEqual([]);
  });

  it('loads the platform only through a lazy import', () => {
    const app = readFileSync('src/App.tsx', 'utf8');
    expect(app).toMatch(/lazy\(\(\) => import\('\.\/platform\/PlatformApp'\)\)/);
    expect(app).not.toMatch(/^import .*platform/m);
  });
});

describe('staging', () => {
  it('serves the platform, and is never indexed', async () => {
    const a = app(STAGING);
    const page = await request(a).get('/').expect(200);
    expect(page.text).toContain('content="noindex, nofollow"');
    expect(page.text).toContain('Tucker | Preview Potential Savings on Your Household Bills');
    expect((await request(a).get('/savings/assess').expect(200)).text).toContain('content="noindex, nofollow"');
    expect((await request(a).get('/robots.txt')).text).toBe('User-agent: *\nDisallow: /\n');
  });
});

describe('platform resource hints', () => {
  it('preloads only the platform chunk and the page chunk, never the entry', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { platformPreloader } = await import('../server/preload');
    const dir = mkdtempSync(join(tmpdir(), 'manifest-'));
    const file = join(dir, 'manifest.json');
    writeFileSync(
      file,
      JSON.stringify({
        'index.html': { file: 'assets/index-a.js', isEntry: true, css: ['assets/index-a.css'] },
        '_ds.js': { file: 'assets/ds-b.js', imports: ['index.html'] },
        'src/platform/PlatformApp.tsx': { file: 'assets/PlatformApp-c.js', imports: ['index.html'], css: ['assets/PlatformApp-c.css'] },
        'src/platform/pages/Home.tsx': { file: 'assets/Home-d.js', imports: ['index.html', 'src/platform/PlatformApp.tsx', '_ds.js'] },
        'src/internet/RegionalPage.tsx': { file: 'assets/RegionalPage-e.js', imports: ['index.html'] },
      }),
    );
    const pre = platformPreloader(file);
    expect(pre('/')).toEqual({ scripts: ['/assets/PlatformApp-c.js', '/assets/Home-d.js', '/assets/ds-b.js'], styles: ['/assets/PlatformApp-c.css'] });
    expect(pre('/savings/unknown').scripts).toEqual(['/assets/PlatformApp-c.js']);
    expect(platformPreloader(join(dir, 'missing.json'))('/')).toEqual({ scripts: [], styles: [] });
  });

  it('renders hints as same-origin asset links only', async () => {
    const { renderHtml } = await import('../server/html');
    const html = renderHtml('<head><!--%%HEAD_DATA%%--></head>', {
      siteUrl: 'https://example.test',
      canonicalPath: '/savings',
      boot: { market: MONROE, markets: [], defaultSlug: MONROE.slug, flags: { env: 'staging', platform: true, sampleData: false } },
      preload: { scripts: ['/assets/A-1.js', 'https://evil.test/x.js', '/assets/"><script>.js'], styles: ['/assets/A-1.css'] },
    });
    expect(html).toContain('<link rel="modulepreload" crossorigin href="/assets/A-1.js" />');
    expect(html).toContain('<link rel="stylesheet" crossorigin href="/assets/A-1.css" />');
    expect(html).not.toContain('evil.test');
    expect(html).not.toContain('<script>.js');
  });
});
