/**
 * Household analysis: assessment answers → cost streams → per-category
 * comparisons → household projection. Pure and deterministic: the server
 * stores the result as an immutable snapshot and the browser re-runs the same
 * function for interactive controls (scenario, horizon, chosen alternative),
 * using the snapshot's `computedAt` so offer freshness can't drift.
 */
import { analyzeHousehold, ASSUMPTIONS_V1, type Category, type CostStream, type HouseholdService, type HouseholdAnalysis } from '../finance/engine';
import { divRound, formatCents, type Cents } from '../finance/money';
import { rankOffers, type Candidate, type LensResult } from '../offers/rank';
import { offerSchema, type Offer } from '../offers/model';
import { CATEGORY_LABEL, PROMO_MONTHS, type Assessment, type PlatformCategory } from './assessment';
import { CATALOG_VERSION, offersFor } from './catalog';
import { BENCHMARK_DISCLOSURE, BENCHMARKS_VERSION, benchmarkAssumptions, benchmarkOffer, DEFAULT_BENCHMARKS, type BenchmarkSet } from './benchmarks';
import { SAMPLE_SOLAR_PROGRAMS, SOLAR_FACTS, SOLAR_PROGRAMS, solarAssumptions, solarOffer } from './solar';

export const ANALYSIS_VERSION = `analysis-4/${CATALOG_VERSION}/b${BENCHMARKS_VERSION}`;
export const HORIZONS = [12, 60, 120] as const;
export type Horizon = (typeof HORIZONS)[number];
export type ScenarioId = 'flat' | 'moderate' | 'high';

/**
 * Per-category choice: an offer id, "keep" the current service, or "review"
 * (ask an advisor to look for a better price on this bill).
 */
export type Selections = Partial<Record<PlatformCategory, string>>;

export interface AnalysisOptions {
  includeSamples: boolean;
  /** Fixed analysis time (stored with the snapshot) — never "now" during re-computation. */
  computedAt: string;
  selections?: Selections;
  /**
   * Real offers for this household's area, supplied by the server from the
   * admin-managed locations and stored with the snapshot so every later
   * recalculation uses exactly what the customer saw. Omitted only for
   * snapshots made before this existed (they fall back to the built-in pilot data).
   */
  catalog?: AreaCatalog;
  /** The benchmark set to compare with. Defaults to the starting values (what results saved before versions used). */
  benchmarks?: BenchmarkSet;
}

export interface AreaCatalog {
  internet: Offer[];
  /** Shown when there are no internet offers, e.g. "Fiber is coming soon to your area". */
  internetNote?: string;
}

/**
 * - verified / pending_address: a real plan on file (address confirmed or not yet)
 * - benchmark: Tucker's comparison benchmark, used where no real plan is on file (illustrative)
 * - sample: staging-only demo data
 */
export type OptionKind = 'verified' | 'pending_address' | 'benchmark' | 'sample';

export interface CategoryOption {
  offerId: string;
  planName: string;
  kind: OptionKind;
  candidate: Candidate;
  /** Monthly price of the plan itself, today (cents). */
  monthlyPrice: Cents;
  restrictions: string[];
  disclosureUrl?: string;
  /** True when the price depends on assumptions about this household (e.g. solar). */
  estimate: boolean;
  /** Plain-language assumptions behind an estimate. */
  assumptions: string[];
}

export interface CategoryResult {
  category: PlatformCategory;
  label: string;
  /** Today's monthly cost for this category (null when the customer didn't know it). */
  currentMonthly: Cents | null;
  provider: string;
  options: CategoryOption[];
  /** Lenses over verified-and-eligible options, else over pending-address options, else samples. */
  lenses: LensResult[];
  lensKind: OptionKind | null;
  /** Option used in the household projection, 'keep', or 'review' (advisor bill review requested). */
  selected: string;
  notes: string[];
  /** Plain facts worked out from the household's own numbers (no outside prices). */
  insights: string[];
  /** False when this service has no comparison at all (kept for snapshot compatibility). */
  comparisonAvailable: boolean;
  /** Electricity only: why solar is or isn't shown, for the advisor call-to-action. */
  solar?: SolarStatus;
}

