/**
 * Tucker's comparison benchmarks: owner-set monthly prices used for an
 * ILLUSTRATIVE savings preview where no real offer is on file for a household.
 *
 * They are comparison assumptions, not offers and not guarantees. Real prices
 * depend on service availability, eligibility, active promotions and other
 * pricing factors. Everything derived from them is labelled "Benchmark".
 * Change a value only on the owner's instruction, and bump the version.
 */
import type { Cents } from '../finance/money';
import type { Offer } from '../offers/model';
import type { PlatformCategory } from './assessment';

/**
 * One set of benchmarks with the version it was published as. The current set
 * is stored in the database and edited in Admin → Benchmarks; every analysis
 * keeps a copy of the set it used, so later changes never rewrite old results.
 */
export interface BenchmarkSet {
  version: string;
  /** Home internet / Wi-Fi, per month. */
  internetMonthly: Cents;
  /** Mobile, per line per month, excluding device financing. */
  mobilePerLine: Cents;
  /** TV / streaming, per month. */
  tvMonthly: Cents;
  /** Electricity with solar (solar payment plus what remains of the utility bill), per month. Illustrative. */
  electricityWithSolarMonthly: Cents;
}

/** The owner's starting values, used until a set is published and for results saved before versions existed. */
export const DEFAULT_BENCHMARKS: BenchmarkSet = { version: '2026-11-17.1', internetMonthly: 5500, mobilePerLine: 4500, tvMonthly: 7500, electricityWithSolarMonthly: 20000 };
export const BENCHMARKS_VERSION = DEFAULT_BENCHMARKS.version;
/** @deprecated the starting values; read the current set from the server or boot data instead. */
export const BENCHMARKS = DEFAULT_BENCHMARKS;

export const BENCHMARK_FIELDS = [
  ['internetMonthly', 'Home internet', 'per month'],
  ['mobilePerLine', 'Mobile', 'per line, per month, not counting phone payments'],
  ['tvMonthly', 'TV / streaming', 'per month'],
  ['electricityWithSolarMonthly', 'Electricity with solar', 'per month, illustrative'],
] as const;

export const BENCHMARK_DISCLOSURE =
  'Benchmarks are comparison assumptions, not offers or guarantees. Real prices depend on service availability, eligibility, active promotions and other pricing factors.';

export interface BenchmarkContext {
  /** Number of mobile lines (1–10). */
  mobileLines?: number;
}

/** The benchmark monthly price for a category, in cents. */
export function benchmarkMonthly(category: PlatformCategory, ctx: BenchmarkContext = {}, set: BenchmarkSet = DEFAULT_BENCHMARKS): Cents {
  switch (category) {
    case 'internet':
      return set.internetMonthly;
    case 'mobile':
      return set.mobilePerLine * Math.min(Math.max(Math.trunc(ctx.mobileLines ?? 1), 1), 10);
    case 'tv':
      return set.tvMonthly;
    case 'electricity':
      return set.electricityWithSolarMonthly;
  }
}

const dollars = (c: Cents) => (c % 100 === 0 ? `$${c / 100}` : `$${(c / 100).toFixed(2)}`);

const NAME: Record<PlatformCategory, string> = {
  internet: 'Tucker benchmark: home internet',
  mobile: 'Tucker benchmark: mobile',
  tv: 'Tucker benchmark: TV & streaming',
  electricity: 'Tucker benchmark: electricity with solar',
};

/** Plain-language basis shown next to a benchmark option. */
export function benchmarkAssumptions(category: PlatformCategory, ctx: BenchmarkContext = {}, set: BenchmarkSet = DEFAULT_BENCHMARKS): string[] {
  const basis: Record<PlatformCategory, string> = {
    internet: `Compares your bill with ${dollars(set.internetMonthly)} a month for home internet.`,
    mobile: `Compares your bill with ${dollars(set.mobilePerLine)} a month per line (${dollars(benchmarkMonthly('mobile', ctx, set))} for your lines), not counting phone payments.`,
    tv: `Compares your bill with ${dollars(set.tvMonthly)} a month for TV and streaming.`,
    electricity: `Illustrative: compares your bill with ${dollars(set.electricityWithSolarMonthly)} a month for a solar payment plus what remains of your utility bill. A site assessment sets the real figure.`,
  };
  return [basis[category], BENCHMARK_DISCLOSURE];
}

