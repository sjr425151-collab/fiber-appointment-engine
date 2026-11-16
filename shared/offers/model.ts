/**
 * Provider intelligence: providers, offers, coverage evidence and provenance.
 *
 * Every offer carries a provenance record. What the consumer is told about an
 * offer is derived from that record by `publicStatus()` — never from a free
 * text field — so stale or unverified data can't be presented as verified.
 * Commission data lives on the partnership record and is deliberately absent
 * from the inputs to ranking (see ./rank.ts).
 */
import { z } from 'zod';
import { CATEGORIES, costStreamSchema } from '../finance/engine';

z.config({ jitless: true });

const httpUrl = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), 'Must be an http(s) URL');
const isoDate = z.string().datetime({ offset: true });

/** Where a fact came from. Prohibited sources (scraping behind access controls) are not representable. */
export const SOURCE_TYPES = [
  'provider_api', // authorized integration
  'provider_published', // provider's public website / published rate card, captured by staff
  'provider_document', // rate sheet, partner agreement, email from provider
  'staff_confirmation', // confirmed by our team with the provider (e.g. sales rep, partner manager)
  'customer_bill', // from the customer's own bill
  'third_party', // public datasets (e.g. FCC broadband map) — never address-level proof
  'sample', // illustrative data for staging/demos — never a real offer
] as const;

export const provenanceSchema = z.object({
  sourceType: z.enum(SOURCE_TYPES),
  /** URL, document id or short description of the source. */
  reference: z.string().min(1).max(500),
  recordedBy: z.string().min(1).max(120),
  /** When someone last confirmed this offer is current. */
  verifiedAt: isoDate,
  effectiveFrom: isoDate.optional(),
  expiresAt: isoDate.optional(),
  /** Manual review outcome. `verified` requires an authorized or provider source. */
  review: z.enum(['verified', 'manually_verified', 'estimated', 'pending', 'withdrawn']),
  /** Fields known to be missing or uncertain, shown as caveats. */
  gaps: z.array(z.string().max(120)).max(20).default([]),
});
export type Provenance = z.infer<typeof provenanceSchema>;

export const partnershipSchema = z.object({
  /** Documented relationship with the provider. Nothing is assumed. */
  status: z.enum(['none', 'in_discussion', 'authorized_marketer', 'contracted']),
  documentedAt: isoDate.optional(),
  reference: z.string().max(500).optional(),
  /** Internal only — never shown to consumers or used in ranking. */
  compensation: z
    .object({
      model: z.enum(['unknown', 'per_activation', 'referral_fee', 'revenue_share']),
      amountCents: z.number().int().min(0).optional(),
      notes: z.string().max(500).optional(),
    })
    .default({ model: 'unknown' }),
});

export const providerSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,60}$/),
  name: z.string().min(1).max(120),
  categories: z.array(z.enum(CATEGORIES)).min(1),
  website: httpUrl.optional(),
  partnership: partnershipSchema,
});
export type Provider = z.infer<typeof providerSchema>;

/** How strongly we know a location can be served. Maps are never address proof. */
export const COVERAGE_LEVELS = ['address_confirmed', 'zip_confirmed', 'map_approximate', 'none', 'unknown'] as const;

export const coverageEvidenceSchema = z.object({
  providerId: z.string(),
  level: z.enum(COVERAGE_LEVELS),
  /** ZIP or normalized address key the evidence is about. */
  subject: z.string().min(3).max(200),
  source: provenanceSchema.pick({ sourceType: true, reference: true, recordedBy: true, verifiedAt: true }),
});
export type CoverageEvidence = z.infer<typeof coverageEvidenceSchema>;

export const offerSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,80}$/),
  providerId: z.string(),
  category: z.enum(CATEGORIES),
  planName: z.string().min(1).max(120),
  /** Category-specific attributes used by ranking lenses. */
  attributes: z
    .object({
      downloadMbps: z.number().int().min(0).optional(),
      uploadMbps: z.number().int().min(0).optional(),
      technology: z.enum(['fiber', 'cable', 'dsl', 'fixed_wireless', 'satellite', '5g_home', 'other']).optional(),
      dataCapGb: z.number().int().min(0).nullable().optional(),
    })
    .default({}),
  /** Pricing in the finance engine's own format (integer cents). */
  pricing: costStreamSchema.omit({ id: true, label: true, category: true, firstBillProration: true, earlyTermination: true }),
  contractMonths: z.number().int().min(0).max(60).default(0),
  /** Where the offer applies. Availability at an address is a separate check. */
  geography: z.object({
    zips: z.array(z.string().regex(/^\d{5}$/)).default([]),
    marketIds: z.array(z.string()).default([]),
    /** Applies everywhere (sample data only). */
    nationwide: z.boolean().default(false),
  }),
  eligibility: z
    .object({
      newCustomersOnly: z.boolean().default(false),
      /** Household facts required (e.g. "autopay"). */
      requires: z.array(z.string().max(60)).max(10).default([]),
    })
    .default({ newCustomersOnly: false, requires: [] }),
  restrictions: z.array(z.string().max(300)).max(20).default([]),
  /** Official disclosure, e.g. FCC Broadband Facts label. */
  disclosureUrl: httpUrl.optional(),
  provenance: provenanceSchema,
});
export type Offer = z.input<typeof offerSchema>;
type OfferOut = z.output<typeof offerSchema>;