/**
 * Electricity's alternative is rooftop solar.
 * - estimated: a program estimate is shown
 * - advisor: solar may fit, but no program terms are on file for this area yet
 * - needs_info: we need home ownership (or the bill) to say
 * - not_suitable: renting or a heavily shaded roof
 */
export type SolarStatus = 'estimated' | 'advisor' | 'needs_info' | 'not_suitable';

export interface PlatformAnalysis {
  version: string;
  assumptionsVersion: string;
  computedAt: string;
  includeSamples: boolean;
  status: 'complete' | 'incomplete';
  missing: string[];
  zip: string;
  categories: CategoryResult[];
  /** Household projection with the selected options (null when incomplete). */
  household: HouseholdAnalysis | null;
  /** Weakest evidence among the selected options. */
  projectionBasis: OptionKind | 'current_only';
  /** Categories ordered by steady-state monthly savings of the selected option. */
  opportunities: { category: PlatformCategory; label: string; monthlySavings: Cents; kind: OptionKind }[];
  /** The area catalog used (see AnalysisOptions.catalog). */
  catalog?: AreaCatalog;
  /** The benchmark values this analysis compared with, kept so the result never changes when benchmarks do. */
  benchmarks?: BenchmarkSet;
  notes: string[];
}

const MAIN = (c: PlatformCategory) => `current-${c}`;
/** Solar offers are only built for owners whose roof may suit solar, so these facts hold when ranking them. */
const SOLAR_FACT_SET: ReadonlySet<string> = new Set(Object.values(SOLAR_FACTS));

/** Map one category's answers to current cost streams (null baseMonthly = unknown). */
export function currentStreamsFor(a: Assessment, c: PlatformCategory): { streams: HouseholdService['current'][]; notes: string[]; provider: string } {
  const notes: string[] = [];
  switch (c) {
    case 'internet': {
      const i = a.internet!;
      const promoMonths = PROMO_MONTHS[i.promoEnds];
      const stream: HouseholdService['current'] = {
        id: MAIN(c),
        label: i.provider ? `${i.provider} internet` : 'Current internet',
        category: 'internet',
        baseMonthly: i.monthlyCents,
        quality: 'user_reported',
        recurring: i.equipmentFeeCents ? [{ label: 'Equipment fee', monthly: i.equipmentFeeCents }] : [],
        earlyTermination: i.contractMonthsRemaining > 0 && i.earlyTerminationCents ? { kind: 'flat', amount: i.earlyTerminationCents } : undefined,
      };
      if (promoMonths !== null && i.monthlyCents !== null) {
        if (i.promoRegularCents !== null && i.promoRegularCents > i.monthlyCents) {
          stream.promotion = { monthlyRate: i.monthlyCents, months: promoMonths };
          stream.baseMonthly = i.promoRegularCents;
          notes.push(`Your current promotional price is modelled to end in about ${promoMonths} months, then rise to the regular price you entered.`);
        } else {
          notes.push('Your promotional price may increase when it ends. Add the regular price for a more accurate projection.');
        }
      }
      if (i.promoEnds === 'unknown') notes.push('If you’re on a promotional price, it may rise later — check your bill for an end date.');
      return { streams: [stream], notes, provider: i.provider };
    }
    case 'mobile': {
      const m = a.mobile!;
      if (m.deviceFinancingCents) notes.push('Phone payments (device installments) are left out — they continue whichever plan you choose.');
      return {
        streams: [{ id: MAIN(c), label: m.carrier ? `${m.carrier} (${m.lines} ${m.lines === 1 ? 'line' : 'lines'})` : `Mobile (${m.lines} lines)`, category: 'mobile', baseMonthly: m.monthlyCents, quality: 'user_reported' }],
        notes,
        provider: m.carrier,
      };
    }
    case 'tv': {
      const t = a.tv!;
      const streams: HouseholdService['current'][] = [
        {
          id: MAIN(c),
          label: t.provider ? `${t.provider} TV` : 'Current TV',
          category: 'tv',
          baseMonthly: t.monthlyCents,
          quality: 'user_reported',
          recurring: t.equipmentFeeCents ? [{ label: 'TV equipment', monthly: t.equipmentFeeCents }] : [],
        },
      ];
      if (t.otherStreamingCents) {
        streams.push({ id: 'current-streaming', label: 'Other streaming subscriptions', category: 'tv', baseMonthly: t.otherStreamingCents, quality: 'user_reported' });
        notes.push('Your other streaming subscriptions are counted in your spending and kept as they are.');
      }
      if (t.mustHave.length) notes.push(`Check that any alternative includes: ${t.mustHave.map((x) => x.replace('_', ' ')).join(', ')}.`);
      return { streams, notes, provider: t.provider };
    }
    case 'electricity': {
      const e = a.electricity!;
      return {
        streams: [{ id: MAIN(c), label: e.utility ? `${e.utility} electricity` : 'Electricity', category: 'electricity', baseMonthly: e.monthlyCents, quality: 'user_reported', escalates: true }],
        notes,
        provider: e.utility,
      };
    }
  }
}

