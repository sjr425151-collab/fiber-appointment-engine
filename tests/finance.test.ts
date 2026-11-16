import { describe, expect, it } from 'vitest';
import { applyBps, divRound, formatCents, MoneyError, parseDollars, prorate, assertCents } from '../shared/finance/money';
import {
  analyzeHousehold,
  ASSUMPTIONS_V1,
  compareScenarios,
  earlyTerminationFee,
  escalate,
  escalationSteps,
  evaluateDiscounts,
  projectStream,
  type CostStream,
  type HouseholdService,
} from '../shared/finance/engine';

const FLAT = ASSUMPTIONS_V1.escalationScenarios[0];
const MODERATE = ASSUMPTIONS_V1.escalationScenarios[1]; // 300 bp
const HIGH = ASSUMPTIONS_V1.escalationScenarios[2]; // 600 bp

const internet = (over: Partial<CostStream> = {}): CostStream => ({ id: 'net', label: 'Internet', category: 'internet', baseMonthly: 7000, ...over });

describe('money primitives', () => {
  it('rounds half away from zero with exact integer maths', () => {
    expect(divRound(5, 2)).toBe(3);
    expect(divRound(-5, 2)).toBe(-3);
    expect(divRound(7, 3)).toBe(2);
    expect(divRound(8, 3)).toBe(3);
    expect(divRound(10, -4)).toBe(-3);
    expect(divRound(9_007_199_254_740, 7)).toBe(1_286_742_750_677);
    expect(() => divRound(1, 0)).toThrow(MoneyError);
  });
  it('applies basis points and pro-rates to the cent', () => {
    expect(applyBps(10000, 300)).toBe(300);
    expect(applyBps(3333, 300)).toBe(100); // 99.99 → 100
    expect(prorate(9000, 12, 30)).toBe(3600);
    expect(prorate(1000, 1, 3)).toBe(333);
    expect(() => prorate(1000, 31, 30)).toThrow(MoneyError);
  });
  it('parses user-entered dollars without floating point', () => {
    expect(parseDollars('$1,234.5')).toBe(123450);
    expect(parseDollars('49.99')).toBe(4999);
    expect(parseDollars('0.1')).toBe(10);
    expect(parseDollars('  ')).toBeNull();
    expect(parseDollars('-5')).toBe(-500);
    expect(() => parseDollars('12.345')).toThrow(MoneyError);
    expect(() => parseDollars('abc')).toThrow(MoneyError);
  });
  it('rejects non-integer cents and formats for display', () => {
    expect(() => assertCents(1.5)).toThrow(MoneyError);
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(formatCents(-500)).toBe('−$5.00');
    expect(formatCents(5000, { cents: false })).toBe('$50');
  });
});

describe('escalation', () => {
  it('steps on each anniversary, skipping anniversaries inside a price lock', () => {
    expect([0, 11, 12, 23, 24, 36].map((m) => escalationSteps(m, 0))).toEqual([0, 0, 1, 1, 2, 3]);
    expect([0, 12, 23, 24, 35, 36].map((m) => escalationSteps(m, 24))).toEqual([0, 0, 0, 1, 1, 2]);
  });
  it('compounds and rounds each step to the cent', () => {
    expect(escalate(10000, 300, 2)).toBe(10609);
    expect(escalate(10000, 600, 2)).toBe(11236);
    expect(escalate(9999, 300, 1)).toBe(10299); // 9999 + 299.97 → 10299
  });
});

