import { BRAND, siteMeta, structuredData } from '../shared/content';
import type { Market, MarketSummary } from '../shared/market';
import type { Flags } from './config';

/** Data embedded in every page so the client renders the right market with no extra request. */
export interface BootData {
  market: Market;
  markets: MarketSummary[];
  defaultSlug: string;
  flags: Flags;
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
  description?: string;
  /** Omit the fiber-location structured data (e.g. platform pages). */
  omitStructuredData?: boolean;
  /** Same-origin build assets to fetch early (lazy chunks of this page). */
  preload?: { scripts: string[]; styles: string[] };
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
  const assetPath = (p: string) => /^\/assets\/[A-Za-z0-9._-]+\.(js|css)$/.test(p);
  const head = [
    ...(o.preload?.styles ?? []).filter(assetPath).map((h) => `<link rel="stylesheet" crossorigin href="${escAttr(h)}" />`),
    ...(o.preload?.scripts ?? []).filter(assetPath).map((h) => `<link rel="modulepreload" crossorigin href="${escAttr(h)}" />`),
    o.omitStructuredData ? '' : `<script type="application/ld+json">${escJson(structuredData(o.siteUrl, m, pageUrl))}</script>`,
    `<script type="application/json" id="boot-data">${escJson(o.boot)}</script>`,
  ]
    .filter(Boolean)
    .join('\n    ');
  // Non-production environments are never indexed.
  const noindex = o.noindex || o.boot.flags.env !== 'production';
  // Function-form replacements: admin-entered text containing "$&" or "$'" must
  // be inserted literally, not interpreted as a replacement pattern.
  const values: Record<string, string> = {
    '%%TITLE%%': escAttr(title),
    '%%DESCRIPTION%%': escAttr(o.description ?? meta.description),
    '%%SITE_NAME%%': escAttr(BRAND.name),
    '%%CANONICAL%%': escAttr(pageUrl),
    '%%OG_IMAGE%%': escAttr(ogImage),
    '%%ROBOTS%%': noindex ? 'noindex, nofollow' : 'index, follow',
    '<!--%%HEAD_DATA%%-->': head,
  };
  return template.replace(/%%[A-Z_]+%%|<!--%%HEAD_DATA%%-->/g, (token) => values[token] ?? token);
}
