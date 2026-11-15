/**
 * Verified Omni Fiber plans for the Monroe market.
 *
 * Intentionally EMPTY. Add plans here only from current, written Omni Fiber
 * materials — never estimate speeds or prices. While this list is empty the
 * site shows the technology comparison and directs visitors to the free
 * consultation, where plans are confirmed per address.
 */
export interface Plan {
  name: string;
  /** e.g. "Up to 500 Mbps" exactly as Omni Fiber advertises it */
  speed: string;
  /** e.g. "$XX/mo" — include required qualifiers in `fineprint` */
  price: string;
  highlights: string[];
  fineprint?: string;
  featured?: boolean;
}

export const PLANS: Plan[] = [];
export const PLANS_VERIFIED_ON = ''; // e.g. '2026-11-20'
