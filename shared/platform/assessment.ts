/**
 * Household assessment — the single schema shared by the browser form and the
 * API. Only what's needed to compare costs is collected. Money is integer
 * cents; `null` means "I don't know" (the analysis then asks for it instead of
 * guessing).
 */
import { z } from 'zod';
import { leadInputSchema } from '../schemas';

z.config({ jitless: true });

export const PLATFORM_CATEGORIES = ['internet', 'mobile', 'tv', 'electricity', 'solar'] as const;
export type PlatformCategory = (typeof PLATFORM_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<PlatformCategory, string> = {
  internet: 'Home internet',
  mobile: 'Mobile phones',
  tv: 'TV & streaming',
  electricity: 'Electricity',
  solar: 'Solar (interest)',
};

const cents = z.number().int().min(0).max(1_000_000); // ≤ $10,000/mo
const optionalCents = cents.nullable().default(null);
const name = z.string().trim().max(80).default('');

/** When a current promotional price ends — buckets are easier to answer than dates. */
export const PROMO_ENDS = ['none', 'within_3', 'within_12', 'over_12', 'unknown'] as const;
export const PROMO_MONTHS: Record<(typeof PROMO_ENDS)[number], number | null> = { none: null, within_3: 2, within_12: 6, over_12: 15, unknown: null };

export const internetSchema = z.object({
  provider: name,
  monthlyCents: cents.nullable(),
  technology: z.enum(['cable', 'dsl', 'fiber', 'fixed_wireless', 'satellite', '5g_home', 'unknown']).default('unknown'),
  downloadMbps: z.number().int().min(0).max(20_000).nullable().default(null),
  equipmentFeeCents: optionalCents,
  dataCap: z.enum(['yes', 'no', 'unknown']).default('unknown'),
  promoEnds: z.enum(PROMO_ENDS).default('unknown'),
  /** What the bill goes up to when the promotion ends, if known. */
  promoRegularCents: optionalCents,
  contractMonthsRemaining: z.number().int().min(0).max(60).default(0),
  earlyTerminationCents: optionalCents,
  reliabilityConcerns: z.boolean().default(false),
});

export const mobileSchema = z.object({
  carrier: name,
  /** Service only — device installment payments are excluded from comparisons. */
  monthlyCents: cents.nullable(),
  lines: z.number().int().min(1).max(10),
  deviceFinancingCents: optionalCents,
  dataNeed: z.enum(['light', 'moderate', 'heavy', 'unlimited']).default('unlimited'),
  international: z.boolean().default(false),
});

export const tvSchema = z.object({
  provider: name,
  serviceType: z.enum(['cable', 'satellite', 'live_streaming', 'streaming_only']).default('cable'),
  monthlyCents: cents.nullable(),
  equipmentFeeCents: optionalCents,
  /** Other streaming subscriptions (Netflix etc.) — counted, not replaced. */
  otherStreamingCents: optionalCents,
  mustHave: z.array(z.enum(['local_channels', 'sports', 'news', 'kids', 'premium_movies'])).max(5).default([]),
});

export const electricitySchema = z.object({
  utility: name,
  monthlyCents: cents.nullable(),
  monthlyKwh: z.number().int().min(0).max(20_000).nullable().default(null),
  rateType: z.enum(['standard', 'time_of_use', 'unknown']).default('unknown'),
});

export const solarSchema = z.object({
  homeownership: z.enum(['own', 'rent']),
  roofSun: z.enum(['mostly_sunny', 'some_shade', 'heavy_shade', 'unknown']).default('unknown'),
  financing: z.enum(['cash', 'loan', 'lease', 'undecided']).default('undecided'),
});

export const PRIORITIES = ['lower_cost', 'faster_speed', 'no_contract', 'reliability', 'simple_switch'] as const;

export const assessmentSchema = z
  .object({
    zip: z.string().trim().regex(/^\d{5}$/, 'Enter a 5-digit ZIP code'),
    categories: z.array(z.enum(PLATFORM_CATEGORIES)).min(1, 'Choose at least one service').max(5),
    internet: internetSchema.optional(),
    mobile: mobileSchema.optional(),
    tv: tvSchema.optional(),
    electricity: electricitySchema.optional(),
    solar: solarSchema.optional(),
    priorities: z.array(z.enum(PRIORITIES)).max(5).default([]),
  })
  .superRefine((a, ctx) => {
    for (const c of a.categories) {
      if (!a[c]) ctx.addIssue({ code: 'custom', path: [c], message: `Tell us about your ${CATEGORY_LABEL[c].toLowerCase()}` });
    }
    // Unselected categories must not carry data (data minimisation).
    for (const c of PLATFORM_CATEGORIES) {
      if (!a.categories.includes(c) && a[c]) ctx.addIssue({ code: 'custom', path: [c], message: 'Unexpected answers for an unselected category' });
    }
  });

export type Assessment = z.output<typeof assessmentSchema>;
export type AssessmentInput = z.input<typeof assessmentSchema>;

/** Contact request from the results page. Address is optional (an advisor can confirm it). */
export const contactSchema = leadInputSchema
  .pick({ firstName: true, lastName: true, email: true, phone: true, preferredContact: true, consent: true, website: true, sessionId: true })
  .extend({
    token: z.string().min(16).max(128),
    intent: z.enum(['callback', 'appointment', 'advisor']),
    street: z.string().trim().max(120).optional().default(''),
    unit: z.string().trim().max(30).optional().default(''),
    city: z.string().trim().max(60).optional().default(''),
  });
export type ContactInput = z.input<typeof contactSchema>;

/** Submission body: the assessment plus first-party attribution. */
export const submissionSchema = z.object({
  assessment: z.unknown(),
  sessionId: z.string().trim().max(64).optional().default(''),
  utmSource: z.string().trim().max(100).optional().default(''),
  utmCampaign: z.string().trim().max(100).optional().default(''),
  landingPage: z.string().trim().max(300).optional().default(''),
  referrer: z.string().trim().max(500).optional().default(''),
});
