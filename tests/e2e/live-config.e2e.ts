/**
 * The platform exactly as production runs it: real location data only, no
 * samples. Every service must still end in something useful — a real plan to
 * check, or a free bill review — and reach the admin as an opportunity.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Browser } from 'playwright';
import { adminLogin, axe, context, createAssessment, HOUSEHOLD, launch, overflow, PHONE } from './helpers';

const LIVE = inject('liveUrl');
let b: Browser;
beforeAll(async () => {
  b = await launch();
});
afterAll(async () => {
  await b.close();
});

describe('production configuration with the platform on', () => {
  it('shows real plans, offers bill reviews for the rest, and never shows sample data', async () => {
    const { url } = await createAssessment(LIVE, HOUSEHOLD);
    const { ctx, errors } = await context(b, { ...PHONE });
    const p = await ctx.newPage();
    await p.goto(url);
    await p.getByRole('heading', { level: 1, name: 'Your household snapshot' }).waitFor();
    const page = (await p.locator('body').textContent()) ?? '';
    expect(page).not.toMatch(/Sample|Staging preview|working name|Preview/);
    expect(await p.title()).toBe('Your household results');
    expect(await p.locator('meta[name=robots]').getAttribute('content')).toBe('noindex, nofollow'); // private results are never indexed

    // Internet: the location's real plans, pending an address check.
    expect(await p.getByRole('radio', { name: /^1 Gig, \$50/ }).isChecked()).toBe(true);
    const internet = p.locator('article', { has: p.getByRole('heading', { name: 'Home internet' }) });
    expect(await internet.getByText('Needs address check').count()).toBe(3);
    expect(await internet.textContent()).toMatch(/Equipment rental costs you \$180 a year/);
    // Mobile and electricity: nothing verified → a free review, on by default, with facts from their own numbers.
    const mobile = p.getByRole('checkbox', { name: /advisor look for a better price on my mobile phones bill/ });
    const solar = p.getByRole('checkbox', { name: /free solar estimate/ });
    expect([await mobile.isChecked(), await solar.isChecked()]).toEqual([true, true]);
    expect(page).toMatch(/\$63\.33 per line for 3 lines/);
    expect(page).toMatch(/review your mobile phones and electricity \(solar\) for better prices/);
    await solar.uncheck(); // the customer declines the solar estimate
    expect(await overflow(p)).toBe(0);
    expect(await axe(p)).toEqual([]);

    // Ask for a callback; the address helps the availability check.
    await p.getByRole('link', { name: 'Get help switching' }).click();
    await p.getByRole('radio', { name: /Request a callback/ }).check();
    await p.getByLabel('First name').fill('Dana');
    await p.getByLabel('Last name').fill('Reyes');
    await p.getByLabel('Mobile phone', { exact: true }).fill('7345550177');
    await p.getByLabel('Email', { exact: true }).fill('dana.e2e@example.com');
    await p.getByLabel('Street address').fill('12 W Front St');
    await p.getByLabel('City').fill('Monroe');
    await p.getByRole('checkbox', { name: /By checking this box/ }).check();
    await p.getByRole('button', { name: 'Send my request' }).click();
    await p.getByText(/an advisor will reach out shortly/).waitFor();

    const a = await adminLogin(ctx, LIVE);
    await a.goto(`${LIVE}/admin/opportunities`);
    await a.locator('tr', { hasText: 'Dana Reyes' }).first().waitFor();
    const rows = await a.locator('tbody tr').allTextContents();
    expect(rows.some((r) => /Home internet → 1 Gig.*address not confirmed/.test(r))).toBe(true);
    expect(rows.some((r) => /Mobile → Mobile phones bill review requested.*Needs an advisor quote/.test(r))).toBe(true);
    expect(rows.some((r) => /solar/i.test(r))).toBe(false); // declined
    await a.getByRole('link', { name: 'Dana Reyes' }).first().click();
    await a.getByText('12 W Front St').first().waitFor();
    expect(errors).toEqual([]);
    await ctx.close();
  });

  it('links the fiber page to the bill analysis and carries one brand', async () => {
    const { ctx, errors } = await context(b, { viewport: { width: 320, height: 700 } });
    const p = await ctx.newPage();
    await p.goto(LIVE);
    await p.locator('#hero-title').waitFor();
    expect(await overflow(p)).toBe(0); // the longer wordmark still fits the narrowest header
    expect(await p.locator('header').first().textContent()).toMatch(/LiveFiberConnect/);
    await p.getByRole('link', { name: 'Analyze my household bills' }).click();
    await p.getByRole('heading', { level: 1 }).waitFor();
    expect(await p.title()).toBe('LiveFiberConnect — Lower your household bills');
    expect(await p.locator('header').first().textContent()).toMatch(/LiveFiberConnect/);
    expect(await overflow(p)).toBe(0);
    expect(errors).toEqual([]);
    await ctx.close();
  });
});
