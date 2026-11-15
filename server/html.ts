import { BRAND, siteMeta, structuredData } from '../shared/content';
import type { Market, MarketSummary } from '../shared/market';

/** Data embedded in every page so the client renders the right market with no extra request. */
export interface BootData {
  market: Market;
  markets: MarketSummary[];
  defaultSlug: string;
}

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** JSON inside <script> must never contain "</script" or "<!--". */
const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const escJson = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replaceAll(LS, '\\u2028').replaceAll(PS, '\\u2029');

export interface RenderOptions {
  siteUrl: string;
  /** Canonical path, e.g. "/" or "/toledo" or "/privacy". */
  canonicalPath: string;
  noindex?: boolean;
  /** Override the market-based title (e.g. privacy page). */
  title?: string;
  boot: BootData;
}

/**
 * Fills the %%PLACEHOLDERS%% in index.html. Used by the production server and
 * by the Vite dev plugin so both render identical <head> markup.
 */
export function renderHtml(template: string, o: RenderOptions): string {
  const m = o.boot.market;
  const meta = siteMeta(m);
  const pageUrl = `${o.siteUrl}${o.canonicalPath}`;
  const title = o.title ?? meta.title;
  const ogImage = `${o.siteUrl}${m.ogImage || '/og-image.jpg'}`;
  const head = [
    `<script type="application/ld+json">${escJson(structuredData(o.siteUrl, m, pageUrl))}</script>`,
    `<script type="application/json" id="boot-data">${escJson(o.boot)}</script>`,
  ].join('\n    ');
  return template
    .replaceAll('%%TITLE%%', escAttr(title))
    .replaceAll('%%DESCRIPTION%%', escAttr(meta.description))
    .replaceAll('%%SITE_NAME%%', escAttr(BRAND.name))
    .replaceAll('%%CANONICAL%%', escAttr(pageUrl))
    .replaceAll('%%OG_IMAGE%%', escAttr(ogImage))
    .replaceAll('%%ROBOTS%%', o.noindex ? 'noindex, nofollow' : 'index, follow')
    .replace('<!--%%HEAD_DATA%%-->', head);
}
