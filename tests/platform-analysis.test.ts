import { describe, expect, it } from 'vitest';
import { assessmentSchema, type AssessmentInput } from '../shared/platform/assessment';
import { buildAnalysis, currentStreamsFor } from '../shared/platform/analysis';
import { estimateSolar, SAMPLE_SOLAR_PROGRAMS, SOLAR_PROGRAMS, solarOffer } from '../shared/platform/solar';
import { projectStream, ASSUMPTIONS_V1 } from '../shared/finance/engine';
import { BENCHMARKS, benchmarkMonthly, benchmarkOffer, quickPreview } from '../shared/platform/benchmarks';
import { publicStatus } from '../shared/offers/model';
import { offersFromMarket, parseMonthlyPrice, parseSpeedMbps, pricingHealth } from '../shared/platform/market-offers';

const AT = '2026-11-16T12:00:00.000Z';
const parse = (a: AssessmentInput) => assessmentSchema.parse(a);
const internet = (over: Partial<NonNullable<AssessmentInput['internet']>> = {}) => ({ provider: 'Comcast', monthlyCents: 9000, equipmentFeeCents: 1500, ...over });

describe('assessment schema', () => {
  it('requires answers for every selected category and nothing for unselected ones', () => {
    expect(assessmentSchema.safeParse({ zip: '48161', categories: ['internet'] }).success).toBe(false);
    expect(assessmentSchema.safeParse({ zip: '48161', categories: ['internet'], internet: internet(), mobile: { carrier: 'X', monthlyCents: 1, lines: 1 } }).success).toBe(false);
    expect(assessmentSchema.safeParse({ zip: '4816', categories: ['internet'], internet: internet() }).success).toBe(false);
    expect(assessmentSchema.safeParse({ zip: '48161', categories: [], internet: internet() }).success).toBe(false);
    expect(assessmentSchema.safeParse({ zip: '48161', categories: ['internet'], internet: internet({ monthlyCents: 49.99 as never }) }).success).toBe(false);
    expect(assessmentSchema.safeParse({ zip: '48161', categories: ['internet'], internet: internet() }).success).toBe(true);
  });
});

describe('real offers (Monroe pilot, no samples)', () => {
  const a = parse({ zip: '48161', categories: ['internet'], internet: internet() });
  const r = buildAnalysis(a, { includeSamples: false, computedAt: AT });

  it('shows real plans as "pending address check", never as confirmed recommendations', () => {
    const net = r.categories[0];
    expect(net.options.map((o) => [o.planName, o.kind])).toEqual([
      ['1 Gig', 'pending_address'],
      ['500 Mbps', 'pending_address'],
      ['2 Gig', 'pending_address'],
    ]);
    expect(net.lensKind).toBe('pending_address');
    expect(net.selected).toBe('omni-monroe-1g');
    expect(r.projectionBasis).toBe('pending_address');
  });

  it('computes the household projection with the engine (integer cents)', () => {
    expect(r.status).toBe('complete');
    expect(r.household!.currentMonthly).toBe(10500);
    const flat = r.household!.scenarios[0];
    expect(flat.months[0].savings).toBe(10500 - 5000);
    expect(flat.atHorizons.map((h) => h.months)).toEqual([12, 60, 120]);
    expect(r.opportunities).toEqual([{ category: 'internet', label: 'Home internet', monthlySavings: 5500, kind: 'pending_address' }]);
  });

  it('is deterministic and reproducible from the stored inputs', () => {
    const again = buildAnalysis(a, { includeSamples: false, computedAt: AT });
    expect(JSON.stringify(again)).toBe(JSON.stringify(r));
  });

  it('honours a "keep current" selection', () => {
    const kept = buildAnalysis(a, { includeSamples: false, computedAt: AT, selections: { internet: 'keep' } });
    expect(kept.household!.scenarios[0].totals.savings).toBe(0);
    expect(kept.projectionBasis).toBe('current_only');
    expect(kept.opportunities).toEqual([]);
  });

  it('downgrades stale offers automatically (data verified > 30 days before the analysis)', () => {
    const later = buildAnalysis(a, { includeSamples: false, computedAt: '2027-01-30T00:00:00.000Z' });
    // The stale plans are gone; the household is compared with the benchmark instead.
    expect(later.categories[0].options.map((o) => o.kind)).toEqual(['benchmark']);
    expect(later.categories[0].selected).toBe('benchmark-internet');
  });
});