/** The five statuses consumers ever see (Section 1.2). */
export type PublicStatus = 'verified' | 'manually_verified' | 'estimated' | 'pending_verification' | 'unavailable' | 'sample';

/** Maximum age of a verification before the offer is treated as pending again. */
export const STALE_AFTER_DAYS: Record<(typeof SOURCE_TYPES)[number], number> = {
  provider_api: 2,
  provider_published: 30,
  provider_document: 60,
  staff_confirmation: 30,
  customer_bill: 90,
  third_party: 30,
  sample: 36_500,
};

/**
 * Derive what the consumer may be told about an offer at time `now`. Expired,
 * withdrawn and stale records are downgraded automatically.
 */
export function publicStatus(offer: Offer | OfferOut, now: Date): { status: PublicStatus; reasons: string[] } {
  const p = provenanceSchema.parse(offer.provenance);
  const reasons: string[] = [];
  // Sample data is always and only "sample" — it can never present as verified.
  if (p.sourceType === 'sample') return { status: p.review === 'withdrawn' ? 'unavailable' : 'sample', reasons: ['Illustrative sample — not a real offer'] };
  if (p.review === 'withdrawn') return { status: 'unavailable', reasons: ['Offer withdrawn'] };
  if (p.expiresAt && new Date(p.expiresAt) <= now) return { status: 'unavailable', reasons: ['Offer expired'] };
  if (p.effectiveFrom && new Date(p.effectiveFrom) > now) return { status: 'pending_verification', reasons: ['Offer not yet effective'] };
  const ageDays = (now.getTime() - new Date(p.verifiedAt).getTime()) / 86_400_000;
  const stale = ageDays > STALE_AFTER_DAYS[p.sourceType];
  if (stale) reasons.push(`Last verified ${Math.floor(ageDays)} days ago — needs re-verification`);
  if (p.review === 'pending' || stale) return { status: 'pending_verification', reasons };
  if (p.review === 'estimated') return { status: 'estimated', reasons: p.gaps };
  // "verified" is reserved for authorized/provider-originated sources.
  if (p.review === 'verified' && ['provider_api', 'provider_document'].includes(p.sourceType)) return { status: 'verified', reasons: p.gaps };
  return { status: 'manually_verified', reasons: p.gaps };
}

export interface HouseholdContext {
  zip: string;
  marketId?: string;
  /** Already a customer of this provider? Used for new-customer-only offers. */
  existingProviderIds?: string[];
  facts?: ReadonlySet<string>;
  /** Best coverage evidence we have for this household, by provider. */
  coverage?: Record<string, CoverageEvidence['level']>;
}

export interface EligibilityResult {
  /** true / false, or 'unknown' when coverage at the address hasn't been confirmed. */
  eligible: boolean | 'unknown';
  reasons: string[];
}

/** Deterministic eligibility. Approximate coverage never counts as serviceable. */
export function checkEligibility(input: Offer, ctx: HouseholdContext): EligibilityResult {
  const offer = offerSchema.parse(input);
  const reasons: string[] = [];
  const inArea =
    offer.geography.nationwide || offer.geography.zips.includes(ctx.zip) || (!!ctx.marketId && offer.geography.marketIds.includes(ctx.marketId));
  if (!inArea) return { eligible: false, reasons: ['Not offered in this area'] };
  if (offer.eligibility.newCustomersOnly && ctx.existingProviderIds?.includes(offer.providerId)) {
    return { eligible: false, reasons: ['New customers only'] };
  }
  const missing = offer.eligibility.requires.filter((r) => !ctx.facts?.has(r));
  if (missing.length) reasons.push(`Requires: ${missing.join(', ')}`);
  // Illustrative samples have no real coverage to check.
  if (offer.provenance.sourceType === 'sample') return { eligible: missing.length ? false : true, reasons };
  const level = ctx.coverage?.[offer.providerId] ?? 'unknown';
  if (level === 'none') return { eligible: false, reasons: ['Provider reports no service at this address'] };
  if (level !== 'address_confirmed') {
    reasons.push(level === 'zip_confirmed' ? 'Available in this ZIP — exact address not yet confirmed' : 'Address availability not yet confirmed');
    return { eligible: 'unknown', reasons };
  }
  return { eligible: missing.length ? false : true, reasons };
}