/** A benchmark expressed as an offer, so it is ranked and projected by the same engine as real plans. */
export function benchmarkOffer(category: PlatformCategory, ctx: BenchmarkContext = {}, set: BenchmarkSet = DEFAULT_BENCHMARKS): Offer {
  return {
    id: `benchmark-${category}`,
    providerId: 'tucker-benchmark',
    category,
    planName: NAME[category],
    attributes: {},
    pricing: { baseMonthly: benchmarkMonthly(category, ctx, set), quality: 'estimated' },
    contractMonths: 0,
    geography: { zips: [], marketIds: [], nationwide: true },
    eligibility: { newCustomersOnly: false, requires: [] },
    restrictions: ['Comparison assumption, not an offer'],
    provenance: {
      sourceType: 'benchmark',
      reference: `Tucker comparison benchmarks ${set.version} (set by the owner)`,
      recordedBy: 'Spotlight Marketing LLC',
      verifiedAt: '2026-11-17T00:00:00Z',
      review: 'estimated',
      gaps: ['Comparison benchmark, not an offer'],
    },
  };
}

export interface QuickPreviewInput {
  internet?: Cents | null;
  mobile?: Cents | null;
  mobileLines?: number;
  tv?: Cents | null;
  electricity?: Cents | null;
  /** Electricity is compared with solar only for people who own their home. */
  ownsHome?: boolean;
}

export interface QuickPreviewRow {
  category: PlatformCategory;
  current: Cents;
  benchmark: Cents | null;
  /** Current bill minus the benchmark. Negative means the benchmark is higher than the bill. Null when not compared. */
  difference: Cents | null;
  /** The part that counts toward potential savings: the difference when positive, otherwise 0. */
  savings: Cents;
  note?: string;
}

export interface QuickPreview {
  rows: QuickPreviewRow[];
  currentMonthly: Cents;
  /** Sum of the benchmarks for the services that were compared. */
  benchmarkMonthly: Cents;
  /** Sum of the services where the benchmark is lower than the bill. */
  monthlySavings: Cents;
  annualSavings: Cents;
  /** Sum of the services where the benchmark is higher than the bill (shown, never hidden). */
  monthlyHigher: Cents;
  benchmarksVersion: string;
}

/**
 * Preview: each entered bill against its benchmark. Difference = current bill
 * minus benchmark, annual = monthly times 12. A service where the benchmark is
 * higher is shown as a possible extra cost and left out of the savings total.
 * No contact details and no network call.
 */
export function quickPreview(input: QuickPreviewInput, set: BenchmarkSet = DEFAULT_BENCHMARKS): QuickPreview {
  const rows: QuickPreviewRow[] = [];
  const add = (category: PlatformCategory, current: Cents | null | undefined) => {
    if (current === null || current === undefined || !Number.isSafeInteger(current) || current <= 0) return;
    if (category === 'electricity' && !input.ownsHome) {
      rows.push({ category, current, benchmark: null, difference: null, savings: 0, note: 'Solar is compared for homeowners.' });
      return;
    }
    const benchmark = benchmarkMonthly(category, { mobileLines: input.mobileLines }, set);
    rows.push({ category, current, benchmark, difference: current - benchmark, savings: Math.max(0, current - benchmark) });
  };
  add('internet', input.internet);
  add('mobile', input.mobile);
  add('tv', input.tv);
  add('electricity', input.electricity);
  const monthlySavings = rows.reduce((t, r) => t + r.savings, 0);
  return {
    rows,
    currentMonthly: rows.reduce((t, r) => t + r.current, 0),
    benchmarkMonthly: rows.reduce((t, r) => t + (r.benchmark ?? 0), 0),
    monthlySavings,
    annualSavings: monthlySavings * 12,
    monthlyHigher: rows.reduce((t, r) => t + Math.max(0, -(r.difference ?? 0)), 0),
    benchmarksVersion: set.version,
  };
}
