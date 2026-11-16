/**
 * Real internet offers, derived from a location's admin-managed settings
 * (provider, plans, "prices verified on" date, official label link) instead of
 * being hard-coded for one provider or city. Any location configured in the
 * admin therefore gets real comparisons with no code change.
 *
 * Nothing is guessed: a plan whose price can't be read exactly is left out, and
 * prices without a readable verification date are marked "pending" (hidden
 * from customers until someone re-verifies them in Locations).
 */
import type { Cents } from '../finance/money';
import type { Market, Plan } from '../market';
import type { Offer } from '../offers/model';

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** "$50/mo", "$49.99", "$1,050 / month" → integer cents; anything else → null. */
export function parseMonthlyPrice(price: string): Cents | null {
  const m = /^\$\s?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{2}))?\s*(?:\/\s*(?:mo|month)\.?)?$/i.exec(price.trim());
  if (!m) return null;
  const cents = Number(m[1].replace(/,/g, '')) * 100 + Number(m[2] ?? 0);
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 1_000_000 ? cents : null;
}

/** "500 Mbps" → 500, "1 Gig" / "2 Gbps" → 1000 / 2000; unknown → null. */
export function parseSpeedMbps(text: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*(mbps|meg|mb|gig|gbps|gb|g)\b/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  const mbps = /^(gig|gbps|gb|g)$/i.test(m[2]) ? n * 1000 : n;
  return Number.isInteger(mbps) && mbps > 0 && mbps <= 100_000 ? mbps : null;
}

/** "November 15, 2026" or "2026-11-15" → ISO timestamp; unreadable → null. */
export function parseVerifiedOn(text: string): string | null {
  const t = Date.parse(text.trim());
  return text.trim() && Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/** Offers for one location, valid in the given ZIPs. */
export function offersFromMarket(market: Pick<Market, 'slug' | 'name' | 'provider' | 'plans' | 'plansVerifiedOn' | 'broadbandLabelsUrl'>, zips: string[]): Offer[] {
  const verifiedAt = parseVerifiedOn(market.plansVerifiedOn);
  const providerId = slug(market.provider) || 'provider';
  const out: Offer[] = [];
  const seen = new Set<string>();
  market.plans.forEach((p: Plan) => {
    const price = parseMonthlyPrice(p.price);
    const id = `${market.slug}-${slug(p.name)}`.slice(0, 80);
    if (price === null || seen.has(id) || !/^[a-z0-9-]{2,80}$/.test(id)) return;
    seen.add(id);
    const mbps = parseSpeedMbps(p.name) ?? parseSpeedMbps(p.speed);
    const fiber = /fiber/i.test(`${market.provider} ${p.speed} ${p.name}`);
    out.push({
      id,
      providerId,
      category: 'internet',
      planName: p.name,
      attributes: { ...(mbps ? { downloadMbps: mbps } : {}), ...(fiber ? { technology: 'fiber' as const } : {}) },
      pricing: { baseMonthly: price, quality: 'manually_verified' },
      contractMonths: 0,
      geography: { zips, marketIds: [market.slug] },
      eligibility: { newCustomersOnly: false, requires: [] },
      restrictions: [...p.highlights.map((h) => `Included: ${h}`), ...(p.fineprint ? [p.fineprint] : [])],
      ...(market.broadbandLabelsUrl ? { disclosureUrl: market.broadbandLabelsUrl } : {}),
      provenance: {
        sourceType: 'staff_confirmation',
        reference: `Plans entered in Locations for ${market.name} (${market.provider})${market.plansVerifiedOn ? `, verified ${market.plansVerifiedOn}` : ''}`,
        recordedBy: 'Spotlight Marketing LLC',
        // Without a readable verification date the price is treated as unverified.
        verifiedAt: verifiedAt ?? '1970-01-01T00:00:00.000Z',
        review: verifiedAt ? 'manually_verified' : 'pending',
        gaps: [`Confirm the exact price and terms with ${market.provider} for your address`],
      },
    });
  });
  return out;
}

/** Days a staff-confirmed price stays shown before it must be re-verified (same rule the offer model applies). */
export const PRICE_FRESH_DAYS = 30;

/**
 * Health of a location's prices for the savings comparison, so the team is
 * warned before plans silently drop out of customers' results.
 */
export function pricingHealth(market: Pick<Market, 'plans' | 'plansVerifiedOn'>, now: Date): { state: 'ok' | 'expiring' | 'hidden' | 'none'; daysLeft: number | null } {
  if (!market.plans.some((p) => parseMonthlyPrice(p.price) !== null)) return { state: 'none', daysLeft: null };
  const verifiedAt = parseVerifiedOn(market.plansVerifiedOn);
  if (!verifiedAt) return { state: 'hidden', daysLeft: null };
  const daysLeft = PRICE_FRESH_DAYS - Math.floor((now.getTime() - new Date(verifiedAt).getTime()) / 86_400_000);
  return { state: daysLeft < 0 ? 'hidden' : daysLeft <= 7 ? 'expiring' : 'ok', daysLeft };
}
