import { describe, expect, it } from 'vitest';
import { checkEligibility, publicStatus, type Offer } from '../shared/offers/model';
import { rankOffers } from '../shared/offers/rank';
import { collectOffers, StaticOfferAdapter, type ProviderAdapter } from '../shared/offers/adapters';
import { MONROE_OFFERS } from '../shared/offers/seed';
import type { CostStream } from '../shared/finance/engine';

const NOW = new Date('2026-11-16T12:00:00Z');
const [o500, o1g, o2g] = MONROE_OFFERS;
const withProv = (o: Offer, p: Partial<Offer['provenance']>): Offer => ({ ...o, provenance: { ...o.provenance, ...p } });
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe('public status from provenance', () => {
  it('labels staff-confirmed pricing as manually verified, never "verified"', () => {
    expect(publicStatus(o1g, NOW).status).toBe('manually_verified');
    expect(publicStatus(withProv(o1g, { review: 'verified' }), NOW).status).toBe('manually_verified');
    expect(publicStatus(withProv(o1g, { review: 'verified', sourceType: 'provider_document' }), NOW).status).toBe('verified');
  });
  it('downgrades stale, future, expired and withdrawn records automatically', () => {
    expect(publicStatus(withProv(o1g, { verifiedAt: days(31) }), NOW)).toMatchObject({ status: 'pending_verification' });
    expect(publicStatus(withProv(o1g, { verifiedAt: days(31) }), NOW).reasons[0]).toMatch(/needs re-verification/);
    expect(publicStatus(withProv(o1g, { effectiveFrom: '2027-01-01T00:00:00Z' }), NOW).status).toBe('pending_verification');
    expect(publicStatus(withProv(o1g, { expiresAt: days(1) }), NOW)).toEqual({ status: 'unavailable', reasons: ['Offer expired'] });
    expect(publicStatus(withProv(o1g, { review: 'withdrawn' }), NOW).status).toBe('unavailable');
    expect(publicStatus(withProv(o1g, { review: 'estimated' }), NOW).status).toBe('estimated');
  });
});

describe('eligibility', () => {
  it('never treats approximate or ZIP-level coverage as address-level serviceability', () => {
    expect(checkEligibility(o1g, { zip: '90210' })).toEqual({ eligible: false, reasons: ['Not offered in this area'] });
    expect(checkEligibility(o1g, { zip: '48161' }).eligible).toBe('unknown');
    expect(checkEligibility(o1g, { zip: '48161', coverage: { 'omni-fiber': 'map_approximate' } }).eligible).toBe('unknown');
    expect(checkEligibility(o1g, { zip: '48161', coverage: { 'omni-fiber': 'zip_confirmed' } }).reasons[0]).toMatch(/exact address not yet confirmed/);
    expect(checkEligibility(o1g, { zip: '48161', coverage: { 'omni-fiber': 'address_confirmed' } })).toEqual({ eligible: true, reasons: [] });
    expect(checkEligibility(o1g, { zip: '48161', coverage: { 'omni-fiber': 'none' } }).eligible).toBe(false);
  });
  it('applies new-customer and household requirements', () => {
    const promo: Offer = { ...o1g, eligibility: { newCustomersOnly: true, requires: ['autopay'] } };
    const confirmed = { zip: '48161', coverage: { 'omni-fiber': 'address_confirmed' as const } };
    expect(checkEligibility(promo, { ...confirmed, existingProviderIds: ['omni-fiber'] }).eligible).toBe(false);
    expect(checkEligibility(promo, confirmed)).toEqual({ eligible: false, reasons: ['Requires: autopay'] });
    expect(checkEligibility(promo, { ...confirmed, facts: new Set(['autopay']) }).eligible).toBe(true);
  });
});

