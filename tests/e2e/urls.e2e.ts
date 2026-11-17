/**
 * Retired and unknown addresses, in production settings. The per-location
 * internet pages were retired with the location system: their old links land
 * on the national home, and nothing location-specific is published.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Browser } from 'playwright';
import { context, launch, PHONE } from './helpers';

const PROD = inject('productionUrl');
let b: Browser;
beforeAll(async () => {
  b = await launch();
});
afterAll(async () => {
  await b.close();
});

describe('retired and unknown addresses', () => {
  it('sends old location links to the national home in one step, keeping campaign tags', async () => {
    const { ctx, errors } = await context(b);
    const p = await ctx.newPage();
    for (const old of ['/monroe?utm_source=old-ad', '/internet/monroe?utm_source=old-ad']) {
      await p.goto(PROD + old);
      await p.locator('#hero-t').waitFor();
      expect(new URL(p.url()).pathname + new URL(p.url()).search).toBe('/?utm_source=old-ad');
    }
    expect(errors).toEqual([]);
    await ctx.close();
  });

  it('answers each kind of address with the right status, and publishes only national pages', async () => {
    const status = async (path: string) => {
      const r = await fetch(PROD + path, { redirect: 'manual' });
      return [r.status, r.headers.get('location')];
    };
    expect(await status('/monroe')).toEqual([301, '/']);
    expect(await status('/internet/monroe')).toEqual([301, '/']);
    expect(await status('/savings')).toEqual([301, '/']);
    expect(await status('/internet')).toEqual([301, '/']);
    expect(await status('/internet/nowhere')).toEqual([404, null]);
    expect(await status('/old-fiber-page')).toEqual([404, null]);
    const sitemap = await (await fetch(`${PROD}/sitemap.xml`)).text();
    expect(sitemap.match(/<loc>[^<]+<\/loc>/g)).toEqual([`<loc>${PROD}/</loc>`, `<loc>${PROD}/savings/assess</loc>`, `<loc>${PROD}/privacy</loc>`]);
    expect(await (await fetch(`${PROD}/robots.txt`)).text()).toMatch(/Allow: \//);
  });

  it('shows a helpful not-found page that leads back to the savings preview', async () => {
    const { ctx, errors } = await context(b, { ...PHONE });
    const p = await ctx.newPage();
    const r = await p.goto(`${PROD}/this-page-does-not-exist`);
    expect(r?.status()).toBe(404);
    await p.getByRole('heading', { level: 1, name: 'We can’t find that page' }).waitFor();
    await p.locator('main').getByRole('link', { name: 'Explore my savings' }).click();
    await p.locator('#preview-t').waitFor();
    expect(errors).toEqual([]);
    await ctx.close();
  });
});