interface CategoryOffers {
  real: Offer[];
  samples: Offer[];
  /** Comparison benchmark for this household, used only when no real plan is usable. */
  benchmark?: Offer;
  /** Assumptions per offer id (solar estimates). */
  assumptions: Map<string, string[]>;
  notes: string[];
  solar?: SolarStatus;
}

/** Electricity → household-specific rooftop-solar alternatives. */
function solarOffersFor(a: Assessment, includeSamples: boolean, set: BenchmarkSet): CategoryOffers {
  const e = a.electricity!;
  const out: CategoryOffers = { real: [], samples: [], assumptions: new Map(), notes: [] };
  if (e.homeownership === 'rent') {
    out.notes.push('Rooftop solar usually requires owning your home, so we don’t compare solar for renters.');
    return { ...out, solar: 'not_suitable' };
  }
  if (e.roofSun === 'heavy_shade') {
    out.notes.push('Heavily shaded roofs usually produce too little power for rooftop solar to lower your bill.');
    return { ...out, solar: 'not_suitable' };
  }
  if (e.homeownership === 'unknown' || e.monthlyCents === null) {
    out.notes.push(e.monthlyCents === null ? 'Add your electric bill to see a solar estimate.' : 'Tell us whether you own your home to see a solar estimate.');
    return { ...out, solar: 'needs_info' };
  }
  const household = { billCents: e.monthlyCents, monthlyKwh: e.monthlyKwh };
  const build = (programs: typeof SOLAR_PROGRAMS) =>
    programs
      .filter((p) => p.geography.nationwide || (p.geography.zips ?? []).includes(a.zip))
      .map((p) => {
        const { offer, estimate } = solarOffer(p, household);
        out.assumptions.set(p.id, solarAssumptions(p, estimate));
        return offer;
      });
  out.real = build(SOLAR_PROGRAMS);
  out.samples = includeSamples ? build(SAMPLE_SOLAR_PROGRAMS) : [];
  if (e.roofSun === 'unknown') out.notes.push('We assumed your roof gets enough sun; a site assessment will confirm it.');
  // No program terms on file: compare against the solar benchmark (illustrative), unless demo samples are shown.
  if (!out.real.length && !includeSamples) {
    out.benchmark = benchmarkOffer('electricity', {}, set);
    out.assumptions.set(out.benchmark.id, benchmarkAssumptions('electricity', {}, set));
    return { ...out, solar: 'estimated' };
  }
  if (!out.real.length && !out.samples.length) {
    out.notes.push('Solar could lower your electricity costs. We don’t have current solar pricing on file for your area yet — an advisor can prepare a free site-specific estimate.');
  }
  return { ...out, solar: out.real.length || out.samples.length ? 'estimated' : 'advisor' };
}

function offersForCategory(c: PlatformCategory, a: Assessment, includeSamples: boolean, catalog: AreaCatalog | undefined, set: BenchmarkSet): CategoryOffers {
  if (c === 'electricity') return solarOffersFor(a, includeSamples, set);
  const cat = offersFor(c, { zip: a.zip, mobileLines: a.mobile?.lines, mobileDataNeed: a.mobile?.dataNeed, mobileInternational: a.mobile?.international, includeSamples });
  // Where no real plan is on file, the household is compared with Tucker's benchmark
  // (not in sample-data mode, which shows demo offers instead).
  const ctx = { mobileLines: a.mobile?.lines };
  const bench = includeSamples ? {} : { benchmark: benchmarkOffer(c, ctx, set) };
  const assumptions = new Map(bench.benchmark ? [[bench.benchmark.id, benchmarkAssumptions(c, ctx, set)]] : []);
  // With an area catalog, real internet offers come from it (never from the built-in pilot data).
  if (catalog && c === 'internet') return { real: catalog.internet, samples: cat.samples, ...bench, assumptions, notes: !catalog.internet.length && catalog.internetNote ? [catalog.internetNote] : [] };
  return { ...cat, real: catalog ? [] : cat.real, ...bench, assumptions, notes: [] };
}

