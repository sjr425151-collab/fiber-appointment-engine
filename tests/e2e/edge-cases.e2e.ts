/** Unhappy paths a real household will hit. */
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Browser } from 'playwright';
import { context, createAssessment, launch, PHONE } from './helpers';

const BASE = inject('stagingUrl');
let b: Browser;
beforeAll(async () => {
  b = await launch();
});
afterAll(async () => {
  await b.close();
});

describe('assessment edge cases', () => {
  it('blocks bad input with a linked error summary, keeps answers on Back, and accepts "I don’t know"', async () => {
    const { ctx, errors } = await context(b, { ...PHONE });
    const p = await ctx.newPage();
    await p.goto(`${BASE}/savings/assess`);
    await p.getByLabel('ZIP code').fill('481');
    await p.getByRole('button', { name: 'Continue' }).click();
    // Focus moves on the next frame; wait for it rather than racing it.
    await p.waitForFunction(() => document.activeElement?.id === 'pf-error-summary');
    await p.locator('#pf-error-summary a').click();
    expect(await p.evaluate(() => document.activeElement?.id)).toBe('pf-f-zip');
    await p.getByLabel('ZIP code').fill('48161abc'); // non-digits are stripped
    expect(await p.getByLabel('ZIP code').inputValue()).toBe('48161');
    await p.getByRole('button', { name: 'Continue' }).click();
    await p.getByRole('button', { name: 'Continue' }).click();
    expect(await p.locator('#pf-error-summary').textContent()).toMatch(/at least one service/);
    await p.getByRole('checkbox', { name: /^Home internet/ }).check();
    await p.getByRole('button', { name: 'Continue' }).click();
    // A malformed amount is rejected, not guessed.
    await p.getByLabel('Monthly internet bill').fill('12.345');
    await p.getByLabel('Monthly internet bill').blur();
    await p.getByRole('button', { name: 'Continue' }).click();
    expect(await p.locator('#pf-error-summary').textContent()).toMatch(/dollar amount/);
    await p.getByRole('button', { name: 'Back' }).click();
    expect(await p.getByRole('checkbox', { name: /^Home internet/ }).isChecked()).toBe(true);
    await p.getByRole('button', { name: 'Continue' }).click();
    await p.getByLabel(/I don’t know/).check();
    await p.getByRole('button', { name: 'Continue' }).click();
    await p.getByRole('button', { name: 'Continue' }).click();
    await p.getByRole('button', { name: 'See my results' }).click();
    // Unknown bill → an "incomplete" result that asks for it, never a guess.
    await p.getByRole('heading', { name: 'We need a little more to calculate' }).waitFor();
    expect(await p.locator('main').textContent()).toMatch(/Your monthly home internet bill/);
    await p.getByRole('button', { name: 'Add the missing amounts' }).click();
    await p.getByRole('heading', { level: 1, name: 'Where is your home?' }).waitFor();
    expect(await p.getByLabel('ZIP code').inputValue()).toBe('48161');
    expect(errors).toEqual([]);
    await ctx.close();
  });

  it('restores a consented draft, and keeps nothing without consent', async () => {
    const { ctx } = await context(b);
    const p = await ctx.newPage();
    await p.goto(`${BASE}/savings/assess`);
    await p.getByLabel('ZIP code').fill('48162');
    await p.getByRole('checkbox', { name: /Remember my answers/ }).check();
    await p.getByRole('button', { name: 'Continue' }).click();
    await p.reload();
    // The draft resumes where the household left off, with earlier answers intact.
    await p.getByRole('heading', { level: 1, name: /What do you pay for/ }).waitFor();
    await p.getByRole('button', { name: 'Back' }).click();
    expect(await p.getByLabel('ZIP code').inputValue()).toBe('48162');
    await p.getByRole('checkbox', { name: /Remember my answers/ }).uncheck();
    expect(await p.evaluate(() => Object.keys(localStorage).filter((k) => /draft/i.test(k)).length)).toBe(0);
    await ctx.close();
  });

  it('explains when solar does not apply (renter)', async () => {
    const { url } = await createAssessment(BASE, { zip: '48161', categories: ['electricity'], electricity: { utility: 'DTE', monthlyCents: 15000, homeownership: 'rent' } });
    const { ctx, errors } = await context(b);
    const p = await ctx.newPage();
    await p.goto(url);
    await p.getByRole('heading', { level: 1, name: 'Your household snapshot' }).waitFor();
    expect(await p.locator('main').textContent()).toMatch(/Solar probably isn’t a fit.*requires owning your home/);
    expect(await p.getByRole('heading', { name: 'No savings found with the information we have' }).count()).toBe(1);
    expect(errors).toEqual([]);
    await ctx.close();
  });
});

describe('results access', () => {
  it('rejects a missing or wrong token with a helpful page', async () => {
    const { id } = await createAssessment(BASE, { zip: '48161', categories: ['internet'], internet: { monthlyCents: 9000 } });
    const { ctx } = await context(b);
    const p = await ctx.newPage();
    await p.goto(`${BASE}/savings/results/${id}`);
    await p.getByRole('heading', { name: 'Results unavailable' }).waitFor();
    expect(await p.locator('main').textContent()).toMatch(/link is incomplete/);
    await p.goto(`${BASE}/savings/results/${id}#t=${'x'.repeat(43)}`);
    await p.reload();
    await p.getByRole('heading', { name: 'Results unavailable' }).waitFor();
    expect(await p.locator('main').textContent()).toMatch(/couldn’t find these results/);
    // Not-found offers a fresh start, not a pointless retry.
    expect(await p.getByRole('button', { name: 'Try again' }).count()).toBe(0);
    await ctx.close();
  });

  it('offers a retry when the network fails, then recovers', async () => {
    const { url } = await createAssessment(BASE, { zip: '48161', categories: ['internet'], internet: { monthlyCents: 9000 } });
    const { ctx } = await context(b);
    const p = await ctx.newPage();
    let fail = true;
    await p.route('**/api/platform/assessments/*?t=*', (route) => (fail ? route.abort() : route.continue()));
    await p.goto(url);
    await p.getByRole('button', { name: 'Try again' }).waitFor();
    fail = false;
    await p.getByRole('button', { name: 'Try again' }).click();
    await p.getByRole('heading', { level: 1, name: 'Your household snapshot' }).waitFor();
    await ctx.close();
  });

  it('marks a contacted assessment instead of asking again', async () => {
    const a = await createAssessment(BASE, { zip: '48161', categories: ['internet'], internet: { monthlyCents: 9000 } });
    const r = await fetch(`${BASE}/api/platform/assessments/${a.id}/contact`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ firstName: 'Lee', lastName: 'Park', email: 'lee.e2e@example.com', phone: '7345550123', preferredContact: 'phone', consent: true, intent: 'callback', token: a.token }),
    });
    expect(r.status).toBe(201);
    const { ctx } = await context(b);
    const p = await ctx.newPage();
    await p.goto(a.url);
    await p.getByText(/already asked us to reach out/).waitFor();
    await ctx.close();
  });
});
