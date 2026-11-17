/**
 * Opportunity stages and order statuses, with the only moves allowed between
 * them. Pure rules shared by the server (which enforces them) and the team
 * area (which only offers valid next steps).
 *
 * An order never becomes "activated", "completed" or "reversed" without a
 * person with authority recording the provider's confirmation as evidence.
 */
export const ORDER_CATEGORIES = ['internet', 'mobile', 'tv', 'electricity', 'solar'] as const;
export type OrderCategory = (typeof ORDER_CATEGORIES)[number];
export const ORDER_CATEGORY_LABEL: Record<OrderCategory, string> = { internet: 'Home internet', mobile: 'Mobile', tv: 'TV & streaming', electricity: 'Electricity', solar: 'Solar' };

// ------------------------------------------------------------ opportunities --
export const OPPORTUNITY_STAGES = [
  'identified',
  'qualification_pending',
  'qualified',
  'offer_presented',
  'customer_accepted',
  'order_pending',
  'submitted',
  'activated',
  'completed',
  'not_qualified',
  'declined',
  'expired',
  'canceled',
] as const;
export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

export const OPPORTUNITY_STAGE_LABEL: Record<OpportunityStage, string> = {
  identified: 'Identified',
  qualification_pending: 'Qualification pending',
  qualified: 'Qualified',
  offer_presented: 'Offer presented',
  customer_accepted: 'Customer accepted',
  order_pending: 'Order pending',
  submitted: 'Order submitted',
  activated: 'Activated',
  completed: 'Completed',
  not_qualified: 'Not qualified',
  declined: 'Declined',
  expired: 'Expired',
  canceled: 'Canceled',
};

const SALES_STEPS: OpportunityStage[] = ['identified', 'qualification_pending', 'qualified', 'offer_presented', 'customer_accepted'];
const ENDED: OpportunityStage[] = ['not_qualified', 'declined', 'expired', 'canceled'];
/** Stages set only by the order attached to the opportunity, never by hand. */
export const ORDER_DRIVEN_STAGES: OpportunityStage[] = ['order_pending', 'submitted', 'activated', 'completed'];

/** Stages a person may move an opportunity to from where it is now. */
export function nextOpportunityStages(from: OpportunityStage): OpportunityStage[] {
  const i = SALES_STEPS.indexOf(from);
  if (i >= 0) return [...(SALES_STEPS[i + 1] ? [SALES_STEPS[i + 1]] : []), ...(i > 0 ? [SALES_STEPS[i - 1]] : []), ...ENDED];
  if (ENDED.includes(from)) return ['identified']; // reopen
  return []; // order-driven: changes come from the order
}

/** The coarse status kept on older screens and reports. */
export const STAGE_TO_STATUS: Record<OpportunityStage, 'new' | 'contacted' | 'quoted' | 'won' | 'lost' | 'not_eligible'> = {
  identified: 'new',
  qualification_pending: 'contacted',
  qualified: 'contacted',
  offer_presented: 'quoted',
  customer_accepted: 'quoted',
  order_pending: 'quoted',
  submitted: 'quoted',
  activated: 'won',
  completed: 'won',
  not_qualified: 'not_eligible',
  declined: 'lost',
  expired: 'lost',
  canceled: 'lost',
};

// ------------------------------------------------------------------ orders --
export const ORDER_STATUSES = [
  'draft',
  'awaiting_qualification',
  'ready',
  'submitted',
  'provider_pending',
  'installation_scheduled',
  'activation_pending',
  'activated',
  'completed',
  'rejected',
  'canceled',
  'failed',
  'reversed',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  draft: 'Draft',
  awaiting_qualification: 'Awaiting qualification',
  ready: 'Ready for submission',
  submitted: 'Submitted',
  provider_pending: 'Provider pending',
  installation_scheduled: 'Installation scheduled',
  activation_pending: 'Activation pending',
  activated: 'Activated',
  completed: 'Completed',
  rejected: 'Rejected',
  canceled: 'Canceled',
  failed: 'Failed',
  reversed: 'Reversed / charged back',
};

