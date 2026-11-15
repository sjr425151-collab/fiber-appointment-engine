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

const INCLUDED = ['Free installation', 'Free equipment', 'No extra taxes or fees', 'No contracts'];

/** Monroe, MI pricing as provided by Spotlight Marketing LLC on 2026-11-15. */
export const PLANS: Plan[] = [
  { name: '1 Gig', speed: 'Omni Fiber internet', price: '$50/mo', highlights: INCLUDED },
  { name: '2 Gig', speed: 'Omni Fiber internet', price: '$70/mo', highlights: INCLUDED, featured: true },
];
export const PLANS_VERIFIED_ON = 'November 15, 2026';
export const PLANS_FROM = '$50/mo';
