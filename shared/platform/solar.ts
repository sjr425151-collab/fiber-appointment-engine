/**
 * Rooftop solar as the household's electricity alternative.
 *
 * A solar program is defined by its contract terms (price per kWh produced,
 * annual escalator, term, upfront cost) plus the assumptions needed to turn a
 * household's electric bill into an estimate (share of usage covered, the
 * utility's fixed monthly charge, and — only when the household didn't give
 * its kWh — an average utility rate). Each household gets its own alternative
 * cost stream:
 *
 *   remaining utility bill = fixed charge + (bill − fixed charge) × (1 − covered share)
 *   solar payment          = monthly kWh × covered share × program rate
 *
 * The remaining utility bill rises with the price-increase scenario; the solar
 * payment follows its contract escalator. All maths is integer cents.
 *
 * Results are ALWAYS estimates (`quality: 'estimated'`): real savings depend on
 * a site assessment (roof, shading, system size) and the final contract.
 * No incentive or tax credit is assumed.
 */
import { divRound, type Cents } from '../finance/money';
import type { Offer, Provenance } from '../offers/model';

export interface SolarProgram {
  id: string;
  providerId: string;
  planName: string;
  /** Contract price per kWh the system produces, in thousandths of a cent (12.5¢ = 12_500). */
  milliCentsPerKwh: number;
  /** Contractual annual payment increase in basis points (2.9% = 290). */
  escalatorBps: number;
  termMonths: number;
  upfrontCents: Cents;
  /** Design assumption: share of the household's usage the system covers (90% = 9000). */
  offsetBps: number;
  /** The utility's fixed monthly customer charge that remains after going solar. */
  utilityFixedChargeCents: Cents;
  /** Average utility price per kWh (thousandths of a cent), used only to estimate kWh from the bill. */
  utilityRateMilliCentsPerKwh: number;
  geography: Offer['geography'];
  provenance: Provenance;
  restrictions: string[];
  disclosureUrl?: string;
}

/**
 * Real solar programs. Intentionally empty until the owner supplies verified
 * contract terms (rate, escalator, term, upfront cost, service area). Until
 * then production shows an advisor hand-off for solar, never a number.
 */
export const SOLAR_PROGRAMS: SolarProgram[] = [];

/** Staging-only sample (labelled "Sample data" everywhere; refused in production). */
export const SAMPLE_SOLAR_PROGRAMS: SolarProgram[] = [
  {
    id: 'sample-solar-ppa',
    providerId: 'sample-solar-co',
    planName: 'Sample Solar Agreement (25 years)',
    milliCentsPerKwh: 12_500,
    escalatorBps: 290,
    termMonths: 300,
    upfrontCents: 0,
    offsetBps: 9000,
    utilityFixedChargeCents: 900,
    utilityRateMilliCentsPerKwh: 19_000,
    geography: { zips: [], marketIds: [], nationwide: true },
    provenance: {
      sourceType: 'sample',
      reference: 'Illustrative sample created for staging — not a real offer',
      recordedBy: 'platform team',
      verifiedAt: '2026-11-16T00:00:00Z',
      review: 'estimated',
      gaps: ['Not a real offer', 'Assumed share of usage covered and utility charges'],
    },
    restrictions: ['Illustrative only', 'Requires a site assessment', 'Payment rises 2.9% a year'],
  },
];

export interface SolarHousehold {
  /** Current monthly electric bill, cents. */
  billCents: Cents;
  /** Monthly usage if the household knows it. */
  monthlyKwh: number | null;
}

export interface SolarEstimate {
  monthlyKwh: number;
  kwhEstimated: boolean;
  coveredKwh: number;
  solarPayment: Cents;
  remainingUtility: Cents;
  /** First-month total under the estimate (remaining utility + solar payment). */
  newMonthly: Cents;
}

/** Pure, deterministic first-month estimate for one program and household. */
export function estimateSolar(p: SolarProgram, h: SolarHousehold): SolarEstimate {
  const fixed = Math.min(p.utilityFixedChargeCents, h.billCents);
  const variable = h.billCents - fixed;
  const kwhEstimated = h.monthlyKwh === null || h.monthlyKwh === 0;
  // cents × 1000 / (thousandths of a cent per kWh) = kWh
  const monthlyKwh = kwhEstimated ? divRound(variable * 1000, p.utilityRateMilliCentsPerKwh) : (h.monthlyKwh as number);
  const coveredKwh = divRound(monthlyKwh * p.offsetBps, 10_000);
  const solarPayment = divRound(coveredKwh * p.milliCentsPerKwh, 1000);
  const remainingUtility = fixed + divRound(variable * (10_000 - p.offsetBps), 10_000);
  return { monthlyKwh, kwhEstimated, coveredKwh, solarPayment, remainingUtility, newMonthly: remainingUtility + solarPayment };
}

/** Household facts solar eligibility depends on. */
export const SOLAR_FACTS = { homeowner: 'homeowner', roof: 'roof_suitable' } as const;

/** The household-specific alternative, expressed as an ordinary offer so it ranks and projects like any other. */
export function solarOffer(p: SolarProgram, h: SolarHousehold): { offer: Offer; estimate: SolarEstimate } {
  const e = estimateSolar(p, h);
  const offer: Offer = {
    id: p.id,
    providerId: p.providerId,
    category: 'electricity',
    planName: p.planName,
    attributes: {},
    pricing: {
      // What's left of the utility bill; follows the utility price scenario.
      baseMonthly: e.remainingUtility,
      escalates: true,
      recurring: [{ label: 'Solar payment (estimated)', monthly: e.solarPayment, months: p.termMonths, escalatorBps: p.escalatorBps }],
      oneTime: p.upfrontCents > 0 ? [{ kind: 'other', label: 'Upfront solar cost', amount: p.upfrontCents, month: 0 }] : [],
      quality: 'estimated',
    },
    contractMonths: p.termMonths,
    geography: p.geography,
    eligibility: { requires: [SOLAR_FACTS.homeowner, SOLAR_FACTS.roof], newCustomersOnly: false },
    provenance: p.provenance,
    restrictions: p.restrictions,
    disclosureUrl: p.disclosureUrl,
  };
  return { offer, estimate: e };
}

/** Plain-language assumptions shown next to every solar estimate. */
export function solarAssumptions(p: SolarProgram, e: SolarEstimate): string[] {
  const pct = (bps: number) => `${(bps / 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
  const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
  return [
    `Assumes the system covers ${pct(p.offsetBps)} of your usage (${e.coveredKwh.toLocaleString('en-US')} of ${e.monthlyKwh.toLocaleString('en-US')} kWh a month${e.kwhEstimated ? ', estimated from your bill' : ''}).`,
    `Solar price ${(p.milliCentsPerKwh / 1000).toFixed(1)}¢ per kWh, rising ${pct(p.escalatorBps)} a year, for ${Math.round(p.termMonths / 12)} years.`,
    `You keep paying the utility's fixed charge (assumed ${dollars(p.utilityFixedChargeCents)}/month) and any usage solar doesn't cover.`,
    'No tax credits or incentives are included. A site assessment sets the real system size and price.',
  ];
}
