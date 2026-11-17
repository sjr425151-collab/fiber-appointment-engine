/**
 * Commission rules and earnings states. Integer cents and basis points only.
 *
 * A rule says what the provider is expected to pay Tucker for an order (the
 * base) and what the representative and their manager receive. Rules are
 * effective-dated and never edited: a change is a new rule and an end date on
 * the old one, so past orders always reconcile against the rule that applied.
 */
import type { Cents } from '../finance/money';

export interface CommissionRule {
  id: string;
  name: string;
  /** '' matches every category. */
  category: string;
  providerId: string | null;
  productId: string | null;
  /** Expected provider payment: a flat amount, or a share of the first month's price. */
  kind: 'flat' | 'percent_first_month';
  amountCents: Cents;
  percentBps: number;
  /** Representative payout: a flat amount plus a share of the base. */
  repAmountCents: Cents;
  repShareBps: number;
  managerOverrideCents: Cents;
  /** When the representative's commission becomes earned. */
  trigger: 'submitted' | 'activated';
  effectiveFrom: string; // YYYY-MM-DD, inclusive
  effectiveTo: string | null; // YYYY-MM-DD, inclusive
}

export interface RuleTarget {
  category: string;
  providerId: string | null;
  productId: string | null;
  /** The date the rule must cover (the order's submission date, or today for an estimate). */
  on: string;
}

const covers = (r: CommissionRule, t: RuleTarget) =>
  r.effectiveFrom <= t.on &&
  (r.effectiveTo === null || t.on <= r.effectiveTo) &&
  (r.category === '' || r.category === t.category) &&
  (r.providerId === null || r.providerId === t.providerId) &&
  (r.productId === null || r.productId === t.productId);

const specificity = (r: CommissionRule) => (r.productId ? 4 : 0) + (r.providerId ? 2 : 0) + (r.category ? 1 : 0);

/** The single rule that applies: the most specific, then the most recent, then by id (never ambiguous). */
export function matchRule(rules: CommissionRule[], t: RuleTarget): CommissionRule | null {
  const [best] = rules.filter((r) => covers(r, t)).sort((a, b) => specificity(b) - specificity(a) || b.effectiveFrom.localeCompare(a.effectiveFrom) || a.id.localeCompare(b.id));
  return best ?? null;
}

const share = (amount: Cents, bps: number): Cents => Math.round((amount * bps) / 10_000);

export interface CommissionAmounts {
  /** What the provider is expected to pay Tucker. Not revenue until received. */
  expectedProviderCents: Cents;
  repCents: Cents;
  managerCents: Cents;
}

export function commissionFor(rule: CommissionRule, monthlyPriceCents: Cents | null): CommissionAmounts {
  const base = rule.kind === 'flat' ? rule.amountCents : share(monthlyPriceCents ?? 0, rule.percentBps);
  return { expectedProviderCents: base, repCents: rule.repAmountCents + share(base, rule.repShareBps), managerCents: rule.managerOverrideCents };
}

/**
 * - projected: an estimate while the order is still being prepared
 * - pending:   the order is with the provider
 * - earned:    the rule's condition is met (activation, or submission where the rule says so)
 * - approved:  an admin checked it
 * - payable:   it is in an approved payout batch
 * - paid:      the batch was recorded as paid, with a payment reference
 * - reversed:  the order fell through before payment (after payment, a separate negative chargeback entry is made)
 */
export const EARNING_STATES = ['projected', 'pending', 'earned', 'approved', 'payable', 'paid', 'reversed'] as const;
export type EarningState = (typeof EARNING_STATES)[number];
export const EARNING_STATE_LABEL: Record<EarningState, string> = {
  projected: 'Projected (estimate)',
  pending: 'Pending',
  earned: 'Earned',
  approved: 'Approved',
  payable: 'Payable',
  paid: 'Paid',
  reversed: 'Reversed',
};
export const EARNING_KINDS = ['rep_commission', 'manager_override', 'bonus', 'adjustment', 'chargeback'] as const;
export type EarningKind = (typeof EARNING_KINDS)[number];
export const EARNING_KIND_LABEL: Record<EarningKind, string> = { rep_commission: 'Commission', manager_override: 'Manager override', bonus: 'Bonus', adjustment: 'Adjustment', chargeback: 'Chargeback' };

/** The state an order-linked commission should be in for an order status, before any admin approval. */
export function earningStateForOrder(orderStatus: string, trigger: CommissionRule['trigger']): EarningState {
  if (['rejected', 'canceled', 'reversed'].includes(orderStatus)) return 'reversed';
  if (['activated', 'completed'].includes(orderStatus)) return 'earned';
  if (['submitted', 'provider_pending', 'installation_scheduled', 'activation_pending'].includes(orderStatus)) return trigger === 'submitted' ? 'earned' : 'pending';
  return 'projected';
}

/** States an admin has already acted on: order changes never silently overwrite them. */
export const SETTLED_STATES: EarningState[] = ['approved', 'payable', 'paid'];
