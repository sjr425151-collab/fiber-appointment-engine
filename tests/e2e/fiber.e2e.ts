/**
 * The regional internet page (the former fiber homepage, now an optional local
 * campaign at /internet/<location>) and the retired URLs that point to it, in
 * production settings.
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

describe('regional internet page in production', () => {
  it('works on a phone, and the ZIP availability check still answers from the location’s service areas', async () => {
    const { ctx, errors } = await context(b, { ...PHONE });
    const p = await ctx.newPage();
    const requested: string[] = [];
    p.on('request', (r) => requested.push(new URL(r.url()).pathname));
    await p.goto(`${PROD}/internet/monroe?utm_source=e2e&utm_medium=test&utm_campaign=fiber`);
    await p.locator('#hero-title').waitFor();
    expect(await p.title()).toMatch(/Omni Fiber Internet in Monroe, MI/);
    expect(await p.locator('meta[name=robots]').getAttribute('content')).toBe('index, follow');
    expect(await p.locator('link[rel=canonical]').getAttribute('href')).toBe(`${PROD}/internet/monroe`);
    expect(await p.locator('header').first().textContent()).toMatch(/tucker/i);
    expect(await overflow(p)).toBe(0);
    expect(await axe(p)).toEqual([]);
    // The regional page never downloads the savings app.
    expect(requested.filter((u) => /PlatformApp|Results|Assess/.test(u))).toEqual([]);

    // Address qualification by ZIP still answers from the location's service areas.
    await p.fill('#zip', '48161');
    await p.locator('#zip-form button').first().click();
    await p.getByText(/Monroe is in the Omni Fiber build area/).first().waitFor();
    expect(errors).toEqual([]);
    await ctx.close();
  });

  it('follows old links to the right place', async () => {
    const { ctx } = await context(b);
    const p = await ctx.newPage();
    await p.goto(`${PROD}/monroe?utm_source=old-ad`);
    await p.locator('#hero-title').waitFor();
    expect(new URL(p.url()).pathname + new URL(p.url()).search).toBe('/internet/monroe?utm_source=old-ad');
    await p.goto(`${PROD}/savings`);
    await p.getByRole('heading', { level: 1, name: /See what your household could save/ }).waitFor();
    expect(new URL(p.url()).pathname).toBe('/');
    await ctx.close();
  });

  it('answers retired and unknown URLs with the right status', async () => {
    const status = async (path: string) => {
      const r = await fetch(PROD + path, { redirect: 'manual' });
      return [r.status, r.headers.get('location')];
    };
    expect(await status('/monroe')).toEqual([301, '/internet/monroe']);
    expect(await status('/savings')).toEqual([301, '/']);
    expect(await status('/internet')).toEqual([301, '/']);
    expect(await status('/internet/nowhere')).toEqual([404, null]);
    expect(await status('/old-fiber-page')).toEqual([404, null]);
    const robots = await (await fetch(`${PROD}/robots.txt`)).text();
    expect(robots).toMatch(/Allow: \//);
    const sitemap = await (await fetch(`${PROD}/sitemap.xml`)).text();
    expect(sitemap).toContain('/internet/monroe</loc>');
    expect(sitemap).not.toMatch(/<loc>[^<]*\/monroe<\/loc>(?<!internet\/monroe<\/loc>)/);
  });

  it('shows a helpful not-found page for an unknown address', async () => {
    const { ctx, errors } = await context(b, { ...PHONE });
    const p = await ctx.newPage();
    const r = await p.goto(`${PROD}/this-page-does-not-exist`);
    expect(r?.status()).toBe(404);
    await p.getByRole('heading', { level: 1, name: 'We can’t find that page' }).waitFor();
    await p.getByRole('link', { name: 'Start my savings preview' }).click();
    await p.getByRole('heading', { level: 1, name: 'Where is your home?' }).waitFor();
    expect(errors).toEqual([]);
    await ctx.close();
  });
});
