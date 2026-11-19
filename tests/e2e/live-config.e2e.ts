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
    await p.getByRole('heading', { level: 1, name: /See if your household could save 50% or more on monthly bills/ }).waitFor();
    expect(await p.locator('main').innerText()).toMatch(/Results vary and many households will save less/);
    expect(await p.getByRole('heading', { name: 'Type what you pay. We’ll find a smarter option.' }).count()).toBe(1);
    expect(await p.title()).toBe('Tucker | See If You’re Overspending on Household Bills');
    expect(await p.locator('link[rel=canonical]').getAttribute('href')).toBe(`${LIVE}/`);
    expect(await p.locator('meta[property="og:image"]').getAttribute('content')).toBe(`${LIVE}/og-tucker-bear.jpg`);
    const text = (await p.locator('body').innerText()) ?? '';
    expect(text).not.toMatch(/Monroe|Omni|Michigan|LiveFiberConnect|Fiber Connect|Sample|Staging preview|fiber|commission|paid by provider/i);
    expect(text).toMatch(/Tucker may receive compensation from providers\./);
    // The clean white layout: no background video or hero image.
    expect(await p.locator('video').count()).toBe(0);
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
    // Owning the home is not enough: solar and home security stay unpriced until the owner asks.
    expect(await preview.innerText()).not.toMatch(/\$200|Home security/);
    expect(await p.locator('#qp-security').count()).toBe(0);
    await p.check('#qp-extras');
    await p.fill('#qp-security', '75');
    expect(await preview.innerText()).toMatch(/Home security vs \$80[\s\S]*\$5\/mo more/);
    expect(await preview.innerText()).toMatch(/\$200\/mo less[\s\S]*About \$2,400 a year[\s\S]*Benchmark/);
    expect(await p.locator('main').innerText()).toMatch(/comparison assumptions, not offers or guarantees/);
    expect(posted).toEqual([]); // nothing was sent anywhere to see the preview
    // The hero's chat button opens the AI chat (labelled as an AI, never as a person).
    await p.locator('main').getByRole('button', { name: 'Chat with an Agent' }).click();
    await p
      .getByRole('dialog', { name: /Tucker AI/ })
      .getByText(/AI assistant/)
      .first()
      .waitFor();
    await p.getByRole('button', { name: 'Minimize chat' }).click();
    await p.evaluate(() => sessionStorage.clear());
    expect(await axe(p)).toEqual([]);

    // The numbers carry into the full preview.
    await p.getByRole('button', { name: 'See my full preview' }).click();
    await p.getByRole('heading', { level: 1, name: 'Where is your home?' }).waitFor();
    await p.fill('#pf-f-zip', '60601');
    await p.getByRole('button', { name: 'Continue' }).click();
    expect(await p.locator('input[type=checkbox]:checked').count()).toBe(5); // all four bills plus home security
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

    // Internet: every household is compared with the national $55 benchmark; there are no location plans any more.
    expect(await p.getByRole('radio', { name: /^Tucker benchmark: home internet, \$55/ }).isChecked()).toBe(true);
    // Mobile: no real plan on file → $45 × 3 lines benchmark, selected because it is lower than $190.
    const mobile = p.locator('article', { has: p.getByRole('heading', { name: 'Mobile phones' }) });
    expect(await p.getByRole('radio', { name: /^Tucker benchmark: mobile, \$135/ }).isChecked()).toBe(true);
    expect(await mobile.textContent()).toMatch(/\$63\.33 per line for 3 lines[\s\S]*\$45 a month per line[\s\S]*not offers or guarantees/);
    // Electricity: $160 is already below the $200 solar benchmark, so it is shown but not selected.
    expect(await p.getByRole('radio', { name: /^Tucker benchmark: electricity with solar/ }).isChecked()).toBe(false);
    expect(await overflow(p)).toBe(0);
    expect(await axe(p)).toEqual([]);

    await p.getByRole('link', { name: 'Get My Exact Pricing' }).click();
    await p.getByRole('radio', { name: /Request a callback/ }).check();
    await p.getByLabel('First name').fill('Dana');
    await p.getByLabel('Last name').fill('Reyes');
    await p.getByLabel('Mobile phone', { exact: true }).fill('7345550177');
    await p.fill('#pf-contact-email', 'dana.e2e@example.com');
    await p.getByRole('checkbox', { name: /By checking this box/ }).check();
    await p.getByRole('button', { name: 'Request my pricing review' }).click();
    await p.getByRole('heading', { name: 'Your Pricing Review Has Been Requested' }).waitFor();

    const a = await adminLogin(ctx, LIVE);
    await a.goto(`${LIVE}/admin/opportunities`);
    await a.locator('tr', { hasText: 'Dana Reyes' }).first().waitFor();
    const rows = await a.locator('tbody tr').allTextContents();
    expect(rows.some((r) => /Home internet → Tucker benchmark: home internet.*Needs an advisor quote · estimate/.test(r))).toBe(true);
    expect(rows.some((r) => /Mobile → Tucker benchmark: mobile.*Needs an advisor quote · estimate/.test(r))).toBe(true);
    expect(rows.some((r) => /Electricity/.test(r))).toBe(false); // kept as is
    await a.getByRole('link', { name: 'Dana Reyes' }).first().click();
    await a.getByRole('heading', { name: 'What they previewed' }).waitFor();
    expect(errors).toEqual([]);
    await ctx.close();
  });
});

