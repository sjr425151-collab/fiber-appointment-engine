/**
 * Tucker exactly as production runs it: the national home with the quick
 * preview, real plans where a location has them, labelled benchmarks elsewhere,
 * never sample data — and every request reaching the admin as an opportunity.
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

describe('national home', () => {
  it('is nationally relevant and gives an instant benchmark preview with no contact details', async () => {
    const { ctx, errors } = await context(b, { viewport: { width: 320, height: 700 } });
    const p = await ctx.newPage();
    const posted: string[] = [];
    p.on('request', (r) => r.method() === 'POST' && !r.url().includes('/api/events') && posted.push(new URL(r.url()).pathname));
    await p.goto(LIVE);
    await p.getByRole('heading', { level: 1, name: /See what your household could save/ }).waitFor();
    expect(await p.title()).toBe('Tucker | Preview Potential Savings on Your Household Bills');
    expect(await p.locator('link[rel=canonical]').getAttribute('href')).toBe(`${LIVE}/`);
    expect(await p.locator('meta[property="og:image"]').getAttribute('content')).toBe(`${LIVE}/og-tucker.jpg`);
    const text = (await p.locator('body').innerText()) ?? '';
    expect(text).not.toMatch(/Monroe|Omni|Michigan|LiveFiberConnect|Fiber Connect|Sample|Staging preview|fiber/i);
    for (const name of ['Home Internet / Wi-Fi', 'Mobile', 'TV / Streaming', 'Electricity / Solar']) expect(await p.getByRole('heading', { level: 3, name, exact: true }).count()).toBe(1);
    expect(await overflow(p)).toBe(0);

    // $95 internet, $190 for 3 mobile lines, $120 TV, $260 electricity (owner).
    await p.fill('#qp-internet', '95');
    await p.fill('#qp-mobile', '190');
    await p.selectOption('#qp-lines', '3');
    await p.fill('#qp-tv', '120');
    await p.fill('#qp-electricity', '260');
    const preview = p.locator('main [role=status]').first();
    expect(await preview.innerText()).toMatch(/\$140\/mo less[\s\S]*Solar is compared for homeowners/); // 40 + 55 + 45, no solar yet
    await p.check('#qp-own');
    expect(await preview.innerText()).toMatch(/\$200\/mo less[\s\S]*About \$2,400 a year[\s\S]*Benchmark/);
    expect(await p.locator('main').innerText()).toMatch(/comparison assumptions, not offers or guarantees/);
    expect(posted).toEqual([]); // nothing was sent anywhere to see the preview
    expect(await axe(p)).toEqual([]);

    // The numbers carry into the full preview.
    await p.getByRole('button', { name: 'Preview My Savings' }).click();
    await p.getByRole('heading', { level: 1, name: 'Where is your home?' }).waitFor();
    await p.fill('#pf-f-zip', '60601');
    await p.getByRole('button', { name: 'Continue' }).click();
    expect(await p.locator('input[type=checkbox]:checked').count()).toBe(4);
    await p.getByRole('button', { name: 'Continue' }).click();
    expect(await p.getByLabel('Monthly internet bill').inputValue()).toBe('95.00');
    expect(errors).toEqual([]);
    await ctx.close();
  });
});

describe('results in production settings', () => {
  it('shows real plans where they exist and labelled benchmarks elsewhere, and records what the customer asked for', async () => {
    const { url } = await createAssessment(LIVE, HOUSEHOLD);
    const { ctx, errors } = await context(b, { ...PHONE });
    const p = await ctx.newPage();
    await p.goto(url);
    await p.getByRole('heading', { level: 1, name: 'Your household snapshot' }).waitFor();
    const page = (await p.locator('body').textContent()) ?? '';
    expect(page).not.toMatch(/Sample|Staging preview|working name|LiveFiberConnect|Fiber Connect|Household Savings/);
    expect(await p.locator('meta[name=robots]').getAttribute('content')).toBe('noindex, nofollow'); // private results are never indexed
    await p.getByText('This is an illustrative preview').waitFor();

    // Internet: Monroe's real plans, pending an address check. No benchmark where a real plan exists.
    expect(await p.getByRole('radio', { name: /^1 Gig, \$50/ }).isChecked()).toBe(true);
    const internet = p.locator('article', { has: p.getByRole('heading', { name: 'Home internet' }) });
    expect(await internet.getByText('Needs address check').count()).toBe(3);
    expect(await internet.getByText('Benchmark', { exact: true }).count()).toBe(0);
    // Mobile: no real plan on file → $45 × 3 lines benchmark, selected because it is lower than $190.
    const mobile = p.locator('article', { has: p.getByRole('heading', { name: 'Mobile phones' }) });
    expect(await p.getByRole('radio', { name: /^Tucker benchmark: mobile, \$135/ }).isChecked()).toBe(true);
    expect(await mobile.textContent()).toMatch(/\$63\.33 per line for 3 lines[\s\S]*\$45 a month per line[\s\S]*not offers or guarantees/);
    // Electricity: $160 is already below the $200 solar benchmark, so it is shown but not selected.
    expect(await p.getByRole('radio', { name: /^Tucker benchmark: electricity with solar/ }).isChecked()).toBe(false);
    expect(await overflow(p)).toBe(0);
    expect(await axe(p)).toEqual([]);

    await p.getByRole('link', { name: 'Get help switching' }).click();
    await p.getByRole('radio', { name: /Request a callback/ }).check();
    await p.getByLabel('First name').fill('Dana');
    await p.getByLabel('Last name').fill('Reyes');
    await p.getByLabel('Mobile phone', { exact: true }).fill('7345550177');
    await p.getByLabel('Email', { exact: true }).fill('dana.e2e@example.com');
    await p.fill('#pf-contact-street', '12 W Front St');
    await p.fill('#pf-contact-city', 'Monroe');
    await p.getByRole('checkbox', { name: /By checking this box/ }).check();
    await p.getByRole('button', { name: 'Send my request' }).click();
    await p.getByText(/an advisor will reach out shortly/).waitFor();

    const a = await adminLogin(ctx, LIVE);
    await a.goto(`${LIVE}/admin/opportunities`);
    await a.locator('tr', { hasText: 'Dana Reyes' }).first().waitFor();
    const rows = await a.locator('tbody tr').allTextContents();
    expect(rows.some((r) => /Home internet → 1 Gig.*address not confirmed/.test(r))).toBe(true);
    expect(rows.some((r) => /Mobile → Tucker benchmark: mobile.*Needs an advisor quote · estimate/.test(r))).toBe(true);
    expect(rows.some((r) => /Electricity/.test(r))).toBe(false); // kept as is
    await a.getByRole('link', { name: 'Dana Reyes' }).first().click();
    await a.getByText('12 W Front St').first().waitFor();
    expect(errors).toEqual([]);
    await ctx.close();
  });
});