describe('ranking lenses', () => {
  const current: CostStream[] = [
    { id: 'cable', label: 'Cable internet', category: 'internet', baseMonthly: 9000, recurring: [{ label: 'Modem rental', monthly: 1500 }] },
    { id: 'mobile', label: 'Mobile', category: 'mobile', baseMonthly: 12000 },
  ];
  const rank = (offers: Offer[], coverage: Record<string, 'address_confirmed' | 'zip_confirmed'>) =>
    rankOffers({ current, offers, replaces: (o) => (o.category === 'internet' ? 'cable' : null), ctx: { zip: '48161', marketId: 'monroe', coverage }, now: NOW });

  it('picks transparent winners per lens for a confirmed address', () => {
    const r = rank(MONROE_OFFERS, { 'omni-fiber': 'address_confirmed' });
    expect(r.recommendable).toHaveLength(3);
    const lens = Object.fromEntries(r.lenses.map((l) => [l.lens, l.offerId]));
    expect(lens).toEqual({
      lowest_cost: 'omni-monroe-1g', // ties with 500 Mbps at $50 → faster plan wins
      best_value: 'omni-monroe-2g', // 2000 Mbps / $70 beats 1000 Mbps / $50
      highest_performance: 'omni-monroe-2g',
      lowest_friction: 'omni-monroe-1g',
    });
    const g1 = r.recommendable.find((c) => c.offerId === 'omni-monroe-1g')!;
    expect(g1.savingsTotal).toBe(60 * (10500 - 5000)); // modem rental goes away too
    expect(g1.breakEvenMonths).toBe(0);
    for (const l of r.lenses) expect(l.criteria.length).toBeGreaterThan(20);
  });

  it('keeps unconfirmed addresses out of recommendations (shown as needing verification)', () => {
    const r = rank(MONROE_OFFERS, { 'omni-fiber': 'zip_confirmed' });
    expect(r.recommendable).toHaveLength(0);
    expect(r.needsVerification.map((c) => c.offerId).sort()).toEqual(['omni-monroe-1g', 'omni-monroe-2g', 'omni-monroe-500']);
    expect(r.lenses.every((l) => l.offerId === null)).toBe(true);
  });

  it('excludes stale data from recommendations and is order-independent', () => {
    const stale = withProv(o2g, { verifiedAt: days(45) });
    const r = rank([stale, o500, o1g], { 'omni-fiber': 'address_confirmed' });
    expect(r.recommendable.map((c) => c.offerId)).not.toContain('omni-monroe-2g');
    expect(r.needsVerification.map((c) => c.offerId)).toEqual(['omni-monroe-2g']);
    const a = rank([o2g, o1g, o500], { 'omni-fiber': 'address_confirmed' }).lenses;
    const b = rank([o500, o2g, o1g], { 'omni-fiber': 'address_confirmed' }).lenses;
    expect(a).toEqual(b);
  });

  it('never recommends a plan that costs more just because it is faster under "best value"', () => {
    const pricey: Offer = { ...o2g, id: 'pricey-10g', attributes: { downloadMbps: 10000, technology: 'fiber' }, pricing: { baseMonthly: 30000 } };
    const r = rank([o1g, pricey], { 'omni-fiber': 'address_confirmed' });
    const lens = Object.fromEntries(r.lenses.map((l) => [l.lens, l.offerId]));
    expect(lens.best_value).toBe('omni-monroe-1g');
    expect(lens.highest_performance).toBe('pricey-10g'); // shown under its own, clearly-labelled lens
  });
});

describe('adapters', () => {
  const ctx = { zip: '48161', marketId: 'monroe', now: NOW };
  it('isolates failing, slow and invalid sources', async () => {
    const failing: ProviderAdapter = { id: 'broken', providerIds: ['x'], capabilities: { offers: true, addressServiceability: false }, fetchOffers: async () => { throw new Error('HTTP 503'); } };
    const slow: ProviderAdapter = { id: 'slow', providerIds: ['y'], capabilities: { offers: true, addressServiceability: false }, fetchOffers: () => new Promise((r) => setTimeout(() => r([]), 500)) };
    const bad = new StaticOfferAdapter('bad-feed', [{ ...o1g, id: 'BAD ID!' } as Offer]);
    const r = await collectOffers([new StaticOfferAdapter('manual', MONROE_OFFERS), failing, slow, bad], ctx, 50);
    expect(r.offers.map((o) => o.id)).toEqual(['omni-monroe-500', 'omni-monroe-1g', 'omni-monroe-2g']);
    expect(r.failures.map((f) => f.adapterId)).toEqual(['broken', 'slow', 'bad-feed']);
    expect(r.failures[1].error).toMatch(/timed out/);
  });
  it('filters static offers by area', async () => {
    expect((await new StaticOfferAdapter('manual', MONROE_OFFERS).fetchOffers({ ...ctx, zip: '43604', marketId: 'toledo' }))).toEqual([]);
  });
});