describe('representative handoff', () => {
  it('turns a preview into a saved request with four fields, then an admin assigns it and the representative sees only that lead', async () => {
    const { ctx, errors } = await context(b, { viewport: { width: 320, height: 700 } });
    const p = await ctx.newPage();
    const posted: string[] = [];
    p.on('request', (r) => r.method() === 'POST' && !r.url().includes('/api/events') && posted.push(new URL(r.url()).pathname));
    await p.goto(`${LIVE}/?utm_source=e2e&utm_campaign=handoff`);
    await p.fill('#qp-internet', '95');
    await p.fill('#qp-mobile', '190');
    await p.selectOption('#qp-lines', '3');

    // The call to action appears with the preview; the form opens in place and takes focus.
    await p.getByRole('button', { name: 'Get My Exact Pricing' }).click();
    await p.waitForFunction(() => document.activeElement?.id === 'ho-firstName');
    expect(await p.locator('form[aria-labelledby=ho-title]').innerText()).toMatch(/No obligation to switch[\s\S]*Personalized pricing verification[\s\S]*No purchase required/);
    expect(await p.locator('#ho-more').isHidden()).toBe(true); // optional details stay out of the way
    expect(await axe(p)).toEqual([]);
    expect(await overflow(p)).toBe(0);

    // Nothing is sent, and nothing is lost, when details are missing.
    await p.getByRole('button', { name: 'Request my pricing review' }).click();
    await p.waitForFunction(() => document.activeElement?.id === 'ho-firstName');
    expect(await p.locator('#ho-firstName').getAttribute('aria-invalid')).toBe('true');
    expect(await p.getByText(/check the box so a representative can contact you/).count()).toBe(1);
    expect(posted).toEqual([]);
    expect(await axe(p)).toEqual([]);

    // Keyboard only from here: type, tab, space to consent, enter to send.
    await p.keyboard.type('Jordan');
    await p.keyboard.press('Tab');
    await p.keyboard.type('734 555 0166');
    await p.keyboard.press('Tab');
    await p.keyboard.type('48161');
    await p.focus('#ho-consent');
    await p.keyboard.press('Space');
    // A failed send keeps every field and can be retried safely.
    await p.route('**/api/platform/handoff', (route) => route.abort(), { times: 1 });
    await p.keyboard.press('Enter');
    await p.getByText(/Nothing you typed was lost/).waitFor();
    expect(await p.inputValue('#ho-firstName')).toBe('Jordan');
    expect(await p.getByRole('heading', { name: 'Your Pricing Review Has Been Requested' }).count()).toBe(0);
    await p.getByRole('button', { name: 'Request my pricing review' }).click();

    const done = p.getByRole('status').filter({ hasText: 'Your Pricing Review Has Been Requested' });
    await done.waitFor();
    expect(await p.evaluate(() => document.activeElement?.getAttribute('role'))).toBe('status');
    const text = await done.innerText();
    expect(text).toMatch(/With:\s*The Tucker Team \(Spotlight Marketing LLC\)/); // the representative's name is never shown // nobody is assigned yet, so no name is invented
    expect(text).toMatch(/Contact by:\s*Phone call, \(734\) 555-0166/);
    expect(text).not.toMatch(/within|minutes|hours|today|shortly|guarantee/i);
    expect(posted.filter((u) => u === '/api/platform/handoff')).toHaveLength(2); // the failed try and the retry
    expect(await axe(p)).toEqual([]);
    expect(await overflow(p)).toBe(0);
    // The full preview built from the same bills is one tap away, with nothing retyped.
    await done.getByRole('link', { name: 'See my full preview' }).click();
    await p.getByRole('heading', { level: 1, name: 'Your household snapshot' }).waitFor();
    await p.getByText(/already asked us to review these results/).waitFor();

    // Admin: the request waits in the queue, marked as a preliminary comparison.
    const a = await adminLogin(ctx, LIVE);
    await a.setViewportSize({ width: 1280, height: 900 });
    await a.goto(`${LIVE}/admin/leads`);
    await a.getByRole('button', { name: 'Unassigned', exact: true }).click();
    const row = a.locator('tr', { hasText: 'Jordan' });
    await row.waitFor();
    expect(await row.innerText()).toMatch(/Unassigned/);
    expect(await a.locator('tbody tr', { hasText: 'Jordan' }).count()).toBe(1); // sent twice, saved once
    await row.getByRole('link', { name: 'Jordan' }).click();
    await a.getByRole('heading', { name: 'What they previewed' }).waitFor();
    const body = await a.locator('main').innerText();
    expect(body).toMatch(/Not verified pricing, not a quote/);
    expect(body).toMatch(/Mobile \(3 lines\)\s+\$190\.00\/mo\s+\$135\.00\/mo\s+Tucker benchmark\s+\$55\.00\/mo less/);
    expect(body).toMatch(/illustrative difference \$95\.00\/mo \(\$1,140\.00\/yr\)/);
    expect(body).toMatch(/Marketing consent: no/);
    expect(body).toMatch(/Owner\s+Unassigned/);
    expect(body).toMatch(/e2e \/ handoff/);
    expect(await axe(a)).toEqual([]);

    // Add a representative and hand the lead over.
    await a.getByRole('link', { name: 'Representatives' }).click();
    await a.getByRole('button', { name: 'Add representative' }).click();
    await a.fill('#rep-name', 'Alex Rivera');
    await a.fill('#rep-email', 'alex.e2e@example.com');
    await a.fill('#rep-password', 'alex-e2e-password-1');
    await a.getByLabel('Accepting new leads now').check();
    await a.getByRole('button', { name: 'Save' }).click();
    await a.locator('tr', { hasText: 'Alex Rivera' }).getByText('Accepting leads').waitFor();
    expect(await axe(a)).toEqual([]);
    await a.getByRole('link', { name: 'Leads', exact: true }).click();
    await a.getByRole('heading', { name: /^Leads/ }).waitFor();
    await a.getByRole('link', { name: 'Jordan' }).click();
    await a.getByLabel('Assign this lead').selectOption({ label: 'Alex Rivera · 0 open' });
    await a.getByText('Lead reassigned. Open follow-ups moved with it.').waitFor();
    await a.locator('header').getByText('Assigned', { exact: true }).first().waitFor();
    await a.getByText('Stage: new → assigned').first().waitFor();
    await a.getByRole('button', { name: 'Sign out' }).click();

    // The representative signs in and sees only their own lead, with none of the admin screens.
    await a.fill('#email', 'alex.e2e@example.com');
    await a.fill('#pw', 'alex-e2e-password-1');
    await a.click('button:has-text("Sign in")');
    // Representatives land on their own workspace; the lead is their next action.
    await a.getByRole('heading', { name: 'Your next best actions' }).waitFor();
    expect(await a.getByRole('navigation', { name: 'Admin' }).innerText()).toMatch(/^Overview\s+My leads\s+Follow-ups$/);
    await a.getByRole('navigation', { name: 'Admin' }).getByRole('link', { name: 'My leads' }).click();
    await a.getByRole('heading', { name: /^My leads/ }).waitFor();
    await a.locator('tbody tr', { hasText: 'Jordan' }).waitFor(); // the table, not a link elsewhere on the page
    expect(await a.locator('tbody tr').count()).toBe(1);
    await a.getByRole('link', { name: 'Jordan' }).click();
    await a.getByRole('button', { name: 'Update status' }).first().click();
    await a.getByRole('dialog').getByRole('button', { name: 'Attempted contact' }).click();
    await a.getByText('Saved: Attempted contact').waitFor();
    await a.getByText('Stage: assigned → contact_attempted').first().waitFor();
    expect(await a.locator('#lead-assign').count()).toBe(0); // only an admin can reassign
    const refused = await a.evaluate(() => fetch('/api/admin/reps', { credentials: 'same-origin' }).then((r) => r.status));
    expect(refused).toBe(403);
    await a.goto(`${LIVE}/admin`);
    const saved = a.waitForResponse((r) => r.url().endsWith('/api/admin/reps/me') && r.status() === 200);
    await a.getByLabel('Accepting new leads').uncheck();
    await saved;
    expect(errors.filter((e) => !/403|ERR_FAILED/.test(e))).toEqual([]); // the refused admin call and the simulated outage above
    await ctx.close();
  });
});