describe('outside covered areas', () => {
  it('without samples: no alternatives, an honest note, current spend still analysed', () => {
    const r = buildAnalysis(parse({ zip: '10001', categories: ['internet'], internet: internet() }), { includeSamples: false, computedAt: AT });
    // No real plan on file → an illustrative comparison with the $55 benchmark, labelled as such.
    expect(r.categories[0].options.map((o) => [o.kind, o.monthlyPrice, o.estimate])).toEqual([['benchmark', 5500, true]]);
    expect(r.categories[0].selected).toBe('benchmark-internet');
    expect(r.opportunities).toEqual([{ category: 'internet', label: 'Home internet', monthlySavings: 10500 - 5500, kind: 'benchmark' }]);
    expect(r.notes.join(' ')).toMatch(/illustrative preview against Tucker’s comparison benchmarks.*not offers or guarantees/);
    expect(r.status).toBe('complete');
    expect(r.projectionBasis).toBe('benchmark');
  });

  it('with samples: every option is labelled sample and the projection basis says so', () => {
    const r = buildAnalysis(
      parse({
        zip: '10001',
        categories: ['internet', 'mobile', 'tv'],
        internet: internet(),
        mobile: { carrier: 'BigCarrier', monthlyCents: 18000, lines: 3, dataNeed: 'unlimited', deviceFinancingCents: 4000 },
        tv: { provider: 'Cable Co', monthlyCents: 12000, equipmentFeeCents: 1000, otherStreamingCents: 2500 },
      }),
      { includeSamples: true, computedAt: AT },
    );
    for (const c of r.categories) for (const o of c.options) expect([o.kind, o.candidate.status]).toEqual(['sample', 'sample']);
    expect(r.projectionBasis).toBe('sample');
    // Unlimited-data household is never shown the 15 GB plan.
    expect(r.categories.find((c) => c.category === 'mobile')!.options.map((o) => o.offerId)).toEqual(['sample-unlimited']);
    expect(r.categories.find((c) => c.category === 'mobile')!.notes.join(' ')).toMatch(/Phone payments/);
    // TV keeps other streaming subscriptions in the household total.
    expect(r.household!.byCategory.find((c) => c.category === 'tv')!.monthly).toBe(12000 + 1000 + 2500);
    expect(r.opportunities.length).toBeGreaterThan(0);
  });

  it('keeps the current service when every alternative costs more', () => {
    const r = buildAnalysis(parse({ zip: '10001', categories: ['internet'], internet: internet({ monthlyCents: 3000, equipmentFeeCents: null }) }), { includeSamples: true, computedAt: AT });
    expect(r.categories[0].options.length).toBeGreaterThan(0);
    expect(r.categories[0].selected).toBe('keep');
    expect(r.household!.scenarios[0].totals.savings).toBe(0);
  });
});