const kindOf = (status: Candidate['status'], eligible: Candidate['eligible']): OptionKind | null =>
  status === 'sample' ? 'sample' : status === 'benchmark' ? 'benchmark' : (status === 'verified' || status === 'manually_verified') && eligible === true ? 'verified' : (status === 'verified' || status === 'manually_verified') && eligible === 'unknown' ? 'pending_address' : null;

const KIND_RANK: Record<OptionKind, number> = { verified: 3, pending_address: 2, benchmark: 1, sample: 0 };

export function buildAnalysis(a: Assessment, opts: AnalysisOptions): PlatformAnalysis {
  const now = new Date(opts.computedAt);
  const set = opts.benchmarks ?? DEFAULT_BENCHMARKS;
  const scenario = ASSUMPTIONS_V1.escalationScenarios[0];
  const missing: string[] = [];
  const globalNotes: string[] = [];
  const categories: CategoryResult[] = [];
  const services: HouseholdService[] = [];

  for (const c of a.categories) {
    const { streams, notes, provider } = currentStreamsFor(a, c);
    const main = streams[0];
    const comparisonAvailable = true;
    const known = main.baseMonthly !== null;
    if (!known) missing.push(`Your monthly ${CATEGORY_LABEL[c].toLowerCase()} bill`);

    let options: CategoryOption[] = [];
    let lenses: LensResult[] = [];
    let lensKind: OptionKind | null = null;
    const cat = offersForCategory(c, a, opts.includeSamples, opts.catalog, set);
    notes.push(...cat.notes);
    const offerById = new Map([...cat.real, ...(cat.benchmark ? [cat.benchmark] : []), ...cat.samples].map((o) => [o.id, offerSchema.parse(o)]));
    {
      const current: CostStream[] = known ? streams.map((s) => ({ ...s, baseMonthly: s.baseMonthly as Cents })) : [];
      const rankOf = (offers: Offer[], usable?: Candidate['status'][]) =>
        rankOffers({ current, offers, replaces: () => MAIN(c), ctx: { zip: a.zip, facts: c === 'electricity' ? SOLAR_FACT_SET : undefined }, now, horizonMonths: 60, scenario, usableStatuses: usable });
      const real = cat.real.length ? rankOf(cat.real) : null;
      const samples = cat.samples.length ? rankOf(cat.samples, ['sample']) : null;
      // The benchmark only fills in when no real plan can be shown for this household.
      const realUsable = real ? [...real.recommendable, ...real.needsVerification].some((x) => kindOf(x.status, x.eligible)) : false;
      const bench = cat.benchmark && known && !realUsable ? rankOf([cat.benchmark], ['benchmark']) : null;
      for (const cand of [...(real ? [...real.recommendable, ...real.needsVerification] : []), ...(bench ? bench.recommendable : []), ...(samples ? samples.recommendable : [])]) {
        const kind = kindOf(cand.status, cand.eligible);
        if (!kind) continue;
        const offer = offerById.get(cand.offerId)!;
        const assumptions = cat.assumptions.get(cand.offerId) ?? [];
        options.push({
          offerId: cand.offerId,
          planName: cand.planName,
          kind,
          candidate: cand,
          monthlyPrice: firstMonthPrice(offer),
          restrictions: offer.restrictions,
          disclosureUrl: offer.disclosureUrl,
          estimate: assumptions.length > 0,
          assumptions,
        });
      }
      // Strongest evidence first, then cheapest; equal price → faster plan (same rule as the lenses).
      options = options.sort(
        (x, y) =>
          KIND_RANK[y.kind] - KIND_RANK[x.kind] ||
          x.candidate.proposedTotal - y.candidate.proposedTotal ||
          (y.candidate.downloadMbps ?? 0) - (x.candidate.downloadMbps ?? 0) ||
          x.offerId.localeCompare(y.offerId),
      );
      if (real?.recommendable.length) [lenses, lensKind] = [real.lenses, 'verified'];
      else if (real?.provisionalLenses.some((l) => l.offerId)) [lenses, lensKind] = [real.provisionalLenses, 'pending_address'];
      else if (bench?.recommendable.length) [lenses, lensKind] = [bench.lenses, 'benchmark'];
      else if (samples?.recommendable.length) [lenses, lensKind] = [samples.lenses, 'sample'];
      if (!options.length && c !== 'electricity' && !cat.notes.length)
        notes.push(opts.includeSamples ? 'No alternatives found for this service.' : 'We don’t have verified prices to compare for this service in your area yet. An advisor can review this bill for you, free.');
    }

    // Default selection: the lowest-cost option, but only if it actually costs less.
    const lowest = lenses.find((l) => l.lens === 'lowest_cost')?.offerId ?? null;
    const lowestCand = options.find((o) => o.offerId === lowest)?.candidate;
    const requested = opts.selections?.[c];
    // With nothing verified to compare, the helpful default is a free advisor review of the bill
    // (not for electricity when solar can't apply — there is nothing an advisor could offer).
    const reviewable = c !== 'electricity' || cat.solar === 'advisor' || cat.solar === 'needs_info';
    const validRequest = requested === 'keep' || (requested === 'review' && reviewable) || options.some((o) => o.offerId === requested);
    const selected = validRequest ? requested! : known && lowestCand && lowestCand.savingsTotal > 0 ? lowest! : !options.length && reviewable ? 'review' : 'keep';
    const chosen = options.find((o) => o.offerId === selected);

    categories.push({
      category: c,
      label: CATEGORY_LABEL[c],
      currentMonthly: main.baseMonthly === null ? null : todayMonthly(streams),
      provider,
      options,
      lenses,
      lensKind,
      selected,
      notes,
      insights: insightsFor(a, c),
      comparisonAvailable,
      ...(cat.solar ? { solar: cat.solar } : {}),
    });

    // Household services (for the projection).
    streams.forEach((s, i) => {
      if (i === 0 && chosen) {
        const offer = toStream(offerById.get(selected)!, chosen.kind);
        services.push({ current: s, action: { type: 'replace', with: offer } });
      } else services.push({ current: s, action: { type: 'keep' } });
    });
  }

  if (categories.some((c) => c.options.some((o) => o.kind === 'benchmark'))) {
    globalNotes.push(`Where we have no real plan on file for your home, savings are an illustrative preview against Tucker’s comparison benchmarks. ${BENCHMARK_DISCLOSURE}`);
  }
  if (categories.some((c) => c.options.some((o) => o.estimate && o.kind !== 'benchmark'))) {
    globalNotes.push(
      'Solar figures are estimates, not quotes. Real savings depend on a site assessment, your actual usage, future utility rates and the final contract. No tax credits or incentives are included.',
    );
  }

  const selectedOption = (c: CategoryResult) => c.options.find((o) => o.offerId === c.selected);
  const selectedKinds = categories.flatMap((c) => selectedOption(c)?.kind ?? []);
  const projectionBasis: PlatformAnalysis['projectionBasis'] = selectedKinds.length
    ? selectedKinds.reduce((w, k) => (KIND_RANK[k] < KIND_RANK[w] ? k : w), 'verified' as OptionKind)
    : 'current_only';

  if (missing.length || !services.length) {
    return {
      version: ANALYSIS_VERSION,
      assumptionsVersion: ASSUMPTIONS_V1.version,
      computedAt: opts.computedAt,
      includeSamples: opts.includeSamples,
      status: 'incomplete',
      missing: services.length ? missing : [...missing, 'At least one service with a monthly cost'],
      zip: a.zip,
      categories,
      household: null,
      projectionBasis,
      opportunities: [],
      ...(opts.catalog ? { catalog: opts.catalog } : {}),
      benchmarks: set,
      notes: globalNotes,
    };
  }

  const household = analyzeHousehold(services, { horizonMonths: 120 });
  if (household.status !== 'complete') throw new Error('Unexpected incomplete household analysis');

  const opportunities = categories
    .flatMap((c) => {
      const o = selectedOption(c);
      return o ? [{ category: c.category, label: c.label, monthlySavings: o.candidate.steadyMonthlySavings, kind: o.kind }] : [];
    })
    .filter((o) => o.monthlySavings > 0)
    .sort((x, y) => y.monthlySavings - x.monthlySavings);

  return {
    version: ANALYSIS_VERSION,
    assumptionsVersion: household.assumptionsVersion,
    computedAt: opts.computedAt,
    includeSamples: opts.includeSamples,
    status: 'complete',
    missing: [],
    zip: a.zip,
    categories,
    household,
    projectionBasis,
    opportunities,
    ...(opts.catalog ? { catalog: opts.catalog } : {}),
      benchmarks: set,
    notes: [...globalNotes, ...household.notes],
  };
}