const ORDER_MOVES: Record<OrderStatus, OrderStatus[]> = {
  draft: ['awaiting_qualification', 'ready', 'canceled'],
  awaiting_qualification: ['ready', 'rejected', 'canceled'],
  ready: ['submitted', 'canceled'],
  submitted: ['provider_pending', 'installation_scheduled', 'activation_pending', 'rejected', 'canceled', 'failed'],
  provider_pending: ['installation_scheduled', 'activation_pending', 'rejected', 'canceled', 'failed'],
  installation_scheduled: ['activation_pending', 'activated', 'canceled', 'failed'],
  activation_pending: ['activated', 'canceled', 'failed'],
  activated: ['completed', 'reversed'],
  completed: ['reversed'],
  failed: ['ready', 'canceled'], // a failed submission can be prepared again
  rejected: [],
  canceled: [],
  reversed: [],
};

/** Services with nothing to install never pass through "installation scheduled". */
const NO_INSTALL: OrderCategory[] = ['mobile', 'electricity'];

export function nextOrderStatuses(from: OrderStatus, category: OrderCategory): OrderStatus[] {
  return ORDER_MOVES[from].filter((s) => !(s === 'installation_scheduled' && NO_INSTALL.includes(category)));
}

/** Moves that need `orders.confirm` and written evidence from the provider. */
export const CONFIRMED_STATUSES: OrderStatus[] = ['activated', 'completed', 'reversed'];
/** Moves that need a reason. */
export const REASON_STATUSES: OrderStatus[] = ['rejected', 'canceled', 'failed', 'reversed'];
export const OPEN_ORDER_STATUSES: OrderStatus[] = ['draft', 'awaiting_qualification', 'ready', 'submitted', 'provider_pending', 'installation_scheduled', 'activation_pending'];
export const SUBMITTED_ORDER_STATUSES: OrderStatus[] = ['submitted', 'provider_pending', 'installation_scheduled', 'activation_pending', 'activated', 'completed', 'reversed'];
export const WON_ORDER_STATUSES: OrderStatus[] = ['activated', 'completed'];

export type OrderMoveCheck = { ok: true } | { ok: false; error: string };

export function checkOrderMove(o: { status: OrderStatus; category: OrderCategory; externalRef: string; submissionChannel: string }, to: OrderStatus, input: { evidence: string; reason: string; canConfirm: boolean }): OrderMoveCheck {
  if (!nextOrderStatuses(o.status, o.category).includes(to)) return { ok: false, error: `An order that is “${ORDER_STATUS_LABEL[o.status]}” cannot move to “${ORDER_STATUS_LABEL[to]}”.` };
  if (to === 'submitted' && (!o.submissionChannel || !o.externalRef)) return { ok: false, error: 'Record how the order was submitted and the provider’s reference before marking it submitted.' };
  if (CONFIRMED_STATUSES.includes(to)) {
    if (!input.canConfirm) return { ok: false, error: 'Only a manager or admin can confirm this step.' };
    if (!input.evidence.trim()) return { ok: false, error: 'Add the provider’s confirmation (reference, date or source) as evidence.' };
  }
  if (REASON_STATUSES.includes(to) && !input.reason.trim()) return { ok: false, error: 'Add the reason.' };
  return { ok: true };
}

/** What an order's status means for the opportunity it belongs to. */
export function stageForOrder(status: OrderStatus): OpportunityStage {
  if (status === 'activated') return 'activated';
  if (status === 'completed') return 'completed';
  if (status === 'canceled' || status === 'rejected' || status === 'reversed') return 'canceled';
  if (status === 'draft' || status === 'awaiting_qualification' || status === 'ready' || status === 'failed') return 'order_pending';
  return 'submitted';
}

export const SUBMISSION_CHANNELS = ['provider_portal', 'provider_phone', 'provider_api', 'email', 'in_person'] as const;
export const SUBMISSION_CHANNEL_LABEL: Record<(typeof SUBMISSION_CHANNELS)[number], string> = {
  provider_portal: 'Provider sales portal (by hand)',
  provider_phone: 'Phone with the provider',
  provider_api: 'Provider API',
  email: 'Email to the provider',
  in_person: 'In person',
};

export const PARTNERSHIP_STATUSES = ['researching', 'contacted', 'negotiating', 'contracted', 'active', 'paused', 'terminated'] as const;
export type PartnershipStatus = (typeof PARTNERSHIP_STATUSES)[number];
export const PARTNERSHIP_LABEL: Record<PartnershipStatus, string> = {
  researching: 'Researching',
  contacted: 'Contacted',
  negotiating: 'Negotiating',
  contracted: 'Contracted',
  active: 'Active',
  paused: 'Paused',
  terminated: 'Terminated',
};
/** Orders can only be written with a provider we are actually allowed to sell. */
export const SELLABLE_PARTNERSHIPS: PartnershipStatus[] = ['contracted', 'active'];