describe('incomplete inputs, energy and solar', () => {
  it('returns incomplete (no guessing) when a bill amount is unknown', () => {
    const r = buildAnalysis(parse({ zip: '48161', categories: ['internet', 'mobile'], internet: internet({ monthlyCents: null }), mobile: { carrier: 'X', monthlyCents: 9000, lines: 2 } }), {
      includeSamples: true,
      computedAt: AT,
    });
    expect(r.status).toBe('incomplete');
    expect(r.missing).toEqual(['Your monthly home internet bill']);
    expect(r.household).toBeNull();
  });

  const elec = (over: Record<string, unknown> = {}) => parse({ zip: '48161', categories: ['electricity'], electricity: { utility: 'DTE', monthlyCents: 16000, homeownership: 'own', roofSun: 'mostly_sunny', ...over } });

  it('compares electricity with a labelled sample solar estimate on staging', () => {
    const r = buildAnalysis(elec(), { includeSamples: true, computedAt: AT });
    const e = r.categories[0];
    expect(e.solar).toBe('estimated');
    expect(e.options).toHaveLength(1);
    const o = e.options[0];
    expect(o.kind).toBe('sample');
    expect(o.estimate).toBe(true);
    // $160 bill, $9 fixed charge, 19¢/kWh → 795 kWh; 90% covered = 716 kWh × 12.5¢ = $89.50; remaining utility $9 + 10% of $151 = $24.10.
    expect(o.monthlyPrice).toBe(2410 + 8950);
    expect(o.assumptions.join(' ')).toMatch(/90% of your usage .*716 of 795 kWh.*estimated from your bill/);
    expect(o.assumptions.join(' ')).toMatch(/No tax credits or incentives/);
    expect(e.selected).toBe('sample-solar-ppa');
    expect(r.projectionBasis).toBe('sample');
    expect(r.notes.join(' ')).toMatch(/estimates, not quotes/);
    expect(r.household!.scenarios[0].months[0].savings).toBe(16000 - 11360);
  });

  it('without real program terms, compares electricity only with the labelled $200 solar benchmark', () => {
    expect(SOLAR_PROGRAMS).toEqual([]);
    // $160 bill: the benchmark costs more, so it is shown but not selected and no saving is claimed.
    const low = buildAnalysis(elec(), { includeSamples: false, computedAt: AT });
    expect(low.categories[0].options.map((o) => [o.kind, o.monthlyPrice, o.estimate])).toEqual([['benchmark', 20000, true]]);
    expect(low.categories[0].selected).toBe('keep');
    expect(low.opportunities).toEqual([]);
    // $260 bill: an illustrative $60 a month, with the basis spelled out.
    const high = buildAnalysis(elec({ monthlyCents: 26000 }), { includeSamples: false, computedAt: AT });
    const e = high.categories[0];
    expect(e.selected).toBe('benchmark-electricity');
    expect(e.options[0].candidate.steadyMonthlySavings).toBe(6000);
    expect(e.options[0].assumptions.join(' ')).toMatch(/Illustrative: compares your bill with \$200 a month.*site assessment.*not offers or guarantees/);
    expect(high.projectionBasis).toBe('benchmark');
    // Renters and shaded roofs still get an explanation, never a number.
    expect(buildAnalysis(elec({ homeownership: 'rent', monthlyCents: 26000 }), { includeSamples: false, computedAt: AT }).categories[0].options).toEqual([]);
  });

  it('explains when solar does not apply instead of estimating', () => {
    expect(buildAnalysis(elec({ homeownership: 'rent' }), { includeSamples: true, computedAt: AT }).categories[0]).toMatchObject({ solar: 'not_suitable', options: [] });
    expect(buildAnalysis(elec({ roofSun: 'heavy_shade' }), { includeSamples: true, computedAt: AT }).categories[0]).toMatchObject({ solar: 'not_suitable', options: [] });
    expect(buildAnalysis(elec({ homeownership: 'unknown' }), { includeSamples: true, computedAt: AT }).categories[0]).toMatchObject({ solar: 'needs_info', options: [] });
    const unknownBill = buildAnalysis(elec({ monthlyCents: null }), { includeSamples: true, computedAt: AT });
    expect(unknownBill.status).toBe('incomplete');
    expect(unknownBill.categories[0].solar).toBe('needs_info');
  });

  it('uses the household’s kWh when given, and shows when solar costs more', () => {
    const p = SAMPLE_SOLAR_PROGRAMS[0];
    const known = estimateSolar(p, { billCents: 16000, monthlyKwh: 1000 });
    expect(known).toMatchObject({ monthlyKwh: 1000, kwhEstimated: false, coveredKwh: 900, solarPayment: 11250 });
    // A small bill with high usage: solar is more expensive, and the analysis says so instead of selecting it.
    const r = buildAnalysis(elec({ monthlyCents: 4000, monthlyKwh: 1200 }), { includeSamples: true, computedAt: AT });
    const e = r.categories[0];
    expect(e.options[0].candidate.savingsTotal).toBeLessThan(0);
    expect(e.selected).toBe('keep');
  });

  it('applies the contract escalator to the solar payment yearly, independent of the scenario', () => {
    const { offer } = solarOffer(SAMPLE_SOLAR_PROGRAMS[0], { billCents: 16000, monthlyKwh: null });
    const flat = ASSUMPTIONS_V1.escalationScenarios[0];
    const proj = projectStream({ ...offer.pricing, id: 's', label: 's', category: 'electricity' }, 25, flat);
    expect(proj.months[0].total).toBe(2410 + 8950);
    expect(proj.months[11].total).toBe(2410 + 8950);
    expect(proj.months[12].total).toBe(2410 + 8950 + 260); // 8950 × 2.9% = 259.55 → 260
    expect(proj.months[24].total).toBe(2410 + 9210 + 267); // compounding on 9210
  });

  it('folds the retired "solar" category into electricity for old assessments', () => {
    const legacy = assessmentSchema.parse({ zip: '48161', categories: ['electricity', 'solar'], electricity: { utility: 'DTE', monthlyCents: 16000 }, solar: { homeownership: 'own', roofSun: 'some_shade' } });
    expect(legacy.categories).toEqual(['electricity']);
    expect(legacy.electricity).toMatchObject({ homeownership: 'own', roofSun: 'some_shade' });
    expect('solar' in legacy).toBe(false);
    // Solar-only legacy assessments become empty and are rejected rather than guessed.
    expect(assessmentSchema.safeParse({ zip: '48161', categories: ['solar'], solar: { homeownership: 'own' } }).success).toBe(false);
  });

  it('models an expiring promotion when the regular price is known', () => {
    const a = parse({ zip: '48161', categories: ['internet'], internet: internet({ monthlyCents: 5000, promoEnds: 'within_12', promoRegularCents: 8500, equipmentFeeCents: null }) });
    const s = currentStreamsFor(a, 'internet').streams[0];
    expect(s.promotion).toEqual({ monthlyRate: 5000, months: 6 });
    expect(s.baseMonthly).toBe(8500);
    const r = buildAnalysis(a, { includeSamples: false, computedAt: AT });
    const m = r.household!.scenarios[0].months;
    expect(m[5].current).toBe(5000);
    expect(m[6].current).toBe(8500);
  });
});

