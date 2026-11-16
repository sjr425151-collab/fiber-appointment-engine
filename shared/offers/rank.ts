/**
 * Recommendation lenses. Ranking is commission-blind by construction: its
 * inputs are offers, the household's current cost and eligibility results —
 * provider partnership/compensation data is not a parameter and can't affect
 * the order. Each lens returns its criteria as text so the UI can show
 * "why this is ranked first".
 */
import { compareScenarios, ASSUMPTIONS_V1, type CostStream, type EscalationScenario } from '../finance/engine';
import { divRound, sum } from '../finance/money';
import { checkEligibility, offerSchema, publicStatus, type HouseholdContext, type Offer, type PublicStatus } from './model';

export interface Candidate {
  offerId: string;
  planName: string;
  providerId: string;
  status: PublicStatus;
  statusReasons: string[];
  eligible: boolean | 'unknown';
  eligibilityReasons: string[];
  downloadMbps: number | null;
  contractMonths: number;
  requirements: number;
  /** Totals over the comparison horizon under the chosen scenario. */
  proposedTotal: number;
  savingsTotal: number;
  upfrontSwitchingCost: number;
  steadyMonthlyCost: number;
  breakEvenMonths: number | null;
}

export interface LensResult {
  lens: 'lowest_cost' | 'best_value' | 'highest_performance' | 'lowest_friction';
  criteria: string;
  offerId: string | null;
}

export interface Ranking {
  horizonMonths: number;
  scenarioId: string;
  /** Verified or manually verified, and eligible (not merely "unknown"). */
  recommendable: Candidate[];
  /** Plausible but needs address confirmation or data verification — shown separately, never as a recommendation. */
  needsVerification: Candidate[];
  /** Not eligible or unavailable, with reasons. */
  excluded: Candidate[];
  lenses: LensResult[];
}

export function rankOffers(o: {
  current: CostStream[];
  offers: Offer[];
  /** Which current stream each offer would replace (by category). */
  replaces: (offer: Offer) => string | null;
  ctx: HouseholdContext;
  now: Date;
  horizonMonths?: number;
  scenario?: EscalationScenario;
}): Ranking {
  const horizonMonths = o.horizonMonths ?? 60;
  const scenario = o.scenario ?? ASSUMPTIONS_V1.escalationScenarios[0];

  const candidates: Candidate[] = o.offers.map((input) => {
    const offer = offerSchema.parse(input);
    const status = publicStatus(offer, o.now);
    const elig = checkEligibility(offer, o.ctx);
    const replacedId = o.replaces(input);
    const proposedStream: CostStream = { ...offer.pricing, id: offer.id, label: offer.planName, category: offer.category };
    const proposed = [...o.current.filter((s) => s.id !== replacedId), proposedStream];
    const replaced = o.current.find((s) => s.id === replacedId);
    const c = compareScenarios({
      current: o.current,
      proposed,
      horizonMonths,
      scenario,
      facts: o.ctx.facts,
      switchingCosts: replaced?.earlyTermination
        ? [{ kind: 'early_termination', label: `Early termination: ${replaced.label}`, amount: earlyTermination(replaced), month: 0 }]
        : [],
    });
    const last12 = c.months.slice(-12);
    return {
      offerId: offer.id,
      planName: offer.planName,
      providerId: offer.providerId,
      status: status.status,
      statusReasons: status.reasons,
      eligible: elig.eligible,
      eligibilityReasons: elig.reasons,
      downloadMbps: offer.attributes.downloadMbps ?? null,
      contractMonths: offer.contractMonths,
      requirements: offer.eligibility.requires.length,
      proposedTotal: c.totals.proposed,
      savingsTotal: c.totals.savings,
      upfrontSwitchingCost: c.upfrontSwitchingCost,
      steadyMonthlyCost: divRound(sum(last12.map((m) => m.proposed)), Math.max(1, last12.length)),
      breakEvenMonths: c.breakEvenMonths,
    };
  });

  const usable = (c: Candidate) => c.status === 'verified' || c.status === 'manually_verified';
  const recommendable = candidates.filter((c) => usable(c) && c.eligible === true);
  const needsVerification = candidates.filter(
    (c) => c.eligible !== false && c.status !== 'unavailable' && !recommendable.includes(c),
  );
  const excluded = candidates.filter((c) => !recommendable.includes(c) && !needsVerification.includes(c));

  const pick = (list: Candidate[], better: (a: Candidate, b: Candidate) => number) => [...list].sort(better)[0]?.offerId ?? null;
  // Equal cost → prefer the faster plan, then a stable id order (deterministic).
  const byCost = (a: Candidate, b: Candidate) =>
    a.proposedTotal - b.proposedTotal || (b.downloadMbps ?? 0) - (a.downloadMbps ?? 0) || a.offerId.localeCompare(b.offerId);
  const lenses: LensResult[] = [
    {
      lens: 'lowest_cost',
      criteria: `Lowest total household cost over ${horizonMonths} months, including fees, promotions ending and switching costs; ties go to the faster plan.`,
      offerId: pick(recommendable, byCost),
    },
    {
      lens: 'best_value',
      criteria: 'Most download speed per dollar of the ongoing monthly price, among plans that cost no more than you pay today over the period.',
      offerId: pick(
        recommendable.filter((c) => c.downloadMbps !== null && c.savingsTotal >= 0 && c.steadyMonthlyCost > 0),
        (a, b) => b.downloadMbps! / b.steadyMonthlyCost - a.downloadMbps! / a.steadyMonthlyCost || byCost(a, b),
      ),
    },
    {
      lens: 'highest_performance',
      criteria: 'Fastest advertised download speed; ties go to the lower total cost.',
      offerId: pick(
        recommendable.filter((c) => c.downloadMbps !== null),
        (a, b) => b.downloadMbps! - a.downloadMbps! || byCost(a, b),
      ),
    },
    {
      lens: 'lowest_friction',
      criteria: 'Lowest upfront switching cost, then shortest contract, then fewest requirements.',
      offerId: pick(
        recommendable,
        (a, b) => a.upfrontSwitchingCost - b.upfrontSwitchingCost || a.contractMonths - b.contractMonths || a.requirements - b.requirements || byCost(a, b),
      ),
    },
  ];
  return { horizonMonths, scenarioId: scenario.id, recommendable, needsVerification, excluded, lenses };
}

function earlyTermination(s: CostStream): number {
  const e = s.earlyTermination;
  if (!e) return 0;
  if (e.kind === 'flat') return e.amount;
  const fee = e.perMonth * e.monthsRemaining;
  return e.cap !== undefined ? Math.min(fee, e.cap) : fee;
}