/** Facts from the household's own answers — arithmetic only, never outside prices or guesses. */
function insightsFor(a: Assessment, c: PlatformCategory): string[] {
  const out: string[] = [];
  const yr = (monthly: Cents) => formatCents(monthly * 12, { cents: false });
  if (c === 'internet' && a.internet) {
    const i = a.internet;
    if (i.equipmentFeeCents) out.push(`Equipment rental costs you ${yr(i.equipmentFeeCents)} a year.`);
    if (i.monthlyCents !== null && i.promoRegularCents !== null && i.promoRegularCents > i.monthlyCents && PROMO_MONTHS[i.promoEnds] !== null) {
      out.push(`When your promotion ends, this bill goes up ${formatCents(i.promoRegularCents - i.monthlyCents, { cents: false })} a month (${yr(i.promoRegularCents - i.monthlyCents)} a year).`);
    }
    if (i.contractMonthsRemaining > 0) out.push(`You have about ${i.contractMonthsRemaining} month${i.contractMonthsRemaining === 1 ? '' : 's'} left on your contract${i.earlyTerminationCents ? `; leaving early costs ${formatCents(i.earlyTerminationCents, { cents: false })}` : ''}.`);
  }
  if (c === 'mobile' && a.mobile?.monthlyCents) {
    const m = a.mobile;
    if (m.lines > 1) out.push(`That’s ${formatCents(divRound(m.monthlyCents as Cents, m.lines))} per line for ${m.lines} lines.`);
    if (m.deviceFinancingCents) out.push(`Phone payments add ${formatCents(m.deviceFinancingCents, { cents: false })} a month on top (not part of the plan comparison).`);
  }
  if (c === 'tv' && a.tv) {
    const t = a.tv;
    if (t.equipmentFeeCents) out.push(`TV boxes and DVR cost you ${yr(t.equipmentFeeCents)} a year.`);
    if (t.monthlyCents !== null && t.otherStreamingCents) out.push(`With your other subscriptions, TV and streaming total ${formatCents(t.monthlyCents + (t.equipmentFeeCents ?? 0) + t.otherStreamingCents, { cents: false })} a month.`);
  }
  if (c === 'electricity' && a.electricity?.monthlyCents) out.push(`Electricity costs you about ${yr(a.electricity.monthlyCents)} a year at today’s rates.`);
  return out;
}

