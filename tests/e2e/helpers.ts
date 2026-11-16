/// <reference lib="dom" />
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chromium, devices, type Browser, type BrowserContext, type Page } from 'playwright';
import { ADMIN } from './global-setup';

const require = createRequire(import.meta.url);
const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

export { ADMIN };
export const PHONE = devices['iPhone 13'];

export async function launch(): Promise<Browser> {
  return chromium.launch();
}

/** A context that records page errors and console errors (4xx resource logs excluded). */
export async function context(b: Browser, opts: Parameters<Browser['newContext']>[0] = {}) {
  // bypassCSP only so axe can be injected; the app itself runs with its real CSP otherwise.
  const ctx = await b.newContext({ bypassCSP: true, ...opts });
  const errors: string[] = [];
  ctx.on('page', (p) => watch(p, errors));
  return { ctx, errors };
}

export function watch(p: Page, errors: string[]) {
  p.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  p.on('console', (m) => {
    if (m.type() === 'error' && !/status of 4\d\d/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
}

/** Runs axe-core (WCAG 2.2 AA + best practices) and returns "rule(count)" strings. */
export async function axe(p: Page): Promise<string[]> {
  await p.addScriptTag({ content: AXE_SOURCE });
  return p.evaluate(async () => {
    const w = window as unknown as { axe: { run: (ctx: Document, o: object) => Promise<{ violations: { id: string; nodes: unknown[] }[] }> } };
    const r = await w.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] });
    return r.violations.map((v) => `${v.id}(${v.nodes.length})`);
  });
}

/** Pixels the page scrolls sideways (0 = no horizontal scroll). */
export const overflow = (p: Page) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

/** Creates an assessment through the public API and returns its results URL. */
export async function createAssessment(baseUrl: string, assessment: object): Promise<{ id: string; token: string; url: string }> {
  const r = await fetch(`${baseUrl}/api/platform/assessments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ assessment }) });
  if (r.status !== 201) throw new Error(`createAssessment failed: ${r.status} ${await r.text()}`);
  const b = (await r.json()) as { id: string; token: string };
  return { ...b, url: `${baseUrl}/savings/results/${b.id}#t=${b.token}` };
}

export async function adminLogin(ctx: BrowserContext, baseUrl: string): Promise<Page> {
  const a = await ctx.newPage();
  await a.goto(`${baseUrl}/admin/login`);
  await a.fill('#email', ADMIN.email);
  await a.fill('#pw', ADMIN.password);
  await a.click('button:has-text("Sign in")');
  await a.waitForURL(/\/admin$/);
  return a;
}

export const HOUSEHOLD = {
  zip: '48161',
  categories: ['internet', 'mobile', 'electricity'],
  internet: { provider: 'Comcast Xfinity', monthlyCents: 8500, equipmentFeeCents: 1500 },
  mobile: { carrier: 'Verizon', monthlyCents: 19000, lines: 3 },
  electricity: { utility: 'DTE Energy', monthlyCents: 16000, homeownership: 'own', roofSun: 'mostly_sunny' },
};
