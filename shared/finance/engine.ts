/**
 * Deterministic household cost engine.
 *
 * Everything here is a pure function of its inputs: same input + same
 * assumption set → byte-identical output. No AI, no network, no clock (callers
 * pass dates). Months are 0-indexed from the start of the analysis (month 0 =
 * first bill). Results carry the assumption-set version that produced them.
 *
 * Modelling conventions (also shown to users as "how we calculated this"):
 *  - Promotions replace the standard rate for their first N months and do not
 *    escalate.
 *  - Price-increase scenarios are HYPOTHETICAL. Increases are applied in steps
 *    on each 12-month anniversary of the analysis start (month 12, 24, …),
 *    except anniversaries that fall inside a price-lock period; each step
 *    compounds and is rounded to the cent.
 *  - Estimated taxes, when supplied, apply to recurring charges only.
 *  - The first bill can be pro-rated (partial billing period).
 */
import { z } from 'zod';
import { applyBps, assertCents, divRound, MoneyError, prorate, sum, type Bps, type Cents } from './money';

z.config({ jitless: true });

// ------------------------------------------------------------------ inputs --
const cents = z.number().int().refine(Number.isSafeInteger, 'Out of range');
const nonNegCents = cents.refine((v) => v >= 0, 'Must not be negative');
const month = z.number().int().min(0).max(600);
const months = z.number().int().min(1).max(600);

export const CATEGORIES = ['internet', 'mobile', 'tv', 'electricity', 'solar', 'other'] as const;
export type Category = (typeof CATEGORIES)[number];

/** How trustworthy a number is. Drives labelling in the UI. */
export const DATA_QUALITY = ['verified', 'manually_verified', 'user_reported', 'estimated'] as const;
export type DataQuality = (typeof DATA_QUALITY)[number];

export const oneTimeSchema = z.object({
  kind: z.enum(['installation', 'equipment_purchase', 'activation', 'early_termination', 'credit', 'other']),
  label: z.string().min(1).max(120),
  /** Positive = cost, negative = credit (e.g. a $100 switching credit is −10000). */
  amount: cents,
  /** Month the charge or credit lands on (0 = first bill). */
  month: month.default(0),
});
export type OneTimeCost = z.input<typeof oneTimeSchema>;

export const recurringSchema = z.object({
  label: z.string().min(1).max(120),
  /** Monthly amount; negative for a recurring discount. */
  monthly: cents,
  startMonth: month.default(0),
  /** How many months it applies; omitted = for the whole horizon. */
  months: months.optional(),
  /** Whether this charge rises with the price-increase scenario. */
  escalates: z.boolean().default(false),
});
export type RecurringCharge = z.input<typeof recurringSchema>;

export const discountSchema = z.object({
  label: z.string().min(1).max(120),
  /** Amount off per month (positive number). */
  monthlyOff: nonNegCents,
  startMonth: month.default(0),
  months: months.optional(),
  /** Household facts required to qualify, e.g. ["autopay", "bundle:mobile"]. */
  requires: z.array(z.string().min(1).max(60)).max(10).default([]),
});
export type Discount = z.input<typeof discountSchema>;

export const earlyTerminationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('flat'), amount: nonNegCents }),
  /** Common for contracts: $X for each remaining month, optionally capped. */
  z.object({ kind: z.literal('per_month_remaining'), perMonth: nonNegCents, monthsRemaining: z.number().int().min(0).max(600), cap: nonNegCents.optional() }),
]);
export type EarlyTermination = z.input<typeof earlyTerminationSchema>;

export const costStreamSchema = z.object({
  id: z.string().min(1).max(80),
  label: z.string().min(1).max(120),
  category: z.enum(CATEGORIES),
  /** Standard monthly rate after any promotion (before taxes, fees, discounts). */
  baseMonthly: nonNegCents,
  promotion: z.object({ monthlyRate: nonNegCents, months }).optional(),
  /** Price guaranteed (no scenario increases) for this many months. */
  priceLockMonths: z.number().int().min(0).max(600).default(0),
  /** Whether the base rate is subject to the price-increase scenario. */
  escalates: z.boolean().default(true),
  recurring: z.array(recurringSchema).max(30).default([]),
  discounts: z.array(discountSchema).max(20).default([]),
  oneTime: z.array(oneTimeSchema).max(30).default([]),
  /** Estimated taxes & surcharges on recurring charges, in basis points. */
  taxBps: z.number().int().min(0).max(5000).default(0),
  /** Partial first billing period, e.g. { days: 12, daysInPeriod: 30 }. */
  firstBillProration: z
    .object({ days: z.number().int().min(0).max(31), daysInPeriod: z.number().int().min(28).max(31) })
    .refine((p) => p.days <= p.daysInPeriod, 'days cannot exceed the billing period')
    .optional(),
  /** Charged only when this service is cancelled to switch. */
  earlyTermination: earlyTerminationSchema.optional(),
  quality: z.enum(DATA_QUALITY).default('user_reported'),
});
export type CostStream = z.input<typeof costStreamSchema>;
type Stream = z.output<typeof costStreamSchema>;

