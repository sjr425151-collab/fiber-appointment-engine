/**
 * Zod-free helpers for markets. The public site imports from here (types are
 * erased at build time) so visitors never download the validation library.
 */
import type { Market } from './market';

/**
 * Lowest advertised plan, e.g. { name: "1 Gig", price: "$50/mo" }, or null.
 * Plans are listed slowest → fastest, so on a price tie the faster plan wins
 * ("1 Gig from $50/mo" rather than "500 Mbps from $50/mo").
 */
export function plansFrom(m: Pick<Market, 'plans'>): { name: string; price: string } | null {
  let best: { name: string; price: string; n: number } | null = null;
  for (const p of m.plans) {
    const n = Number(p.price.replace(/[^0-9.]/g, ''));
    if (Number.isFinite(n) && n > 0 && (!best || n <= best.n)) best = { name: p.name, price: p.price, n };
  }
  return best && { name: best.name, price: best.price };
}

/** "A", "A and B", "A, B, and C". */
export function listJoin(items: string[], conj = 'and'): string {
  if (items.length < 3) return items.join(` ${conj} `);
  return `${items.slice(0, -1).join(', ')}, ${conj} ${items[items.length - 1]}`;
}
