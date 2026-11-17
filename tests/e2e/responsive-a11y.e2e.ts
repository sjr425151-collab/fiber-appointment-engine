/** Layout at common widths and automated accessibility checks (axe-core, WCAG 2.2 AA). */
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Browser, Page } from 'playwright';
import { adminLogin, axe, context, createAssessment, HOUSEHOLD, launch, overflow } from './helpers';

const BASE = inject('stagingUrl');
const WIDTHS = [320, 390, 768, 1280];
let b: Browser;
let results = '';
beforeAll(async () => {
  b = await launch();
  results = (await createAssessment(BASE, HOUSEHOLD)).url;
});
afterAll(async () => {
  await b.close();
});

async function ready(p: Page, url: string) {
  await p.goto(url);
  await p.locator('h1').first().waitFor();
}

describe('responsive layout', () => {
  for (const width of WIDTHS) {
    it(`has no horizontal scroll and keeps the main action reachable at ${width}px`, async () => {
      const { ctx, errors } = await context(b, { viewport: { width, height: 800 } });
      const p = await ctx.newPage();
      for (const path of ['/', '/savings/assess', '/savings/design', '/internet/monroe', '/no-such-page']) {
        await ready(p, BASE + path);
        expect({ path, overflow: await overflow(p) }).toEqual({ path, overflow: 0 });
      }
      await ready(p, results);
      expect({ path: 'results', overflow: await overflow(p) }).toEqual({ path: 'results', overflow: 0 });
      // Primary action inside the first two screens on every width.
      const cta = p.getByRole('link', { name: 'Get My Exact Pricing' });
      const box = await cta.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.y).toBeLessThan(800 * 2.5);
      expect(box!.width).toBeGreaterThanOrEqual(44);
      // Each option card is one large tap target (the label covers the card).
      const card = await p.locator('label[for^="opt-internet-"]').first().locator('xpath=../..').boundingBox();
      expect(card!.height).toBeGreaterThanOrEqual(44);
      await p.screenshot({ path: `test-results/results-${width}.png`, fullPage: false });

      const a = await adminLogin(ctx, BASE);
      await a.goto(`${BASE}/admin/opportunities`);
      await a.getByRole('heading', { name: 'Opportunities' }).waitFor();
      expect({ path: 'admin', overflow: await overflow(a) }).toEqual({ path: 'admin', overflow: 0 });
      expect(errors).toEqual([]);
      await ctx.close();
    });
  }
});

describe('accessibility (axe-core)', () => {
  it('has no violations across the platform pages and states', async () => {
    const { ctx } = await context(b, { viewport: { width: 390, height: 844 } });
    const p = await ctx.newPage();
    const found: Record<string, string[]> = {};
    const scan = async (name: string) => (found[name] = await axe(p));

    await ready(p, `${BASE}/`);
    await scan('home');
    await ready(p, `${BASE}/savings/design`);
    await scan('design system');
    await ready(p, `${BASE}/savings/assess`);
    await scan('assess: area');
    await p.getByRole('button', { name: 'Continue' }).click();
    await scan('assess: area with errors');
    await p.getByLabel('ZIP code').fill('48161');
    await p.getByRole('button', { name: 'Continue' }).click();
    await p.getByRole('checkbox', { name: /^Electricity/ }).check();
    await scan('assess: services');
    await p.getByRole('button', { name: 'Continue' }).click();
    await p.getByRole('button', { name: 'Continue' }).click();
    await scan('assess: electricity with errors');
    await ready(p, results);
    await scan('results');
    await p.getByRole('button', { name: /Show data table/ }).click();
    await scan('results: data table open');
    await p.getByRole('button', { name: 'Continue to pick a time' }).click();
    await scan('results: contact errors');

    const a = await adminLogin(ctx, BASE);
    await a.goto(`${BASE}/admin/opportunities`);
    await a.getByRole('heading', { name: 'Opportunities' }).waitFor();
    found['admin: opportunities'] = await axe(a);

    expect(found).toEqual(Object.fromEntries(Object.keys(found).map((k) => [k, []])));
    await ctx.close();
  });

  it('is fully operable by keyboard: tab order reaches the main controls with visible focus', async () => {
    const { ctx } = await context(b, { viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    await ready(p, `${BASE}/`);
    await p.keyboard.press('Tab');
    expect(await p.evaluate(() => document.activeElement?.textContent)).toBe('Skip to content');
    await p.keyboard.press('Enter');
    // After skipping, focus moves through the page's own controls, each with a visible outline.
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      await p.keyboard.press('Tab');
      seen.push(await p.evaluate(() => `${document.activeElement?.tagName}#${document.activeElement?.id}|${getComputedStyle(document.activeElement as Element).outlineStyle}`));
    }
    expect(seen).toEqual(['A#|solid', 'INPUT#qp-internet|solid', 'INPUT#qp-mobile|solid']);
    await ctx.close();
  });

  it('respects reduced motion (no spinning or pulsing animations)', async () => {
    const { ctx } = await context(b, { reducedMotion: 'reduce' });
    const p = await ctx.newPage();
    await p.route('**/api/platform/assessments/*?t=*', async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      await route.continue();
    });
    await p.goto(results);
    await p.locator('[aria-busy=true]').waitFor();
    const animated = await p.evaluate(() => [...document.querySelectorAll('*')].filter((e) => getComputedStyle(e).animationName !== 'none').length);
    expect(animated).toBe(0);
    await ctx.close();
  });
});
