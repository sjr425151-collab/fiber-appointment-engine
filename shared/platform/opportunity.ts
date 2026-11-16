/**
 * Opportunities: what a household asked for help with, one per service, as the
 * customer selected it on the results page. Derived deterministically from the
 * analysis (never typed by hand), stored when the customer asks for help, then
 * worked by the team through a simple status pipeline.
 */
import type { Cents } from '../finance/money';
import type { OptionKind, PlatformAnalysis } from './analysis';

export const OPPORTUNITY_STATUSES = ['new', 'contacted', 'quoted', 'won', 'lost', 'not_eligible'] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export const OPPORTUNITY_STATUS_LABEL: Record<OpportunityStatus, string> = {
  new: 'New',
  contacted: 'Contacted',
  quoted: 'Quoted',
  won: 'Won',
  lost: 'Lost',
  not_eligible: 'Not eligible',
};

/**
 * - verified / pending_address / sample: an option the customer selected
 * - advisor: help requested without a priced option (e.g. solar with no program terms on file)
 */
export type OpportunityKind = OptionKind | 'advisor';

export interface OpportunityDraft {
  /** A platform category, or "household" for a general review. */
  category: string;
  offerId: string;
  planName: string;
  kind: OpportunityKind;
  /** True when the price depends on assumptions about the household (solar). */
  estimate: boolean;
  currentMonthlyCents: Cents | null;
  /** First-month price of the selected option. */
  proposedMonthlyCents: Cents | null;
  /** Steady-state monthly savings (no price increases). Negative = costs more. */
  monthlySavingsCents: Cents | null;
  /** Five-year difference, no price increases. */
  fiveYearSavingsCents: Cents | null;
}

/** What to record when a household asks for help, from the analysis computed with its own selections. */
export function opportunitiesFrom(analysis: PlatformAnalysis): OpportunityDraft[] {
  const out: OpportunityDraft[] = [];
  for (const c of analysis.categories) {
    const o = c.options.find((x) => x.offerId === c.selected);
    if (o) {
      out.push({
        category: c.category,
        offerId: o.offerId,
        planName: o.planName,
        kind: o.kind,
        estimate: !!o.estimate,
        currentMonthlyCents: c.currentMonthly,
        proposedMonthlyCents: o.monthlyPrice,
        monthlySavingsCents: o.candidate.steadyMonthlySavings,
        fiveYearSavingsCents: o.candidate.savingsTotal,
      });
    } else if (c.category === 'electricity' && c.solar === 'advisor') {
      // The household may benefit from solar, but no program pricing is on file: an advisor quotes it.
      out.push({
        category: c.category,
        offerId: '',
        planName: 'Solar estimate requested',
        kind: 'advisor',
        estimate: true,
        currentMonthlyCents: c.currentMonthly,
        proposedMonthlyCents: null,
        monthlySavingsCents: null,
        fiveYearSavingsCents: null,
      });
    }
  }
  if (!out.length) {
    out.push({
      category: 'household',
      offerId: '',
      planName: 'Review of household bills',
      kind: 'advisor',
      estimate: false,
      currentMonthlyCents: analysis.household?.currentMonthly ?? null,
      proposedMonthlyCents: null,
      monthlySavingsCents: null,
      fiveYearSavingsCents: null,
    });
  }
  return out;
}
