import { describe, expect, it } from 'vitest';
import { assessmentSchema, type AssessmentInput } from '../shared/platform/assessment';
import { buildAnalysis, currentStreamsFor } from '../shared/platform/analysis';
import { estimateSolar, SAMPLE_SOLAR_PROGRAMS, SOLAR_PROGRAMS, solarOffer } from '../shared/platform/solar';
import { projectStream, ASSUMPTIONS_V1 } from '../shared/finance/engine';

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
    expect(later.categories[0].options).toEqual([]);
    expect(later.categories[0].selected).toBe('keep');
  });
});

describe('outside covered areas', () => {
  it('without samples: no alternatives, an honest note, current spend still analysed', () => {
    const r = buildAnalysis(parse({ zip: '10001', categories: ['internet'], internet: internet() }), { includeSamples: false, computedAt: AT });
    expect(r.categories[0].options).toEqual([]);
    expect(r.categories[0].notes.join(' ')).toMatch(/don’t have verified alternatives/);
    expect(r.status).toBe('complete');
    expect(r.projectionBasis).toBe('current_only');
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

  it('never shows a solar number in production without real program terms', () => {
    expect(SOLAR_PROGRAMS).toEqual([]);
    const r = buildAnalysis(elec(), { includeSamples: false, computedAt: AT });
    const e = r.categories[0];
    expect(e.options).toEqual([]);
    expect(e.solar).toBe('advisor');
    expect(e.selected).toBe('keep');
    expect(r.opportunities).toEqual([]);
    expect(e.notes.join(' ')).toMatch(/advisor can prepare a free site-specific estimate/);
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