export const escalationScenarioSchema = z.object({
  id: z.string().min(1).max(40),
  label: z.string().min(1).max(120),
  annualBps: z.number().int().min(-2000).max(5000),
});
export type EscalationScenario = z.infer<typeof escalationScenarioSchema>;

// ------------------------------------------------------------- assumptions --
/**
 * Versioned assumption set. Any change to defaults or conventions must bump
 * `version` so stored analyses remain reproducible and comparable.
 */
export const ASSUMPTIONS_V1 = {
  version: '2026-11-15.1',
  horizonsMonths: [12, 60, 120] as const,
  escalationScenarios: [
    { id: 'flat', label: 'No price increases', annualBps: 0 },
    { id: 'moderate', label: 'Hypothetical: prices rise 3% per year', annualBps: 300 },
    { id: 'high', label: 'Hypothetical: prices rise 6% per year', annualBps: 600 },
  ] satisfies EscalationScenario[],
  notes: [
    'Future price increases are illustrative scenarios, not predictions.',
    'Promotional prices end after their stated months; the standard rate applies afterwards.',
    'Savings assume plan prices and fees stay as entered unless a scenario says otherwise.',
  ],
} as const;
export type AssumptionSet = typeof ASSUMPTIONS_V1;

// ------------------------------------------------------------- core maths --
/** Number of escalation steps in effect at `m`: anniversaries 12, 24, … ≤ m that are not inside the price lock. */
export function escalationSteps(m: number, priceLockMonths: number): number {
  let steps = 0;
  for (let a = 12; a <= m; a += 12) if (a >= priceLockMonths) steps++;
  return steps;
}

/** Apply `steps` compounding increases of `bps`, rounding to the cent at each step. */
export function escalate(amount: Cents, bps: Bps, steps: number): Cents {
  let v = assertCents(amount);
  for (let i = 0; i < steps; i++) v = v + applyBps(v, bps);
  return v;
}

const activeIn = (m: number, start: number, len: number | undefined) => m >= start && (len === undefined || m < start + len);

export interface DiscountEvaluation {
  label: string;
  monthlyOff: Cents;
  applied: boolean;
  /** Requirements the household does not meet (empty when applied). */
  missing: string[];
}

/** Which discounts this household qualifies for, given its facts (e.g. {"autopay"}). */
export function evaluateDiscounts(discounts: Discount[], facts: ReadonlySet<string>): DiscountEvaluation[] {
  return discounts.map((d) => {
    const parsed = discountSchema.parse(d);
    const missing = parsed.requires.filter((r) => !facts.has(r));
    return { label: parsed.label, monthlyOff: parsed.monthlyOff, applied: missing.length === 0, missing };
  });
}

/** Early-termination fee owed if this service is cancelled now. */
export function earlyTerminationFee(etf: EarlyTermination | undefined): Cents {
  if (!etf) return 0;
  const e = earlyTerminationSchema.parse(etf);
  if (e.kind === 'flat') return e.amount;
  const fee = e.perMonth * e.monthsRemaining;
  return e.cap !== undefined ? Math.min(fee, e.cap) : fee;
}

export interface MonthLine {
  month: number;
  recurring: Cents;
  discounts: Cents; // ≤ 0
  tax: Cents;
  oneTime: Cents;
  total: Cents;
}

export interface StreamProjection {
  id: string;
  label: string;
  category: Category;
  quality: DataQuality;
  months: MonthLine[];
  total: Cents;
  appliedDiscounts: DiscountEvaluation[];
}