describe('offers from admin-managed locations', () => {
  const toledo = {
    slug: 'toledo',
    name: 'Toledo',
    provider: 'Omni Fiber',
    plansVerifiedOn: 'November 15, 2026',
    broadbandLabelsUrl: 'https://www.omnifiber.com/broadbandlabels/',
    plans: [
      { name: '500 Mbps', speed: 'Fiber internet', price: '$65/mo', highlights: ['Free installation'] },
      { name: '1 Gig', speed: 'Fiber internet', price: '$85/mo', highlights: [] },
      { name: 'Custom', speed: '', price: 'Call for pricing', highlights: [] },
    ],
  };
  const a = parse({ zip: '43604', categories: ['internet', 'mobile'], internet: internet({ monthlyCents: 9500 }), mobile: { carrier: 'X', monthlyCents: 12000, lines: 3 } });

  it('reads prices and speeds exactly, and skips anything it cannot read', () => {
    expect(parseMonthlyPrice('$65/mo')).toBe(6500);
    expect(parseMonthlyPrice('$49.99')).toBe(4999);
    expect(parseMonthlyPrice('$1,050 / month')).toBe(105000);
    for (const bad of ['Call for pricing', 'from $50', '$50-70', '$0', '50', '$49.9']) expect(parseMonthlyPrice(bad)).toBeNull();
    expect([parseSpeedMbps('500 Mbps'), parseSpeedMbps('1 Gig'), parseSpeedMbps('2.5 Gbps'), parseSpeedMbps('Basic')]).toEqual([500, 1000, 2500, null]);
    const offers = offersFromMarket(toledo, ['43604']);
    expect(offers.map((o) => [o.id, o.pricing.baseMonthly, o.attributes?.downloadMbps])).toEqual([
      ['toledo-500-mbps', 6500, 500],
      ['toledo-1-gig', 8500, 1000],
    ]);
  });

  it('gives any configured location real comparisons, and unreviewed categories a bill review', () => {
    const r = buildAnalysis(a, { includeSamples: false, computedAt: AT, catalog: { internet: offersFromMarket(toledo, ['43604']) } });
    const [net, mobile] = r.categories;
    expect(net.options.map((o) => [o.planName, o.kind, o.monthlyPrice])).toEqual([
      ['500 Mbps', 'pending_address', 6500],
      ['1 Gig', 'pending_address', 8500],
    ]);
    expect(net.selected).toBe('toledo-500-mbps');
    expect(net.options[0].candidate.steadyMonthlySavings).toBe(9500 + 1500 - 6500);
    // Mobile has no real plan: benchmark of $45 × 3 lines = $135, which is more than they pay, so nothing is pre-selected.
    expect(mobile.options.map((o) => [o.kind, o.monthlyPrice])).toEqual([['benchmark', 13500]]);
    expect(mobile.selected).toBe('keep');
    expect(net.options.some((o) => o.kind === 'benchmark')).toBe(false); // a real plan always replaces the benchmark
    expect(mobile.insights).toEqual(['That’s $40.00 per line for 3 lines.']);
    expect(net.insights).toEqual(['Equipment rental costs you $180 a year.']);
    expect(r.catalog?.internet).toHaveLength(2); // stored with the snapshot for later recalculation
    // The customer can decline the review or ask for one even when options exist.
    const custom = buildAnalysis(a, { includeSamples: false, computedAt: AT, catalog: r.catalog, selections: { internet: 'review', mobile: 'keep' } });
    expect(custom.categories.map((c) => c.selected)).toEqual(['review', 'keep']);
    expect(custom.projectionBasis).toBe('current_only');
  });

  it('hides prices with no readable verification date, and never falls back to built-in data', () => {
    const unverified = offersFromMarket({ ...toledo, plansVerifiedOn: 'last week' }, ['43604']);
    expect(buildAnalysis(a, { includeSamples: false, computedAt: AT, catalog: { internet: unverified } }).categories[0].options.map((o) => o.kind)).toEqual(['benchmark']);
    // Monroe ZIP with an empty catalog: the pilot data must not leak in.
    const monroe = parse({ zip: '48161', categories: ['internet'], internet: internet() });
    const r = buildAnalysis(monroe, { includeSamples: false, computedAt: AT, catalog: { internet: [], internetNote: 'Coming soon note' } });
    expect(r.categories[0].options.map((o) => o.offerId)).toEqual(['benchmark-internet']);
    expect(r.categories[0].notes).toContain('Coming soon note');
    expect(r.categories[0].notes.join(' ')).not.toMatch(/don’t have verified prices/);
  });
});

