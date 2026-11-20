/**
 * Agent Workspace acceptance scenario in a real browser: a representative on
 * a phone works a new website inquiry from first contact to qualified, and a
 * manager on a desktop reviews the activity.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Browser, Page } from 'playwright';
import { adminLogin, axe, context, launch, overflow, PHONE } from './helpers';

// Its own production-mode server: separate representatives and leads, and its own login rate limit.
const BASE = inject('workspaceUrl');
let b: Browser;
beforeAll(async () => {
  b = await launch();
});
afterAll(async () => {
  await b.close();
});

const H = { 'X-Requested-With': 'fetch', 'Content-Type': 'application/json' };
const PASSWORD = 'workspace-pass-123';

async function signIn(p: Page, email: string) {
  await p.goto(`${BASE}/admin/login`);
  await p.fill('#email', email);
  await p.fill('#pw', PASSWORD);
  await p.click('button:has-text("Sign in")');
  await p.waitForURL(/\/admin\/work$/);
}

describe('agent workspace', () => {
  it('runs the representative workflow on a phone and shows it to a manager', async () => {
    const stamp = Date.now();
    const repEmail = `rep-${stamp}@example.com`;
    const managerEmail = `mgr-${stamp}@example.com`;
    const lastName = `Ws${stamp}`;
    // A number no other test uses: a returning household would stay with the representative already helping it.
    const last4 = String(stamp).slice(-4);
    const phone = `(313) 555-${last4}`;

    // Setup through the real admin API: a representative accepting leads, and a manager.
    const admin = await context(b, { viewport: { width: 1280, height: 800 } });
    const a = await adminLogin(admin.ctx, BASE);
    for (const [name, email, role, accepting] of [
      [`Riley ${stamp}`, repEmail, 'rep', true],
      [`Morgan ${stamp}`, managerEmail, 'manager', false],
    ] as const) {
      const r = await a.request.post(`${BASE}/api/admin/reps`, { headers: H, data: { name, email, role, accepting, active: true, password: PASSWORD } });
      expect(r.status()).toBe(201);
    }
    // Other accepting representatives from earlier tests stop taking leads, so routing is predictable.
    const all = (await (await a.request.get(`${BASE}/api/admin/reps`)).json()) as {
      representatives: { id: string; email: string; accepting: boolean; name: string; active: boolean; markets: string[]; categories: string[]; maxOpenLeads: number; phone: string }[];
    };
    for (const r of all.representatives.filter((x) => x.accepting && x.email !== repEmail)) {
      await a.request.put(`${BASE}/api/admin/reps/${r.id}`, {
        headers: H,
        data: { name: r.name, email: r.email, phone: r.phone, active: r.active, accepting: false, markets: r.markets, categories: r.categories, maxOpenLeads: r.maxOpenLeads },
      });
    }

    // The admin overview is open while the inquiry arrives; Refresh brings the new numbers in.
    await a.goto(`${BASE}/admin`);
    const totalTile = a.locator('.glass', { hasText: 'Total leads' }).locator('p').nth(1);
    await a.getByText(/^Updated .* refreshes every minute$/).waitFor();
    const totalBefore = Number(await totalTile.innerText());

    // 1–2. A website savings inquiry (internet and mobile).
    const inquiry = await a.request.post(`${BASE}/api/platform/handoff`, {
      headers: H,
      data: {
        firstName: 'Dana',
        phone,
        zip: '48161',
        consent: true,
        bills: { internet: 9500, mobile: 19000 },
        mobileLines: 3,
        ownsHome: false,
        showExtras: false,
        requestKey: crypto.randomUUID(),
        landingPage: '/',
        sessionId: `s-${stamp}`,
      },
    });
    expect(inquiry.status()).toBe(201);
    const leadId = ((await inquiry.json()) as { leadId: string }).leadId;
    await a.getByRole('button', { name: 'Refresh' }).click();
    await expect.poll(async () => Number(await totalTile.innerText())).toBe(totalBefore + 1);
    // Give the lead a unique last name so the manager can find it.
    const before = (await (await a.request.get(`${BASE}/api/admin/leads/${leadId}`)).json()) as { lead: { version: number } };
    await a.request.patch(`${BASE}/api/admin/leads/${leadId}/contact`, { headers: H, data: { version: before.lead.version, lastName } });

    // 3–4. The representative, on a phone, sees it as the next best action and opens it.
    const repCtx = await context(b, PHONE);
    const p = await repCtx.ctx.newPage();
    await signIn(p, repEmail);
    await p.getByRole('heading', { name: 'Your next best actions' }).waitFor();
    expect(await overflow(p)).toBeLessThanOrEqual(0);
    expect(await axe(p)).toEqual([]);
    await p
      .getByRole('link', { name: new RegExp(`Dana ${lastName}`) })
      .first()
      .click();
    await p.waitForURL(new RegExp(`/admin/leads/${leadId}$`));
    await p.getByRole('heading', { level: 1, name: new RegExp(`Dana ${lastName}`) }).waitFor();
    // 5–7. Submitted data and the labelled illustrative comparison.
    await p.getByText(phone).first().waitFor();
    await p.getByRole('heading', { name: 'What they previewed' }).waitFor();
    expect(await p.getByText(/not verified|unverified/i).count()).toBeGreaterThan(0);
    expect(await overflow(p)).toBeLessThanOrEqual(0);
    expect(await axe(p)).toEqual([]);

    const bar = p.locator('div.fixed.bottom-0');
    // 8–9. Contact attempt from the thumb bar; it appears in the activity.
    await bar.getByRole('button', { name: 'Update status' }).click();
    await p.getByRole('dialog').getByRole('button', { name: 'No answer' }).click();
    await p.getByText('Saved: No answer').waitFor();
    // 10–11. An internal note with author and time.
    await p.getByLabel('New note').fill('Pays about $95 for internet and wants faster upload.');
    await p.getByRole('button', { name: 'Save note' }).click();
    await p.getByText('Pays about $95 for internet and wants faster upload.').waitFor();
    expect(await p.getByText(new RegExp(`Riley ${stamp} ·`)).count()).toBeGreaterThan(0);

    // 12–14. Callback requested: schedule it; it shows in the follow-up queue.
    await bar.getByRole('button', { name: 'Update status' }).click();
    await p.getByRole('dialog').getByRole('button', { name: 'Callback requested' }).click();
    await p.getByRole('dialog').getByRole('button', { name: 'In 1 hour' }).click();
    await p.getByRole('dialog').getByRole('button', { name: 'Save' }).click();
    await p.getByText('Saved: Callback requested').waitFor();
    await p.getByText('Call back (customer asked)').first().waitFor();
    await p.goto(`${BASE}/admin/follow-ups`);
    await p
      .getByRole('tab', { name: /Due today|Upcoming/ })
      .first()
      .waitFor();
    const due = p.getByRole('listitem').filter({ hasText: 'Call back (customer asked)' });
    if (!(await due.count())) await p.getByRole('tab', { name: /Upcoming/ }).click();
    // 15. Complete the callback.
    await p.getByRole('listitem').filter({ hasText: 'Call back (customer asked)' }).getByRole('button', { name: 'Done' }).click();
    await p.getByText('Follow-up done').waitFor();

    // 16. Qualify the lead.
    await p.goto(`${BASE}/admin/leads/${leadId}`);
    await bar.getByRole('button', { name: 'Update status' }).click();
    await p.getByRole('dialog').getByRole('button', { name: 'Qualified', exact: true }).click();
    await p.getByText('Saved: Qualified').waitFor();
    await p.getByRole('tab', { name: 'Activity' }).click();
    await p.getByRole('heading', { name: 'Activity' }).waitFor();
    for (const t of ['No answer', 'Callback requested', 'Qualified', 'Follow-up completed: Call back (customer asked)']) expect(await p.getByText(t, { exact: true }).count()).toBeGreaterThan(0);
    expect(repCtx.errors).toEqual([]);
    await repCtx.ctx.close();

    // 17–19. The manager, on a desktop, finds the lead and sees who did what; a representative cannot.
    const mgrCtx = await context(b, { viewport: { width: 1280, height: 800 } });
    const m = await mgrCtx.ctx.newPage();
    await signIn(m, managerEmail);
    await m.goto(`${BASE}/admin/leads?q=${lastName}`);
    await m
      .getByRole('link', { name: new RegExp(`Dana ${lastName}`) })
      .first()
      .click();
    await m.getByRole('heading', { name: 'Activity' }).waitFor();
    expect(await m.getByText(new RegExp(`Riley ${stamp} ·`)).count()).toBeGreaterThan(2);
    await m.getByLabel('Assign this lead').waitFor();
    expect(await axe(m)).toEqual([]);
    expect(mgrCtx.errors).toEqual([]);
    await mgrCtx.ctx.close();
    await admin.ctx.close();
  }, 120_000);
});