/** Month-by-month cost of one service under one escalation scenario. */
export function projectStream(input: CostStream, horizon: number, scenario: EscalationScenario, facts: ReadonlySet<string> = new Set()): StreamProjection {
  const s: Stream = costStreamSchema.parse(input);
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > 600) throw new MoneyError(`Invalid horizon ${horizon}`);
  const discounts = evaluateDiscounts(s.discounts, facts);
  const lines: MonthLine[] = [];
  for (let m = 0; m < horizon; m++) {
    const steps = s.escalates ? escalationSteps(m, s.priceLockMonths) : 0;
    const promoActive = s.promotion && m < s.promotion.months;
    const base = promoActive ? s.promotion!.monthlyRate : escalate(s.baseMonthly, scenario.annualBps, steps);
    const extras = s.recurring
      .filter((r) => activeIn(m, r.startMonth, r.months))
      .map((r) => (r.escalates ? escalate(r.monthly, scenario.annualBps, escalationSteps(m, s.priceLockMonths)) : r.monthly));
    let recurring = sum([base, ...extras]);
    let disc = -sum(
      s.discounts
        .filter((d, i) => discounts[i].applied && activeIn(m, d.startMonth, d.months))
        .map((d) => d.monthlyOff),
    );
    if (m === 0 && s.firstBillProration) {
      recurring = prorate(recurring, s.firstBillProration.days, s.firstBillProration.daysInPeriod);
      disc = -prorate(-disc, s.firstBillProration.days, s.firstBillProration.daysInPeriod);
    }
    // A discount can't make the recurring bill negative.
    if (recurring + disc < 0) disc = -recurring;
    const tax = applyBps(recurring + disc, s.taxBps);
    const oneTime = sum(s.oneTime.filter((o) => o.month === m).map((o) => o.amount));
    lines.push({ month: m, recurring, discounts: disc, tax, oneTime, total: recurring + disc + tax + oneTime });
  }
  return {
    id: s.id,
    label: s.label,
    category: s.category,
    quality: s.quality,
    months: lines,
    total: sum(lines.map((l) => l.total)),
    appliedDiscounts: discounts,
  };
}

export interface ComparisonMonth {
  month: number;
  current: Cents;
  proposed: Cents;
  /** current − proposed: positive = the proposal costs less this month. */
  savings: Cents;
  cumulativeSavings: Cents;
}

export interface Comparison {
  scenario: EscalationScenario;
  horizonMonths: number;
  months: ComparisonMonth[];
  totals: { current: Cents; proposed: Cents; savings: Cents };
  /** Cumulative savings at each standard horizon that fits (12, 60, 120 months). */
  atHorizons: { months: number; current: Cents; proposed: Cents; savings: Cents }[];
  /** One-time costs to switch (installation, equipment, early-termination fees, net of credits). */
  upfrontSwitchingCost: Cents;
  /**
   * Months until cumulative savings recover the switching cost (1 = within the
   * first month). 0 when there's nothing to recover; null if never within the horizon.
   */
  breakEvenMonths: number | null;
  /** Average monthly savings after promotions/one-time items settle (months 25–36 when available). */
  steadyStateMonthlySavings: Cents;
}

/**
 * Compare a household's current services with a proposed set over a horizon.
 * `switchingCosts` are extra one-time items caused by switching (e.g. ETFs of
 * cancelled services); they're added to the proposed side.
 */
export function compareScenarios(o: {
  current: CostStream[];
  proposed: CostStream[];
  switchingCosts?: OneTimeCost[];
  horizonMonths: number;
  scenario: EscalationScenario;
  facts?: ReadonlySet<string>;
  standardHorizons?: readonly number[];
}): Comparison {
  const facts = o.facts ?? new Set<string>();
  const cur = o.current.map((s) => projectStream(s, o.horizonMonths, o.scenario, facts));
  const prop = o.proposed.map((s) => projectStream(s, o.horizonMonths, o.scenario, facts));
  const switching = (o.switchingCosts ?? []).map((c) => oneTimeSchema.parse(c));

  const months: ComparisonMonth[] = [];
  let cumulative = 0;
  for (let m = 0; m < o.horizonMonths; m++) {
    const current = sum(cur.map((p) => p.months[m].total));
    const proposed = sum([...prop.map((p) => p.months[m].total), ...switching.filter((c) => c.month === m).map((c) => c.amount)]);
    cumulative += current - proposed;
    months.push({ month: m, current, proposed, savings: current - proposed, cumulativeSavings: assertCents(cumulative) });
  }

  // One-time items the switch introduces: proposed one-time items minus the current
  // side's (services kept unchanged appear on both sides and cancel out), plus ETFs.
  const oneTimeTotal = (streams: CostStream[]) => sum(streams.flatMap((s) => costStreamSchema.parse(s).oneTime.map((x) => x.amount)));
  const upfrontSwitchingCost = sum([...switching.map((c) => c.amount), oneTimeTotal(o.proposed) - oneTimeTotal(o.current)]);

  let breakEvenMonths: number | null = null;
  if (upfrontSwitchingCost <= 0 && months[0]?.cumulativeSavings >= 0) breakEvenMonths = 0;
  else {
    const idx = months.findIndex((x) => x.cumulativeSavings >= 0);
    breakEvenMonths = idx === -1 ? null : idx + 1;
  }

  const cumulativeAt = (n: number) => {
    const slice = months.slice(0, n);
    const c = sum(slice.map((x) => x.current));
    const p = sum(slice.map((x) => x.proposed));
    return { months: n, current: c, proposed: p, savings: c - p };
  };
  const steady = months.slice(24, 36).length ? months.slice(24, 36) : months.slice(-Math.min(12, months.length));
  const steadyStateMonthlySavings = divRound(sum(steady.map((x) => x.savings)), steady.length);

  return {
    scenario: o.scenario,
    horizonMonths: o.horizonMonths,
    months,
    totals: { current: sum(months.map((x) => x.current)), proposed: sum(months.map((x) => x.proposed)), savings: sum(months.map((x) => x.savings)) },
    atHorizons: (o.standardHorizons ?? ASSUMPTIONS_V1.horizonsMonths).filter((h) => h <= o.horizonMonths).map(cumulativeAt),
    upfrontSwitchingCost,
    breakEvenMonths,
    steadyStateMonthlySavings,
  };
}