describe('single-service projections', () => {
  it('zero inflation: flat monthly cost', () => {
    const p = projectStream(internet(), 12, FLAT);
    expect(p.months.every((m) => m.total === 7000)).toBe(true);
    expect(p.total).toBe(84000);
  });

  it('multiple inflation scenarios (hypothetical)', () => {
    const base = internet({ baseMonthly: 10000 });
    expect(projectStream(base, 36, FLAT).total).toBe(360000);
    expect(projectStream(base, 36, MODERATE).total).toBe(12 * (10000 + 10300 + 10609));
    expect(projectStream(base, 36, HIGH).total).toBe(12 * (10000 + 10600 + 11236));
  });

  it('price lock delays increases', () => {
    const p = projectStream(internet({ baseMonthly: 10000, priceLockMonths: 24 }), 36, MODERATE);
    expect(p.months[23].total).toBe(10000);
    expect(p.months[24].total).toBe(10300);
  });

  it('promotional rate for N months, then the (scenario-adjusted) standard rate', () => {
    const p = projectStream(internet({ baseMonthly: 8000, promotion: { monthlyRate: 5000, months: 12 } }), 24, MODERATE);
    expect(p.months[11].total).toBe(5000);
    expect(p.months[12].total).toBe(8240);
    expect(p.total).toBe(12 * 5000 + 12 * 8240);
  });

  it('expiring discounts apply only when eligible and only for their term', () => {
    const s = internet({ discounts: [{ label: 'Autopay', monthlyOff: 1000, months: 6, requires: ['autopay'] }] });
    const eligible = projectStream(s, 12, FLAT, new Set(['autopay']));
    expect(eligible.months[5].total).toBe(6000);
    expect(eligible.months[6].total).toBe(7000);
    expect(eligible.total).toBe(6 * 6000 + 6 * 7000);
    const ineligible = projectStream(s, 12, FLAT);
    expect(ineligible.total).toBe(84000);
    expect(ineligible.appliedDiscounts).toEqual([{ label: 'Autopay', monthlyOff: 1000, applied: false, missing: ['autopay'] }]);
  });

  it('a discount can never make a bill negative', () => {
    const p = projectStream(internet({ baseMonthly: 500, discounts: [{ label: 'Big', monthlyOff: 2000 }] }), 1, FLAT);
    expect(p.months[0]).toMatchObject({ recurring: 500, discounts: -500, total: 0 });
  });

  it('equipment rental, equipment purchase and installation', () => {
    const p = projectStream(
      internet({
        recurring: [{ label: 'Router rental', monthly: 1500 }],
        oneTime: [
          { kind: 'equipment_purchase', label: 'Mesh kit', amount: 20000, month: 0 },
          { kind: 'installation', label: 'Install', amount: 9900, month: 0 },
        ],
      }),
      12,
      FLAT,
    );
    expect(p.months[0].total).toBe(7000 + 1500 + 20000 + 9900);
    expect(p.months[1].total).toBe(8500);
    expect(p.total).toBe(12 * 8500 + 29900);
  });

  it('one-time credits reduce the month they land in', () => {
    const p = projectStream(internet({ oneTime: [{ kind: 'credit', label: 'Switch credit', amount: -10000, month: 1 }] }), 3, FLAT);
    expect(p.months.map((m) => m.total)).toEqual([7000, -3000, 7000]);
  });

  it('pro-rates a partial first billing period and applies estimated taxes', () => {
    const p = projectStream(internet({ baseMonthly: 9000, taxBps: 800, firstBillProration: { days: 12, daysInPeriod: 30 } }), 2, FLAT);
    expect(p.months[0]).toMatchObject({ recurring: 3600, tax: 288, total: 3888 });
    expect(p.months[1]).toMatchObject({ recurring: 9000, tax: 720, total: 9720 });
  });
});

describe('cancellation fees', () => {
  it('computes flat and per-month-remaining ETFs with caps', () => {
    expect(earlyTerminationFee(undefined)).toBe(0);
    expect(earlyTerminationFee({ kind: 'flat', amount: 15000 })).toBe(15000);
    expect(earlyTerminationFee({ kind: 'per_month_remaining', perMonth: 1000, monthsRemaining: 10 })).toBe(10000);
    expect(earlyTerminationFee({ kind: 'per_month_remaining', perMonth: 1000, monthsRemaining: 10, cap: 8000 })).toBe(8000);
  });

  it('includes the ETF as a switching cost and finds the break-even month', () => {
    const r = analyzeHousehold([
      {
        current: { ...internet({ baseMonthly: 8000 }), earlyTermination: { kind: 'per_month_remaining', perMonth: 1000, monthsRemaining: 10, cap: 8000 } },
        action: { type: 'replace', with: { id: 'fiber', label: 'Fiber 1 Gig', category: 'internet', baseMonthly: 5000, quality: 'verified' } },
      },
    ]);
    if (r.status !== 'complete') throw new Error('expected complete');
    const flat = r.scenarios[0];
    expect(r.switchingCosts).toEqual([{ kind: 'early_termination', label: 'Early termination: Internet', amount: 8000, month: 0 }]);
    expect(flat.upfrontSwitchingCost).toBe(8000);
    expect(flat.months.slice(0, 3).map((m) => m.cumulativeSavings)).toEqual([-5000, -2000, 1000]);
    expect(flat.breakEvenMonths).toBe(3);
    expect(flat.atHorizons.map((h) => [h.months, h.savings])).toEqual([
      [12, 12 * 3000 - 8000],
      [60, 60 * 3000 - 8000],
      [120, 120 * 3000 - 8000],
    ]);
  });
});

