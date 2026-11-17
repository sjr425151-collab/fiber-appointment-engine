/**
 * Lead routing: which representative gets a pricing-review request.
 *
 * Pure and deterministic: the same lead and the same representative
 * configuration always give the same answer, and every answer carries the
 * reason, which is stored on the lead. Availability is the `accepting` switch an
 * admin or the representative sets by hand; nothing is inferred from a schedule.
 */
import type { PlatformCategory } from './assessment';

export interface RoutableRep {
  id: string;
  active: boolean;
  /** Confirmed by a person: "send me new leads now". */
  accepting: boolean;
  /** Location slugs this representative covers; "*" covers every served location. */
  markets: string[];
  /** Services this representative handles; empty means all of them. */
  categories: PlatformCategory[];
  /** Open leads this representative can hold; 0 means no limit. */
  maxOpenLeads: number;
  openLeads: number;
  lastAssignedAt: string | null;
}

export const ROUTING_REASON = {
  existing_owner: 'Already working with this household',
  least_loaded: 'Covers this location and service; fewest open leads',
  no_representatives: 'No representatives are set up yet',
  none_accepting: 'No representative is accepting new leads right now',
  no_match: 'No accepting representative covers this location and service',
  at_capacity: 'Every matching representative is at their open-lead limit',
  zip_not_served: 'ZIP is outside the locations we currently serve',
  manual: 'Assigned by hand',
} as const;
export type RoutingReason = keyof typeof ROUTING_REASON;

export type RoutingDecision =
  | { outcome: 'assigned'; repId: string; reason: 'existing_owner' | 'least_loaded' }
  | { outcome: 'queued'; reason: 'no_representatives' | 'none_accepting' | 'no_match' | 'at_capacity' }
  | { outcome: 'unsupported'; reason: 'zip_not_served' };

export interface RoutingInput {
  /** The served location the ZIP belongs to, or null when we do not serve it. */
  marketId: string | null;
  categories: PlatformCategory[];
  /** Representative who already owns an open lead for the same household. */
  existingOwnerId: string | null;
}

const covers = (rep: RoutableRep, input: RoutingInput) =>
  (rep.markets.includes('*') || (input.marketId !== null && rep.markets.includes(input.marketId))) &&
  (rep.categories.length === 0 || input.categories.length === 0 || input.categories.some((c) => rep.categories.includes(c)));

export function routeLead(input: RoutingInput, reps: RoutableRep[]): RoutingDecision {
  // An unserved ZIP is recorded for review; it is never handed out as if service were available.
  if (input.marketId === null) return { outcome: 'unsupported', reason: 'zip_not_served' };

  const active = reps.filter((r) => r.active);
  // A household already being helped stays with the same person, even if they are not taking new leads.
  const owner = active.find((r) => r.id === input.existingOwnerId);
  if (owner) return { outcome: 'assigned', repId: owner.id, reason: 'existing_owner' };

  if (active.length === 0) return { outcome: 'queued', reason: 'no_representatives' };
  const accepting = active.filter((r) => r.accepting);
  if (accepting.length === 0) return { outcome: 'queued', reason: 'none_accepting' };
  const matching = accepting.filter((r) => covers(r, input));
  if (matching.length === 0) return { outcome: 'queued', reason: 'no_match' };
  const withRoom = matching.filter((r) => r.maxOpenLeads === 0 || r.openLeads < r.maxOpenLeads);
  if (withRoom.length === 0) return { outcome: 'queued', reason: 'at_capacity' };

  // Fewest open leads first; then whoever was assigned longest ago; then id, so ties never depend on query order.
  const [pick] = [...withRoom].sort(
    (a, b) => a.openLeads - b.openLeads || (a.lastAssignedAt ?? '').localeCompare(b.lastAssignedAt ?? '') || a.id.localeCompare(b.id),
  );
  return { outcome: 'assigned', repId: pick.id, reason: 'least_loaded' };
}