// --------------------------------------------------------- household level --
export interface HouseholdService {
  /** Current service; `baseMonthly` may be null when the customer doesn't know it. */
  current: Omit<CostStream, 'baseMonthly'> & { baseMonthly: Cents | null };
  /** What happens to this service in the proposal. */
  action: { type: 'keep' } | { type: 'cancel' } | { type: 'replace'; with: CostStream };
}

export interface HouseholdAnalysis {
  status: 'complete';
  assumptionsVersion: string;
  /** Today's recurring monthly spend (standard month, excluding one-time items). */
  currentMonthly: Cents;
  currentAnnual: Cents;
  byCategory: { category: Category; monthly: Cents; annual: Cents }[];
  switchingCosts: OneTimeCost[];
  scenarios: Comparison[];
  /** Lowest data quality among the inputs used — the UI labels results accordingly. */
  weakestQuality: DataQuality;
  notes: readonly string[];
}

export interface IncompleteAnalysis {
  status: 'incomplete';
  assumptionsVersion: string;
  /** Inputs we need before calculating, e.g. "Monthly cost for Internet (Comcast)". */
  missing: string[];
}

const QUALITY_RANK: Record<DataQuality, number> = { verified: 3, manually_verified: 2, user_reported: 1, estimated: 0 };

/**
 * Full household analysis across every escalation scenario. Never invents a
 * number: services with an unknown current cost make the result incomplete.
 */
export function analyzeHousehold(
  services: HouseholdService[],
  opts: { horizonMonths?: number; facts?: ReadonlySet<string>; assumptions?: AssumptionSet } = {},
): HouseholdAnalysis | IncompleteAnalysis {
  const a = opts.assumptions ?? ASSUMPTIONS_V1;
  const horizon = opts.horizonMonths ?? Math.max(...a.horizonsMonths);
  const missing = services.filter((s) => s.current.baseMonthly === null).map((s) => `Monthly cost for ${s.current.label}`);
  if (!services.length) missing.push('At least one household service');
  if (missing.length) return { status: 'incomplete', assumptionsVersion: a.version, missing };

  const current = services.map((s) => ({ ...s.current, baseMonthly: s.current.baseMonthly as Cents }));
  const proposed: CostStream[] = [];
  const switchingCosts: OneTimeCost[] = [];
  services.forEach((s, i) => {
    if (s.action.type === 'keep') proposed.push(current[i]);
    else {
      if (s.action.type === 'replace') proposed.push(s.action.with);
      const fee = earlyTerminationFee(current[i].earlyTermination);
      if (fee > 0) switchingCosts.push({ kind: 'early_termination', label: `Early termination: ${current[i].label}`, amount: fee, month: 0 });
    }
  });

  // "Today's" spend = a standard month: month 12 of the flat scenario would include
  // anniversary effects, so use month 0 without proration or one-time items.
  const flat = a.escalationScenarios[0];
  const todayLines = current.map((s) => {
    const p = projectStream({ ...s, firstBillProration: undefined, oneTime: [] }, 12, flat, opts.facts);
    return { category: p.category, monthly: p.months[0].total, annual: sum(p.months.map((l) => l.total)) };
  });
  const byCategory = CATEGORIES.map((c) => ({
    category: c,
    monthly: sum(todayLines.filter((l) => l.category === c).map((l) => l.monthly)),
    annual: sum(todayLines.filter((l) => l.category === c).map((l) => l.annual)),
  })).filter((c) => c.monthly !== 0 || c.annual !== 0);

  const qualities = [...current, ...proposed].map((s) => costStreamSchema.parse(s).quality);
  const weakestQuality = qualities.reduce((w, q) => (QUALITY_RANK[q] < QUALITY_RANK[w] ? q : w), 'verified' as DataQuality);

  return {
    status: 'complete',
    assumptionsVersion: a.version,
    currentMonthly: sum(todayLines.map((l) => l.monthly)),
    currentAnnual: sum(todayLines.map((l) => l.annual)),
    byCategory,
    switchingCosts,
    scenarios: a.escalationScenarios.map((scenario) =>
      compareScenarios({ current, proposed, switchingCosts, horizonMonths: horizon, scenario, facts: opts.facts }),
    ),
    weakestQuality,
    notes: a.notes,
  };
}
