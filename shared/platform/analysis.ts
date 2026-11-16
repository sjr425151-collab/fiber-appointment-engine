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

export const ANALYSIS_VERSION = `analysis-1/${CATALOG_VERSION}`;
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
  /** Electricity/solar: not compared (legal review pending). */
  comparisonAvailable: boolean;
}

export interface SolarScreening {
  outcome: 'not_applicable' | 'unlikely' | 'worth_a_conversation';
  reasons: string[];
}

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
  solar: SolarScreening | null;
  notes: string[];
}

const MAIN = (c: PlatformCategory) => `current-${c}`;

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
      notes.push('Electricity is included in your spending, but we don’t compare electricity offers yet.');
      return {
        streams: [{ id: MAIN(c), label: e.utility ? `${e.utility} electricity` : 'Electricity', category: 'electricity', baseMonthly: e.monthlyCents, quality: 'user_reported', escalates: true }],
        notes,
        provider: e.utility,
      };
    }
    case 'solar':
      return { streams: [], notes, provider: '' };
  }
}

export function screenSolar(a: Assessment): SolarScreening | null {
  if (!a.categories.includes('solar') || !a.solar) return null;
  const s = a.solar;
  if (s.homeownership === 'rent') return { outcome: 'not_applicable', reasons: ['Rooftop solar generally requires owning the home (or the owner’s permission).'] };
  if (s.roofSun === 'heavy_shade') return { outcome: 'unlikely', reasons: ['Heavily shaded roofs usually produce too little energy for rooftop solar to make sense.'] };
  return {
    outcome: 'worth_a_conversation',
    reasons: [
      'You own your home and your roof may get enough sun.',
      'We don’t estimate solar savings yet — a real estimate needs your usage history, roof details and current incentives.',
    ],
  };
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
    if (c === 'solar') continue;
    const { streams, notes, provider } = currentStreamsFor(a, c);
    const main = streams[0];
    const comparisonAvailable = c !== 'electricity';
    const known = main.baseMonthly !== null;
    if (!known) missing.push(`Your monthly ${CATEGORY_LABEL[c].toLowerCase()} bill`);

    let options: CategoryOption[] = [];
    let lenses: LensResult[] = [];
    let lensKind: OptionKind | null = null;
    if (comparisonAvailable) {
      const cat = offersFor(c, {
        zip: a.zip,
        mobileLines: a.mobile?.lines,
        mobileDataNeed: a.mobile?.dataNeed,
        mobileInternational: a.mobile?.international,
        includeSamples: opts.includeSamples,
      });
      const current: CostStream[] = known ? streams.map((s) => ({ ...s, baseMonthly: s.baseMonthly as Cents })) : [];
      const rankOf = (offers: Offer[], usable?: Candidate['status'][]) =>
        rankOffers({ current, offers, replaces: () => MAIN(c), ctx: { zip: a.zip }, now, horizonMonths: 60, scenario, usableStatuses: usable });
      const real = cat.real.length ? rankOf(cat.real) : null;
      const samples = cat.samples.length ? rankOf(cat.samples, ['sample']) : null;
      const byId = new Map([...cat.real, ...cat.samples].map((o) => [o.id, offerSchema.parse(o)]));
      for (const cand of [...(real ? [...real.recommendable, ...real.needsVerification] : []), ...(samples ? samples.recommendable : [])]) {
        const kind = kindOf(cand.status, cand.eligible);
        if (!kind) continue;
        const offer = byId.get(cand.offerId)!;
        options.push({
          offerId: cand.offerId,
          planName: cand.planName,
          kind,
          candidate: cand,
          monthlyPrice: offer.pricing.promotion?.monthlyRate ?? offer.pricing.baseMonthly,
          restrictions: offer.restrictions,
          disclosureUrl: offer.disclosureUrl,
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
      if (!options.length) notes.push(opts.includeSamples ? 'No alternatives found for this service.' : 'We don’t have verified alternatives for this service in your area yet — an advisor can check for you.');
    }

    // Default selection: the lowest-cost option, but only if it actually costs less.
    const lowest = lenses.find((l) => l.lens === 'lowest_cost')?.offerId ?? null;
    const lowestCand = options.find((o) => o.offerId === lowest)?.candidate;
    const requested = opts.selections?.[c];
    const validRequest = requested === 'keep' || options.some((o) => o.offerId === requested);
    const selected = validRequest ? requested! : known && lowestCand && lowestCand.savingsTotal > 0 ? lowest! : 'keep';

    categories.push({ category: c, label: CATEGORY_LABEL[c], currentMonthly: main.baseMonthly === null ? null : todayMonthly(streams), provider, options, lenses, lensKind, selected, notes, comparisonAvailable });

    // Household services (for the projection).
    streams.forEach((s, i) => {
      if (i === 0 && selected !== 'keep') {
        const offer = byIdFromOptions(options, selected, c, a, opts);
        services.push({ current: s, action: { type: 'replace', with: offer } });
      } else services.push({ current: s, action: { type: 'keep' } });
    });
  }

  const solar = screenSolar(a);
  if (a.categories.includes('electricity')) globalNotes.push('Energy comparisons are not offered yet while we complete a regulatory review.');

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
      solar,
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
    solar,
    notes: [...globalNotes, ...household.notes],
  };
}

/** Today's monthly total for a category's streams (base + recurring, before promos end). */
function todayMonthly(streams: HouseholdService['current'][]): Cents {
  return streams.reduce((sum, s) => sum + (s.promotion?.monthlyRate ?? (s.baseMonthly ?? 0)) + (s.recurring ?? []).reduce((a, r) => a + r.monthly, 0), 0);
}

function byIdFromOptions(options: CategoryOption[], id: string, c: PlatformCategory, a: Assessment, opts: AnalysisOptions): CostStream {
  const cat = offersFor(c, { zip: a.zip, mobileLines: a.mobile?.lines, mobileDataNeed: a.mobile?.dataNeed, mobileInternational: a.mobile?.international, includeSamples: opts.includeSamples });
  const offer = offerSchema.parse([...cat.real, ...cat.samples].find((o) => o.id === id));
  const kind = options.find((o) => o.offerId === id)!.kind;
  return {
    ...offer.pricing,
    id: offer.id,
    label: offer.planName,
    category: offer.category as Category,
    // Real prices are manually verified even when availability at the address isn't confirmed yet.
    quality: kind === 'sample' ? 'estimated' : 'manually_verified',
  };
}
