/**
 * The live fiber site, served exactly as production serves it (all platform
 * flags off). Guards against the platform leaking into production.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Browser } from 'playwright';
import { axe, context, launch, overflow, PHONE } from './helpers';

const PROD = inject('productionUrl');
let b: Browser;
beforeAll(async () => {
  b = await launch();
});
afterAll(async () => {
  await b.close();
});

describe('fiber site in production mode', () => {
  it('works end to end on a phone and never loads platform code', async () => {
    const { ctx, errors } = await context(b, { ...PHONE });
    const p = await ctx.newPage();
    const requested: string[] = [];
    p.on('request', (r) => requested.push(new URL(r.url()).pathname));
    await p.goto(`${PROD}/?utm_source=e2e&utm_medium=test&utm_campaign=fiber`);
    await p.locator('#hero-title').waitFor();
    expect(await p.locator('meta[name=robots]').getAttribute('content')).toBe('index, follow');
    expect(await p.locator('[role=note]', { hasText: 'Staging preview' }).count()).toBe(0);
    expect(await overflow(p)).toBe(0);
    expect(await axe(p)).toEqual([]);
    expect(requested.filter((u) => /PlatformApp|platform/i.test(u))).toEqual([]);
    expect(errors).toEqual([]);
    await ctx.close();
  });

  it('keeps every platform route and API closed', async () => {
    for (const path of ['/savings', '/savings/assess', '/savings/design', '/savings/results/x']) {
      expect({ path, status: (await fetch(PROD + path)).status }).toEqual({ path, status: 404 });
    }
    const api = await fetch(`${PROD}/api/platform/assessments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(api.status).toBe(404);
    const robots = await (await fetch(`${PROD}/robots.txt`)).text();
    expect(robots).toMatch(/Allow: \//);
    expect(robots).not.toMatch(/Disallow: \/\s*$/m);
  });

  it('hides the platform admin screens when the platform is off', async () => {
    const r = await fetch(`${PROD}/`);
    const html = await r.text();
    expect(html).toMatch(/"platform":false/);
    expect(html).toMatch(/"sampleData":false/);
  });
});
