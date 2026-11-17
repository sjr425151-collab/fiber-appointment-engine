/**
 * Website chat in a real browser, on a phone and on a desktop: open, give
 * bills in one message, see the savings card, edit an amount, ask for a
 * person, then find the transcript on the lead in the admin area.
 */
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import type { Browser } from 'playwright';
import { adminLogin, axe, context, launch, overflow, PHONE } from './helpers';

const BASE = inject('stagingUrl');
let b: Browser;
beforeAll(async () => {
  b = await launch();
});
afterAll(async () => {
  await b.close();
});

describe.each([
  ['phone', PHONE],
  ['desktop', { viewport: { width: 1280, height: 800 } }],
])('chat on %s', (name, device) => {
  it('gives a preview from one message and hands off to a person with the transcript', async () => {
    const { ctx, errors } = await context(b, device);
    const p = await ctx.newPage();
    await p.goto(`${BASE}/`);
    // The floating button (the hero has a second "Chat with an Agent" button on the home page).
    const launcher = p.locator('button[aria-haspopup=dialog]', { hasText: 'Chat with an Agent' });
    await launcher.click();
    const dialog = p.getByRole('dialog', { name: /Tucker AI/ });
    await expect(dialog.getByText('AI assistant', { exact: true })).toBeTruthy();
    await dialog.getByText(/I’m Tucker’s AI assistant/).waitFor();
    expect(await overflow(p)).toBeLessThanOrEqual(0);
    expect(await axe(p)).toEqual([]);

    await dialog.getByLabel('Message Tucker AI').fill('internet $110, phone $180 for 3 lines');
    await dialog.getByRole('button', { name: 'Send' }).click();
    await dialog.getByText('Your household savings preview').waitFor();
    await dialog.getByText('$100/month').waitFor();

    // Change an amount on the card: recomputed by the server.
    await dialog.getByRole('button', { name: 'Change Home internet amount' }).click();
    await dialog.getByLabel('New monthly amount for Home internet').fill('75');
    await dialog.getByRole('button', { name: 'Update' }).click();
    await dialog.getByText('Updated with your changes.').waitFor();
    await dialog.getByText('$65/month').last().waitFor();

    // Minimize and reopen: the conversation is still there.
    await dialog.getByRole('button', { name: 'Minimize chat' }).click();
    await launcher.click();
    await dialog.getByText('Updated with your changes.').waitFor();

    await dialog.getByRole('button', { name: 'Talk to a Real Representative' }).click();
    await dialog.getByLabel('First name').fill(`Chat${name}`);
    await dialog.getByRole('textbox', { name: 'Phone', exact: true }).fill('(734) 555-0123');
    await dialog.getByLabel('ZIP code').fill('48161');
    await dialog.locator('#ch-consent').check();
    await dialog.getByRole('button', { name: 'Request my representative' }).click();
    await dialog.getByText(/no representative has joined this chat/).waitFor();
    expect(await dialog.getByText(/Spotlight Marketing LLC/).count()).toBeGreaterThan(0);
    expect(errors).toEqual([]);
    await ctx.close();

    // The team sees the lead with the chat attached.
    const admin = await context(b, { viewport: { width: 1280, height: 800 } });
    const a = await adminLogin(admin.ctx, BASE);
    await a.goto(`${BASE}/admin/chats`);
    await a.getByRole('heading', { name: 'Website chat' }).waitFor();
    await a
      .getByRole('link', { name: new RegExp(`Chat${name}`) })
      .first()
      .click();
    await a.getByRole('heading', { name: 'Website chat' }).waitFor();
    await a.getByText('internet $110, phone $180 for 3 lines', { exact: true }).first().waitFor();
    await admin.ctx.close();
  }, 60_000);
});