describe('price freshness warnings for the team', () => {
  const m = (plansVerifiedOn: string, price = '$50/mo') => ({ plansVerifiedOn, plans: [{ name: '1 Gig', speed: '', price, highlights: [] }] });
  const at = (iso: string) => new Date(iso);
  it('warns a week before prices drop out of results, and when they already have', () => {
    expect(pricingHealth(m('November 15, 2026'), at('2026-11-16T12:00:00Z'))).toMatchObject({ state: 'ok', daysLeft: 29 });
    expect(pricingHealth(m('November 15, 2026'), at('2026-12-09T12:00:00Z')).state).toBe('expiring');
    expect(pricingHealth(m('November 15, 2026'), at('2026-12-20T12:00:00Z')).state).toBe('hidden');
    expect(pricingHealth(m(''), at('2026-11-16T12:00:00Z')).state).toBe('hidden');
    expect(pricingHealth(m('November 15, 2026', 'Call us'), at('2026-11-16T12:00:00Z')).state).toBe('none');
  });
});

describe('home security and homeowner-only pricing', () => {
  const base = { zip: '60601', categories: ['electricity', 'security'] as const };
  const run = (electricity: object, security: object) =>
    buildAnalysis(parse({ ...base, categories: [...base.categories], electricity: { monthlyCents: 26000, ...electricity }, security: { monthlyCents: 9500, ...security } }), {
      includeSamples: false,
      computedAt: AT,
      catalog: { internet: [] },
    });
  const opts = (r: ReturnType<typeof run>, c: string) => r.categories.find((x) => x.category === c)!.options.map((o) => [o.offerId, o.monthlyPrice]);

  it('shows no solar or security price until a homeowner asks', () => {
    const owner = run({ homeownership: 'own', showPricing: false }, { homeownership: 'own', showPricing: false });
    expect(opts(owner, 'electricity')).toEqual([]);
    expect(opts(owner, 'security')).toEqual([]);
    expect(owner.categories.find((c) => c.category === 'security')!.notes.join(' ')).toMatch(/shown when you ask to see extra services/);
    const renter = run({ homeownership: 'rent', showPricing: true }, { homeownership: 'rent', showPricing: true });
    expect(opts(renter, 'security')).toEqual([]);
    expect(opts(renter, 'electricity')).toEqual([]);
  });

  it('compares a homeowner who asked with the $80 security and $200 solar benchmarks', () => {
    const asked = run({ homeownership: 'own', showPricing: true }, { homeownership: 'own', showPricing: true });
    expect(opts(asked, 'security')).toEqual([['benchmark-security', 8000]]);
    expect(opts(asked, 'electricity')).toEqual([['benchmark-electricity', 20000]]);
    expect(asked.opportunities.map((o) => [o.category, o.monthlySavings])).toEqual([
      ['electricity', 6000],
      ['security', 1500],
    ]);
  });

  it('keeps showing solar on results saved before owners had to ask', () => {
    const legacy = buildAnalysis(parse({ zip: '60601', categories: ['electricity'], electricity: { monthlyCents: 26000, homeownership: 'own' } }), { includeSamples: false, computedAt: AT, catalog: { internet: [] } });
    expect(opts(legacy, 'electricity')).toEqual([['benchmark-electricity', 20000]]);
  });

  it('applies the security benchmark from the published set, and $80 for sets saved before it existed', () => {
    expect(quickPreview({ security: 9000, ownsHome: true, showExtras: true }).rows).toEqual([{ category: 'security', current: 9000, benchmark: 8000, difference: 1000, savings: 1000 }]);
    expect(quickPreview({ security: 9000, ownsHome: true, showExtras: false }).rows).toEqual([]);
    const old = { version: 'old', internetMonthly: 5500, mobilePerLine: 4500, tvMonthly: 7500, electricityWithSolarMonthly: 20000 };
    expect(quickPreview({ security: 9000, ownsHome: true, showExtras: true }, old).rows[0].benchmark).toBe(8000);
  });
});

