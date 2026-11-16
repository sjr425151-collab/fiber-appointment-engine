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
const PROD = base({ env: 'production', platform: false, sampleData: false });
const STAGING = base({ env: 'staging', platform: true, sampleData: true });
const app = (c: AppConfig) => createApp(c, openDatabase(':memory:'), { htmlTemplate: TEMPLATE });

describe('production defaults keep the live fiber site unchanged', () => {
  it('derives all-off flags from a production environment with no new variables', () => {
    const c = loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(44), ADMIN_PASSWORD: 'correct-horse-battery' });
    expect(c.flags).toEqual({ env: 'production', platform: false, sampleData: false });
  });

  it('refuses sample data in production and rejects malformed flag values', () => {
    const env = { NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(44), ADMIN_PASSWORD: 'correct-horse-battery' };
    expect(() => loadConfig({ ...env, SAMPLE_DATA_ENABLED: 'true' })).toThrow(/cannot be used when APP_ENV=production/);
    expect(() => loadConfig({ ...env, APP_ENV: 'prod' })).toThrow(/APP_ENV/);
    expect(() => loadConfig({ ...env, PLATFORM_ENABLED: 'yes' })).toThrow(/PLATFORM_ENABLED/);
    expect(loadConfig({ ...env, APP_ENV: 'staging', SAMPLE_DATA_ENABLED: 'true', PLATFORM_ENABLED: '1' }).flags).toEqual({
      env: 'staging',
      platform: true,
      sampleData: true,
    });
  });

  it('hides every platform page and API in production while fiber pages work as before', async () => {
    const a = app(PROD);
    for (const path of ['/savings', '/savings/assess', '/savings/results/abc', '/savings/design']) await request(a).get(path).expect(404);
    for (const path of ['/api/platform/assessments', '/api/platform/offers']) await request(a).get(path).expect(404);
    await request(a).post('/api/platform/assessments').send({}).expect(404);
    const home = await request(a).get('/').expect(200);
    expect(home.text).toContain('content="index, follow"');
    expect(home.text).toContain('"flags":{"env":"production","platform":false,"sampleData":false}');
    expect((await request(a).get('/robots.txt')).text).toContain('Disallow: /admin');
  });

  it('reserves platform paths so no location can take them', () => {
    expect(marketSchema.safeParse({ ...MONROE, slug: 'savings' }).success).toBe(false);
    expect(marketSchema.safeParse({ ...MONROE, slug: 'platform' }).success).toBe(false);
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
    const page = await request(a).get('/savings').expect(200);
    expect(page.text).toContain('content="noindex, nofollow"');
    expect(page.text).toContain('Household Savings');
    expect((await request(a).get('/').expect(200)).text).toContain('content="noindex, nofollow"');
    expect((await request(a).get('/robots.txt')).text).toBe('User-agent: *\nDisallow: /\n');
  });
});

describe('platform resource hints', () => {
  it('preloads only the platform chunk and the page chunk, never the entry, and only for /savings', async () => {
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
      }),
    );
    const pre = platformPreloader(file);
    expect(pre('/savings')).toEqual({ scripts: ['/assets/PlatformApp-c.js', '/assets/Home-d.js', '/assets/ds-b.js'], styles: ['/assets/PlatformApp-c.css'] });
    expect(pre('/savings/unknown').scripts).toEqual(['/assets/PlatformApp-c.js']);
    expect(platformPreloader(join(dir, 'missing.json'))('/savings')).toEqual({ scripts: [], styles: [] });
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
