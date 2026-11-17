/**
 * The full customer journey in a real browser, on a phone:
 * enter → assess → engine → dashboard → labelled offers → ask for help →
 * opportunity stored → admin manages it.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Browser, Page } from 'playwright';
import { adminLogin, context, launch, overflow, PHONE } from './helpers';

const BASE = inject('stagingUrl');
let b: Browser;
beforeAll(async () => {
  b = await launch();
});
afterAll(async () => {
  await b.close();
});

/** Picks the first available time, moving to later dates when a day is full (depends on the clock). */
export async function pickFirstSlot(p: Page) {
  const dates = p.getByRole('group', { name: 'Choose a date' });
  const failed = p.locator('form [role=alert]');
  await dates.or(failed).first().waitFor();
  if (await failed.isVisible()) throw new Error(`Contact failed: ${await failed.textContent()}`);
  const times = p.getByRole('group', { name: 'Choose a time' });
  const none = p.getByText(/No times left that day/);
  // The group renders before its dates arrive; wait for the first one.
  await dates.getByRole('button').first().waitFor();
  const n = await dates.getByRole('button').count();
  for (let i = 0; i < n; i++) {
    const button = dates.getByRole('button').nth(i);
    if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
    // Wait until this date's times have loaded (the previous date's message is gone).
    await p.waitForFunction((label) => document.querySelector('[aria-pressed="true"]')?.textContent === label && !document.body.innerText.includes('Loading times'), await button.textContent());
    await times.or(none).first().waitFor();
    if (await times.isVisible()) return times.getByRole('button').first().click();
  }
  throw new Error('No bookable times on any offered date');
}

async function continueTo(p: Page, heading: RegExp) {
  await p.getByRole('button', { name: 'Continue' }).click();
  await p.getByRole('heading', { level: 1, name: heading }).waitFor();
}

describe('household journey (staging, phone)', () => {
  it('goes from the homepage to an opportunity an admin can work', async () => {
    const { ctx, errors } = await context(b, { ...PHONE });
    const p = await ctx.newPage();

    // 1. Enter the site.
    await p.goto(`${BASE}/?utm_source=e2e&utm_campaign=journey`);
    await p.getByRole('heading', { level: 1 }).waitFor();
    expect(await p.title()).toMatch(/Tucker/);

    // 2. Start the assessment.
    await p.getByRole('link', { name: 'Preview My Savings' }).first().click();
    await p.getByRole('heading', { level: 1, name: 'Where is your home?' }).waitFor();
    await p.getByLabel('ZIP code').fill('48161');
    await continueTo(p, /What do you pay for/);
    for (const c of [/^Home internet/, /^Mobile phones/, /^Electricity/]) await p.getByRole('checkbox', { name: c }).check();

    // 3. Recurring expenses.
    await continueTo(p, /home internet/);
    await p.getByLabel('Current provider').fill('Comcast Xfinity');
    await p.getByLabel('Monthly internet bill').fill('85');
    await p.getByLabel('Monthly equipment fee').fill('15');
    await continueTo(p, /mobile phones/);
    await p.getByLabel('Current carrier').fill('Verizon');
    await p.getByLabel('Number of lines').selectOption('3');
    await p.getByLabel('Monthly service cost').fill('190');
    await continueTo(p, /electricity/);
    await p.getByLabel('Electric utility').fill('DTE Energy');
    await p.getByLabel('Average monthly electric bill').fill('160');
    await p.getByRole('button', { name: 'Continue' }).click();
    // Ownership is required for the solar comparison.
    expect(await p.locator('#pf-error-summary').textContent()).toMatch(/own or rent/);
    await p.getByLabel('Own', { exact: true }).check();
    await p.getByLabel('How much sun does your roof get?').selectOption('mostly_sunny');
    await continueTo(p, /What matters most/);
    await continueTo(p, /Check your answers/);
    expect(await p.locator('main').textContent()).toMatch(/Roof sun\s*Mostly sunny/);

    // 4–5. Engine runs; dashboard shows results with labelled assumptions.
    await p.getByRole('button', { name: 'See my results' }).click();
    await p.getByRole('heading', { level: 1, name: 'Your household snapshot' }).waitFor();
    expect(p.url()).toMatch(/\/savings\/results\/[\w-]+#t=[\w-]{43}$/);
    const overview = await p.locator('section[aria-labelledby=ov]').textContent();
    expect(overview).toMatch(/\$450\/mo/); // internet $85 + $15 equipment, mobile $190, electricity $160
    const method = await p.getByRole('heading', { name: 'How we calculated this' }).locator('..').textContent();
    expect(method).toMatch(/Solar figures are estimates, not quotes/);

    // 6. Real-but-unconfirmed vs sample vs estimate are distinguished.
    const internet = p.locator('article', { has: p.getByRole('heading', { name: 'Home internet' }) });
    expect(await internet.getByText('Needs address check').count()).toBeGreaterThan(0);
    expect(await internet.getByText('Sample data').count()).toBeGreaterThan(0);
    const electricity = p.locator('article', { has: p.getByRole('heading', { name: 'Electricity' }) });
    expect(await electricity.locator('span', { hasText: /^≈\s*Estimate$/ }).count()).toBe(1);
    expect(await electricity.textContent()).toMatch(/covers 90% of your usage/);

    // The customer picks 2 Gig instead of our default.
    await p.getByRole('radio', { name: /^2 Gig,/ }).check();
    expect(await p.getByRole('radio', { name: /^2 Gig,/ }).isChecked()).toBe(true);
    expect(await overflow(p)).toBe(0);

    // 7. Ask for help (consent is enforced first).
    await p.getByRole('link', { name: 'Get help switching' }).click();
    await p.getByLabel('First name').fill('Ana');
    await p.getByLabel('Last name').fill('Lopez');
    await p.getByLabel('Mobile phone', { exact: true }).fill('7345550190');
    await p.getByLabel('Email', { exact: true }).fill('ana.e2e@example.com');
    await p.getByRole('button', { name: 'Continue to pick a time' }).click();
    expect(await p.getByText(/Consent is required/).count()).toBe(1);
    await p.getByRole('checkbox', { name: /By checking this box/ }).check();
    await p.getByRole('button', { name: 'Continue to pick a time' }).click();
    await pickFirstSlot(p);
    await p.getByRole('button', { name: /^Book / }).click();
    await p.getByText('You’re booked').waitFor();

    // 8–9. Opportunity stored; an admin sees exactly what the customer chose and works it.
    const a = await adminLogin(ctx, BASE);
    await a.getByRole('link', { name: 'Opportunities' }).click();
    await a.getByRole('heading', { name: 'Opportunities' }).waitFor();
    const row = a.locator('tr', { hasText: '2 Gig' });
    await row.waitFor();
    expect(await row.textContent()).toMatch(/Ana Lopez.*Home internet → 2 Gig.*address not confirmed/);
    expect(await a.locator('tr', { hasText: 'Sample Solar' }).textContent()).toMatch(/SAMPLE — not a real offer/);
    await row.getByLabel('Status for 2 Gig').selectOption('contacted');
    await a.waitForResponse((r) => r.url().includes('/api/admin/opportunities/') && r.request().method() === 'PATCH');
    await row.getByRole('link', { name: 'Ana Lopez' }).click();
    await a.getByRole('heading', { name: 'What they asked about' }).waitFor();
    expect(await a.getByLabel('Status for 2 Gig').inputValue()).toBe('contacted');
    expect(await a.locator('body').textContent()).toMatch(/New → Contacted/);

    expect(errors).toEqual([]);
    await ctx.close();
  });
});
