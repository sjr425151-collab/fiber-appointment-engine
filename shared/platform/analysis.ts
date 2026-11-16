/**
 * Household analysis: assessment answers → cost streams → per-category
 * comparisons → household projection. Pure and deterministic: the server
 * stores the result as an immutable snapshot and the browser re-runs the same
 * function for interactive controls (scenario, horizon, chosen alternative),
 * using the snapshot's `computedAt` so offer freshness can't drift.
 */
import { analyzeHousehold, ASSUMPTIONS_V1, type Category, type CostStream, type HouseholdService, type HouseholdAnalysis } from '../finance/engine';
import type { Cents } from '../finance/money';
import { rankOffers, type Candidate, type LensResult } from '../offers/rank';
import { offerSchema, type Offer } from '../offers/model';
import { CATEGORY_LABEL, PROMO_MONTHS, type Assessment, type PlatformCategory } from './assessment';
import { CATALOG_VERSION, offersFor } from './catalog';
import { SAMPLE_SOLAR_PROGRAMS, SOLAR_FACTS, SOLAR_PROGRAMS, solarAssumptions, solarOffer } from './solar';

export const ANALYSIS_VERSION = `analysis-2/${CATALOG_VERSION}`;
export const HORIZONS = [12, 60, 120] as const;
export type Horizon = (typeof HORIZONS)[number];
export type ScenarioId = 'flat' | 'moderate' | 'high';

/** Per-category choice: an offer id, or "keep" the current service. */
export type Selections = Partial<Record<PlatformCategory, string>>;

export interface AnalysisOptions {
  includeSamples: boolean;
  /** Fixed analysis time (stored with the snapshot) — never "now" during re-computation. */
  computedAt: string;
  selections?: Selections;
}

export type OptionKind = 'verified' | 'pending_address' | 'sample';

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
  /** Option used in the household projection, or 'keep'. */
  selected: string;
  notes: string[];
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
  /** Assumptions per offer id (solar estimates). */
  assumptions: Map<string, string[]>;
  notes: string[];
  solar?: SolarStatus;
}

/** Electricity → household-specific rooftop-solar alternatives. */
function solarOffersFor(a: Assessment, includeSamples: boolean): CategoryOffers {
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
  if (!out.real.length && !out.samples.length) {
    out.notes.push('Solar could lower your electricity costs. We don’t have current solar pricing on file for your area yet — an advisor can prepare a free site-specific estimate.');
  }
  return { ...out, solar: out.real.length || out.samples.length ? 'estimated' : 'advisor' };
}

function offersForCategory(c: PlatformCategory, a: Assessment, includeSamples: boolean): CategoryOffers {
  if (c === 'electricity') return solarOffersFor(a, includeSamples);
  const cat = offersFor(c, { zip: a.zip, mobileLines: a.mobile?.lines, mobileDataNeed: a.mobile?.dataNeed, mobileInternational: a.mobile?.international, includeSamples });
  return { ...cat, assumptions: new Map(), notes: [] };
}

const kindOf = (status: Candidate['status'], eligible: Candidate['eligible']): OptionKind | null =>
  status === 'sample' ? 'sample' : (status === 'verified' || status === 'manually_verified') && eligible === true ? 'verified' : (status === 'verified' || status === 'manually_verified') && eligible === 'unknown' ? 'pending_address' : null;

const KIND_RANK: Record<OptionKind, number> = { verified: 2, pending_address: 1, sample: 0 };

export function buildAnalysis(a: Assessment, opts: AnalysisOptions): PlatformAnalysis {
  const now = new Date(opts.computedAt);
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
    const cat = offersForCategory(c, a, opts.includeSamples);
    notes.push(...cat.notes);
    const offerById = new Map([...cat.real, ...cat.samples].map((o) => [o.id, offerSchema.parse(o)]));
    {
      const current: CostStream[] = known ? streams.map((s) => ({ ...s, baseMonthly: s.baseMonthly as Cents })) : [];
      const rankOf = (offers: Offer[], usable?: Candidate['status'][]) =>
        rankOffers({ current, offers, replaces: () => MAIN(c), ctx: { zip: a.zip, facts: c === 'electricity' ? SOLAR_FACT_SET : undefined }, now, horizonMonths: 60, scenario, usableStatuses: usable });
      const real = cat.real.length ? rankOf(cat.real) : null;
      const samples = cat.samples.length ? rankOf(cat.samples, ['sample']) : null;
      for (const cand of [...(real ? [...real.recommendable, ...real.needsVerification] : []), ...(samples ? samples.recommendable : [])]) {
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
      else if (samples?.recommendable.length) [lenses, lensKind] = [samples.lenses, 'sample'];
      if (!options.length && c !== 'electricity')
        notes.push(opts.includeSamples ? 'No alternatives found for this service.' : 'We don’t have verified alternatives for this service in your area yet — an advisor can check for you.');
    }

    // Default selection: the lowest-cost option, but only if it actually costs less.
    const lowest = lenses.find((l) => l.lens === 'lowest_cost')?.offerId ?? null;
    const lowestCand = options.find((o) => o.offerId === lowest)?.candidate;
    const requested = opts.selections?.[c];
    const validRequest = requested === 'keep' || options.some((o) => o.offerId === requested);
    const selected = validRequest ? requested! : known && lowestCand && lowestCand.savingsTotal > 0 ? lowest! : 'keep';

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
      comparisonAvailable,
      ...(cat.solar ? { solar: cat.solar } : {}),
    });

    // Household services (for the projection).
    streams.forEach((s, i) => {
      if (i === 0 && selected !== 'keep') {
        const offer = toStream(offerById.get(selected)!, options.find((o) => o.offerId === selected)!.kind);
        services.push({ current: s, action: { type: 'replace', with: offer } });
      } else services.push({ current: s, action: { type: 'keep' } });
    });
  }

  if (categories.some((c) => c.options.some((o) => o.estimate))) {
    globalNotes.push(
      'Solar figures are estimates, not quotes. Real savings depend on a site assessment, your actual usage, future utility rates and the final contract. No tax credits or incentives are included.',
    );
  }

  const selectedKinds = categories.filter((c) => c.selected !== 'keep').map((c) => c.options.find((o) => o.offerId === c.selected)!.kind);
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
      notes: globalNotes,
    };
  }

  const household = analyzeHousehold(services, { horizonMonths: 120 });
  if (household.status !== 'complete') throw new Error('Unexpected incomplete household analysis');

  const opportunities = categories
    .filter((c) => c.selected !== 'keep')
    .map((c) => {
      const o = c.options.find((x) => x.offerId === c.selected)!;
      return { category: c.category, label: c.label, monthlySavings: o.candidate.steadyMonthlySavings, kind: o.kind };
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
    notes: [...globalNotes, ...household.notes],
  };
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
    quality: kind === 'sample' || offer.pricing.quality === 'estimated' ? 'estimated' : 'manually_verified',
  };
}
