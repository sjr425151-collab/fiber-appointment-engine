/**
 * Household assessment — the single schema shared by the browser form and the
 * API. Only what's needed to compare costs is collected. Money is integer
 * cents; `null` means "I don't know" (the analysis then asks for it instead of
 * guessing).
 */
import { z } from 'zod';

z.config({ jitless: true });

export const PLATFORM_CATEGORIES = ['internet', 'mobile', 'tv', 'electricity', 'security'] as const;
export type PlatformCategory = (typeof PLATFORM_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<PlatformCategory, string> = {
  internet: 'Home internet',
  mobile: 'Mobile phones',
  tv: 'TV & streaming',
  electricity: 'Electricity',
  security: 'Home security',
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

/** Electricity — the alternative we compare is rooftop solar, so it also asks what solar depends on. */
export const electricitySchema = z.object({
  utility: name,
  monthlyCents: cents.nullable(),
  monthlyKwh: z.number().int().min(0).max(20_000).nullable().default(null),
  rateType: z.enum(['standard', 'time_of_use', 'unknown']).default('unknown'),
  homeownership: z.enum(['own', 'rent', 'unknown']).default('unknown'),
  roofSun: z.enum(['mostly_sunny', 'some_shade', 'heavy_shade', 'unknown']).default('unknown'),
  /** The homeowner asked to see extra-service pricing (solar). Nothing about solar is priced until they do. */
  showPricing: z.boolean().default(false),
});

/** Home security (monitoring). Priced only for homeowners who ask to see extra-service pricing. */
export const securitySchema = z.object({
  provider: name,
  monthlyCents: cents.nullable(),
  equipmentFeeCents: optionalCents,
  homeownership: z.enum(['own', 'rent', 'unknown']).default('unknown'),
  showPricing: z.boolean().default(false),
});

/** Solar and home security comparisons are shown only to homeowners who asked for them. */
export const extraPricingAllowed = (v: { homeownership?: string; showPricing?: boolean } | undefined) => !!v && v.homeownership === 'own' && v.showPricing === true;

/**
 * Assessments saved before solar became the electricity alternative had a
 * separate "solar" category. Fold it into electricity so old links still work.
 */
export function upgradeLegacy(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const a = { ...(input as Record<string, unknown>) };
  // Saved before homeowners had to ask for extra-service pricing: owners already saw solar, so keep showing it.
  if (a.electricity && typeof a.electricity === 'object' && !('showPricing' in (a.electricity as object)) && (a.electricity as Record<string, unknown>).homeownership === 'own') {
    a.electricity = { ...(a.electricity as object), showPricing: true };
  }
  const cats = Array.isArray(a.categories) ? (a.categories as unknown[]) : null;
  if (!cats?.includes('solar') && !('solar' in a)) return a;
  const solar = (a.solar ?? {}) as Record<string, unknown>;
  delete a.solar;
  if (cats) a.categories = cats.filter((c) => c !== 'solar');
  if (a.electricity && typeof a.electricity === 'object') {
    const e = a.electricity as Record<string, unknown>;
    a.electricity = { homeownership: solar.homeownership ?? e.homeownership, roofSun: solar.roofSun ?? e.roofSun, ...e };
  }
  return a;
}

export const PRIORITIES = ['lower_cost', 'faster_speed', 'no_contract', 'reliability', 'simple_switch'] as const;

const assessmentObject = z
  .object({
    zip: z.string().trim().regex(/^\d{5}$/, 'Enter a 5-digit ZIP code'),
    categories: z.array(z.enum(PLATFORM_CATEGORIES)).min(1, 'Choose at least one service').max(5),
    internet: internetSchema.optional(),
    mobile: mobileSchema.optional(),
    tv: tvSchema.optional(),
    electricity: electricitySchema.optional(),
    security: securitySchema.optional(),
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
    if (new Set(a.categories).size !== a.categories.length) ctx.addIssue({ code: 'custom', path: ['categories'], message: 'Each service can be chosen once' });
  });

export const assessmentSchema = z.preprocess(upgradeLegacy, assessmentObject);

export type Assessment = z.output<typeof assessmentObject>;
export type AssessmentInput = z.input<typeof assessmentObject>;

/** Submission body: the assessment plus first-party attribution. */
export const submissionSchema = z.object({
  assessment: z.unknown(),
  sessionId: z.string().trim().max(64).optional().default(''),
  utmSource: z.string().trim().max(100).optional().default(''),
  utmCampaign: z.string().trim().max(100).optional().default(''),
  landingPage: z.string().trim().max(300).optional().default(''),
  referrer: z.string().trim().max(500).optional().default(''),
});