describe('comparisons', () => {
  it('reports negative savings honestly when the alternative costs more', () => {
    const c = compareScenarios({
      current: [internet({ baseMonthly: 5000 })],
      proposed: [internet({ id: 'alt', baseMonthly: 6500, oneTime: [{ kind: 'installation', label: 'Install', amount: 5000 }] })],
      horizonMonths: 24,
      scenario: FLAT,
    });
    expect(c.totals.savings).toBe(-(24 * 1500 + 5000));
    expect(c.breakEvenMonths).toBeNull();
    expect(c.steadyStateMonthlySavings).toBe(-1500);
  });

  it('a promotion that expires can flip savings negative later', () => {
    const c = compareScenarios({
      current: [internet({ baseMonthly: 7000 })],
      proposed: [internet({ id: 'promo', baseMonthly: 9000, promotion: { monthlyRate: 4000, months: 12 } })],
      horizonMonths: 36,
      scenario: FLAT,
    });
    expect(c.months[0].savings).toBe(3000);
    expect(c.months[12].savings).toBe(-2000);
    expect(c.atHorizons[0].savings).toBe(36000); // 12 months
    expect(c.totals.savings).toBe(36000 - 24 * 2000);
    expect(c.steadyStateMonthlySavings).toBe(-2000);
  });

  it('kept services cancel out and are not counted as switching costs', () => {
    const phone: CostStream = { id: 'mob', label: 'Mobile', category: 'mobile', baseMonthly: 12000, oneTime: [{ kind: 'other', label: 'Device payment', amount: 3000, month: 0 }] };
    const c = compareScenarios({
      current: [internet(), phone],
      proposed: [internet({ id: 'fiber', baseMonthly: 5000 }), phone],
      horizonMonths: 12,
      scenario: FLAT,
    });
    expect(c.upfrontSwitchingCost).toBe(0);
    expect(c.breakEvenMonths).toBe(0);
    expect(c.totals.savings).toBe(12 * 2000);
  });

  it('bundle discounts depend on household eligibility facts', () => {
    const evals = evaluateDiscounts(
      [
        { label: 'Bundle with mobile', monthlyOff: 1500, requires: ['bundle:mobile'] },
        { label: 'Paperless', monthlyOff: 500, requires: ['paperless', 'autopay'] },
      ],
      new Set(['bundle:mobile', 'autopay']),
    );
    expect(evals.map((e) => [e.label, e.applied, e.missing])).toEqual([
      ['Bundle with mobile', true, []],
      ['Paperless', false, ['paperless']],
    ]);
  });
});

describe('household analysis', () => {
  const services: HouseholdService[] = [
    { current: { ...internet({ baseMonthly: 8999 }), quality: 'user_reported' }, action: { type: 'replace', with: { id: 'fiber', label: '1 Gig fiber', category: 'internet', baseMonthly: 5000, quality: 'verified' } } },
    { current: { id: 'mob', label: 'Mobile (3 lines)', category: 'mobile', baseMonthly: 15000 }, action: { type: 'keep' } },
    { current: { id: 'tv', label: 'Cable TV', category: 'tv', baseMonthly: 11000, recurring: [{ label: 'Box rental', monthly: 1200 }] }, action: { type: 'cancel' } },
  ];

  it('returns incomplete instead of guessing when inputs are missing', () => {
    const r = analyzeHousehold([{ current: { id: 'x', label: 'Internet (Comcast)', category: 'internet', baseMonthly: null }, action: { type: 'keep' } }]);
    expect(r).toEqual({ status: 'incomplete', assumptionsVersion: ASSUMPTIONS_V1.version, missing: ['Monthly cost for Internet (Comcast)'] });
    expect(analyzeHousehold([])).toMatchObject({ status: 'incomplete', missing: ['At least one household service'] });
  });

  it('rejects invalid inputs with validation errors', () => {
    expect(() => projectStream(internet({ baseMonthly: -100 }), 12, FLAT)).toThrow();
    expect(() => projectStream(internet({ baseMonthly: 49.99 }), 12, FLAT)).toThrow();
    expect(() => projectStream(internet(), 0, FLAT)).toThrow(MoneyError);
    expect(() => projectStream(internet({ firstBillProration: { days: 31, daysInPeriod: 30 } }), 12, FLAT)).toThrow();
    expect(() => projectStream(internet({ promotion: { monthlyRate: 1000, months: 0 } }), 12, FLAT)).toThrow();
  });

  it('summarizes spend by category and compares across every scenario', () => {
    const r = analyzeHousehold(services);
    if (r.status !== 'complete') throw new Error('expected complete');
    expect(r.assumptionsVersion).toBe(ASSUMPTIONS_V1.version);
    expect(r.currentMonthly).toBe(8999 + 15000 + 12200);
    expect(r.currentAnnual).toBe(12 * (8999 + 15000 + 12200));
    expect(r.byCategory).toEqual([
      { category: 'internet', monthly: 8999, annual: 107988 },
      { category: 'mobile', monthly: 15000, annual: 180000 },
      { category: 'tv', monthly: 12200, annual: 146400 },
    ]);
    expect(r.scenarios.map((s) => s.scenario.id)).toEqual(['flat', 'moderate', 'high']);
    const flat = r.scenarios[0];
    expect(flat.months[0].savings).toBe(8999 - 5000 + 12200);
    expect(flat.horizonMonths).toBe(120);
    expect(r.weakestQuality).toBe('user_reported');
    // Higher hypothetical inflation on the replaced services increases savings here.
    expect(r.scenarios[2].totals.savings).toBeGreaterThan(flat.totals.savings);
    for (const s of r.scenarios.slice(1)) expect(s.scenario.label).toMatch(/^Hypothetical/);
  });

  it('is deterministic and keeps every total an integer number of cents', () => {
    const a = analyzeHousehold(services);
    const b = analyzeHousehold(services);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    if (a.status !== 'complete') throw new Error('expected complete');
    for (const s of a.scenarios) for (const m of s.months) for (const v of [m.current, m.proposed, m.savings, m.cumulativeSavings]) expect(Number.isSafeInteger(v)).toBe(true);
  });
});
