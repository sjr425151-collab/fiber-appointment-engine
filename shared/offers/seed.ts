/**
 * Pilot data: Omni Fiber plans in Monroe, MI as provided by Spotlight
 * Marketing LLC on 2026-11-15. Recorded as `manually_verified` from a staff
 * source — NOT `verified` — because no provider document or authorized API is
 * on file. Partnership status is `none` until an agreement is documented.
 */
import type { Offer, Provider } from './model';

export const OMNI_FIBER: Provider = {
  id: 'omni-fiber',
  name: 'Omni Fiber',
  categories: ['internet'],
  website: 'https://www.omnifiber.com/',
  partnership: { status: 'none', compensation: { model: 'unknown' } },
};

const INCLUDED = ['Free installation', 'Free equipment', 'No extra taxes or fees', 'No contracts'];
const provenance = {
  sourceType: 'staff_confirmation' as const,
  reference: 'Pricing provided by Spotlight Marketing LLC (project owner) in planning conversation, 2026-11-15',
  recordedBy: 'Spotlight Marketing LLC',
  verifiedAt: '2026-11-15T00:00:00Z',
  review: 'manually_verified' as const,
  gaps: ['Confirm against the Monroe Broadband Facts label', 'Promotional terms, if any, not recorded'],
};

const monroe = (id: string, planName: string, mbps: number, priceCents: number): Offer => ({
  id,
  providerId: 'omni-fiber',
  category: 'internet',
  planName,
  attributes: { downloadMbps: mbps, technology: 'fiber', dataCapGb: null },
  pricing: { baseMonthly: priceCents, quality: 'manually_verified' },
  contractMonths: 0,
  geography: { zips: ['48161', '48162'], marketIds: ['monroe'] },
  eligibility: { newCustomersOnly: false, requires: [] },
  restrictions: INCLUDED.map((i) => `Included: ${i}`),
  disclosureUrl: 'https://www.omnifiber.com/broadbandlabels/',
  provenance,
});

export const MONROE_OFFERS: Offer[] = [
  monroe('omni-monroe-500', '500 Mbps', 500, 5000),
  monroe('omni-monroe-1g', '1 Gig', 1000, 5000),
  monroe('omni-monroe-2g', '2 Gig', 2000, 7000),
];