/** What the plan costs in its first month: the (promotional) rate plus recurring charges that start right away. */
function firstMonthPrice(offer: ReturnType<typeof offerSchema.parse>): Cents {
  const base = offer.pricing.promotion?.monthlyRate ?? offer.pricing.baseMonthly;
  return base + offer.pricing.recurring.filter((r) => r.startMonth === 0).reduce((sum, r) => sum + r.monthly, 0);
}

/** Today's monthly total for a category's streams (base + recurring, before promos end). */
function todayMonthly(streams: HouseholdService['current'][]): Cents {
  return streams.reduce((sum, s) => sum + (s.promotion?.monthlyRate ?? (s.baseMonthly ?? 0)) + (s.recurring ?? []).reduce((a, r) => a + r.monthly, 0), 0);
}

function toStream(offer: ReturnType<typeof offerSchema.parse>, kind: OptionKind): CostStream {
  return {
    ...offer.pricing,
    id: offer.id,
    label: offer.planName,
    category: offer.category as Category,
    // Real prices are manually verified even when availability at the address isn't confirmed yet;
    // household-specific estimates (solar) stay estimates.
    quality: kind === 'sample' || kind === 'benchmark' || offer.pricing.quality === 'estimated' ? 'estimated' : 'manually_verified',
  };
}