describe('comparison benchmarks', () => {
  it('holds the owner-set values exactly, in cents', () => {
    expect(BENCHMARKS).toEqual({ version: '2026-11-17.1', internetMonthly: 5500, mobilePerLine: 4500, tvMonthly: 7500, electricityWithSolarMonthly: 20000, securityMonthly: 8000 });
    expect([benchmarkMonthly('mobile', { mobileLines: 1 }), benchmarkMonthly('mobile', { mobileLines: 4 }), benchmarkMonthly('mobile', { mobileLines: 99 }), benchmarkMonthly('mobile', {})]).toEqual([4500, 18000, 45000, 4500]);
  });

  it('gives the home-page preview the same differences as the full analysis', () => {
    const quick = quickPreview({ internet: 9500, mobile: 19000, mobileLines: 3, tv: 12000, electricity: 26000, ownsHome: true, showExtras: true });
    expect(quick.rows.map((r) => [r.category, r.benchmark, r.savings])).toEqual([
      ['internet', 5500, 4000],
      ['mobile', 13500, 5500],
      ['tv', 7500, 4500],
      ['electricity', 20000, 6000],
    ]);
    expect([quick.currentMonthly, quick.monthlySavings, quick.annualSavings]).toEqual([66500, 20000, 240000]);
    const full = buildAnalysis(
      parse({
        zip: '60601',
        categories: ['internet', 'mobile', 'tv', 'electricity'],
        internet: { monthlyCents: 9500 },
        mobile: { monthlyCents: 19000, lines: 3 },
        tv: { monthlyCents: 12000 },
        electricity: { monthlyCents: 26000, homeownership: 'own' },
      }),
      { includeSamples: false, computedAt: AT, catalog: { internet: [] } },
    );
    expect(full.opportunities.reduce((s, o) => s + o.monthlySavings, 0)).toBe(quick.monthlySavings);
    expect(full.opportunities.every((o) => o.kind === 'benchmark')).toBe(true);
  });

  it('never shows savings for a bill at or below the benchmark, skips empty bills, and compares solar only for owners', () => {
    const q = quickPreview({ internet: 4000, mobile: null, tv: 0, electricity: 30000, ownsHome: false });
    expect(q.rows).toEqual([
      // The benchmark is higher than this bill: shown as a possible extra cost (negative difference), never hidden.
      { category: 'internet', current: 4000, benchmark: 5500, difference: -1500, savings: 0 },
      { category: 'electricity', current: 30000, benchmark: null, difference: null, savings: 0, note: 'Solar is compared for homeowners.' },
    ]);
    expect([q.monthlySavings, q.monthlyHigher, q.benchmarksVersion]).toEqual([0, 1500, '2026-11-17.1']);
    // A published set changes the preview; the default values are untouched.
    const set = { version: '2027-01-01.1', internetMonthly: 3000, mobilePerLine: 4000, tvMonthly: 7000, electricityWithSolarMonthly: 18000 };
    expect(quickPreview({ internet: 4000, mobile: 10000, mobileLines: 2 }, set)).toMatchObject({ monthlySavings: 3000, benchmarkMonthly: 11000, benchmarksVersion: '2027-01-01.1' });
    const withSet = buildAnalysis(parse({ zip: '60601', categories: ['internet'], internet: { monthlyCents: 4000 } }), { includeSamples: false, computedAt: AT, catalog: { internet: [] }, benchmarks: set });
    expect(withSet.benchmarks).toEqual(set);
    expect(withSet.opportunities[0]).toMatchObject({ kind: 'benchmark', monthlySavings: 1000 });
    expect(q.monthlySavings).toBe(0);
    expect(quickPreview({}).rows).toEqual([]);
  });

  it('can only ever be labelled a benchmark', () => {
    const offer = benchmarkOffer('tv');
    expect(publicStatus(offer, new Date(AT))).toEqual({ status: 'benchmark', reasons: ['Comparison benchmark, not an offer'] });
    expect(publicStatus({ ...offer, provenance: { ...offer.provenance, review: 'verified' } }, new Date('2030-01-01'))).toMatchObject({ status: 'benchmark' });
  });
});
