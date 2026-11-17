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

export const BENCHMARKS_VERSION = '2026-11-17.1';

export const BENCHMARKS = {
  /** Home internet / Wi-Fi, per month. */
  internetMonthly: 5500,
  /** Mobile, per line per month, excluding device financing. */
  mobilePerLine: 4500,
  /** TV / streaming, per month. */
  tvMonthly: 7500,
  /** Electricity with solar (solar payment plus what remains of the utility bill), per month. Illustrative. */
  electricityWithSolarMonthly: 20000,
} as const satisfies Record<string, Cents>;

export const BENCHMARK_DISCLOSURE =
  'Benchmarks are comparison assumptions, not offers or guarantees. Real prices depend on service availability, eligibility, active promotions and other pricing factors.';

export interface BenchmarkContext {
  /** Number of mobile lines (1–10). */
  mobileLines?: number;
}

/** The benchmark monthly price for a category, in cents. */
export function benchmarkMonthly(category: PlatformCategory, ctx: BenchmarkContext = {}): Cents {
  switch (category) {
    case 'internet':
      return BENCHMARKS.internetMonthly;
    case 'mobile':
      return BENCHMARKS.mobilePerLine * Math.min(Math.max(Math.trunc(ctx.mobileLines ?? 1), 1), 10);
    case 'tv':
      return BENCHMARKS.tvMonthly;
    case 'electricity':
      return BENCHMARKS.electricityWithSolarMonthly;
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
export function benchmarkAssumptions(category: PlatformCategory, ctx: BenchmarkContext = {}): string[] {
  const basis: Record<PlatformCategory, string> = {
    internet: `Compares your bill with ${dollars(BENCHMARKS.internetMonthly)} a month for home internet.`,
    mobile: `Compares your bill with ${dollars(BENCHMARKS.mobilePerLine)} a month per line (${dollars(benchmarkMonthly('mobile', ctx))} for your lines), not counting phone payments.`,
    tv: `Compares your bill with ${dollars(BENCHMARKS.tvMonthly)} a month for TV and streaming.`,
    electricity: `Illustrative: compares your bill with ${dollars(BENCHMARKS.electricityWithSolarMonthly)} a month for a solar payment plus what remains of your utility bill. A site assessment sets the real figure.`,
  };
  return [basis[category], BENCHMARK_DISCLOSURE];
}

/** A benchmark expressed as an offer, so it is ranked and projected by the same engine as real plans. */
export function benchmarkOffer(category: PlatformCategory, ctx: BenchmarkContext = {}): Offer {
  return {
    id: `benchmark-${category}`,
    providerId: 'tucker-benchmark',
    category,
    planName: NAME[category],
    attributes: {},
    pricing: { baseMonthly: benchmarkMonthly(category, ctx), quality: 'estimated' },
    contractMonths: 0,
    geography: { zips: [], marketIds: [], nationwide: true },
    eligibility: { newCustomersOnly: false, requires: [] },
    restrictions: ['Comparison assumption, not an offer'],
    provenance: {
      sourceType: 'benchmark',
      reference: `Tucker comparison benchmarks ${BENCHMARKS_VERSION} (set by the owner)`,
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
  /** Monthly difference; 0 when the bill is already at or below the benchmark. */
  savings: Cents;
  note?: string;
}

/**
 * Homepage preview: each entered bill against its benchmark. The same
 * arithmetic as the full analysis (steady monthly difference, never negative),
 * with no contact details and no network call.
 */
export function quickPreview(input: QuickPreviewInput): { rows: QuickPreviewRow[]; currentMonthly: Cents; monthlySavings: Cents; annualSavings: Cents } {
  const rows: QuickPreviewRow[] = [];
  const add = (category: PlatformCategory, current: Cents | null | undefined) => {
    if (current === null || current === undefined || !Number.isSafeInteger(current) || current <= 0) return;
    if (category === 'electricity' && !input.ownsHome) {
      rows.push({ category, current, benchmark: null, savings: 0, note: 'Solar is compared for homeowners.' });
      return;
    }
    const benchmark = benchmarkMonthly(category, { mobileLines: input.mobileLines });
    rows.push({ category, current, benchmark, savings: Math.max(0, current - benchmark) });
  };
  add('internet', input.internet);
  add('mobile', input.mobile);
  add('tv', input.tv);
  add('electricity', input.electricity);
  const monthlySavings = rows.reduce((s, r) => s + r.savings, 0);
  return { rows, currentMonthly: rows.reduce((s, r) => s + r.current, 0), monthlySavings, annualSavings: monthlySavings * 12 };
}
