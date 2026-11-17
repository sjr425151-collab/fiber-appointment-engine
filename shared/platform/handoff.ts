/**
 * Representative handoff: the short "Get My Exact Pricing" request a household
 * sends after seeing an illustrative preview. The website creates the
 * opportunity; a representative verifies the details.
 *
 * Everything the customer saw is stored with the lead as a preview snapshot
 * that is always marked illustrative and unverified. It is never a quote.
 */
import { z } from 'zod';
import { BRAND } from '../content';
import type { Cents } from '../finance/money';
import { CONTACT_METHODS, leadInputSchema } from '../schemas';
import type { AssessmentInput, PlatformCategory } from './assessment';
import { PLATFORM_CATEGORIES } from './assessment';
import { BENCHMARKS_VERSION, quickPreview } from './benchmarks';
import type { OpportunityDraft } from './opportunity';

z.config({ jitless: true });

export const HANDOFF_COPY = {
  cta: 'Get My Exact Pricing',
  support: 'Let’s see which offers are actually available at your address. A representative can help you compare your options.',
  reassurance: ['No obligation to switch', 'Personalized pricing verification', 'No purchase required to request a review'],
  submit: 'Request my pricing review',
  doneTitle: 'Your Pricing Review Has Been Requested',
  doneBody: 'We’ve received your information. A representative can review the available options for your household and help confirm pricing for your address.',
  unsupported: 'We don’t have confirmed options on file for your ZIP code yet, so your request needs a review before we can say what is available.',
  unverified: 'Preliminary comparison against benchmarks. Not verified pricing, not a quote, and not confirmation that any service is available.',
} as const;

/**
 * Consent to be contacted about this request. The exact wording shown is stored
 * with each submission; bump the version whenever it changes. Legal review of
 * this wording is still outstanding (docs/07-risk-register.md).
 */
export const HANDOFF_CONSENT_VERSION = 'handoff-2026-11-17';
export function handoffConsentText() {
  return (
    `By checking this box, I ask ${BRAND.name} (operated by ${BRAND.agency}) to contact me at the phone number I provided, by phone call ` +
    'or text message, including with automated technology, about my pricing review request. Consent is not a condition of any purchase. ' +
    'Message and data rates may apply. Reply STOP to opt out of texts.'
  );
}

/** Optional and separate from the request itself. No marketing messages are sent by this system today. */
export const MARKETING_CONSENT_VERSION = 'marketing-2026-11-17';
export function marketingConsentText() {
  return `Optional: also send me occasional savings tips and offers from ${BRAND.name} by text or email. I can opt out at any time.`;
}

export const BEST_TIMES = ['anytime', 'morning', 'afternoon', 'evening'] as const;
export type BestTime = (typeof BEST_TIMES)[number];
export const BEST_TIME_LABEL: Record<BestTime, string> = { anytime: 'Any time', morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening' };

const cents = z.number().int().min(0).max(1_000_000).nullable().default(null);
const attribution = leadInputSchema.pick({ utmSource: true, utmMedium: true, utmCampaign: true, utmContent: true, utmTerm: true, clickId: true, referrer: true, landingPage: true, sessionId: true, website: true });

/** Fields shared by the home-page request and the results-page request. */
export const handoffContactShape = {
  firstName: leadInputSchema.shape.firstName,
  phone: leadInputSchema.shape.phone,
  /** Optional: a representative can ask for these on the call. */
  lastName: z.string().trim().max(60).optional().default(''),
  email: z.union([z.literal(''), z.string().trim().toLowerCase().email('Enter a valid email').max(254)]).optional().default(''),
  preferredContact: z.enum(CONTACT_METHODS).optional().default('phone'),
  bestTime: z.enum(BEST_TIMES).optional().default('anytime'),
  street: z.string().trim().max(120).optional().default(''),
  /** Required: permission to contact the customer about this request. */
  consent: z.literal(true, { error: 'Please check the box so a representative can contact you' }),
  /** Optional marketing permission; never required. */
  marketingConsent: z.boolean().optional().default(false),
  /** Made once per open form so a retry or double tap can never create a second lead. */
  requestKey: z.string().uuid().optional(),
};

/** Request sent from the home page preview: contact details plus the bills already typed. */
export const handoffSchema = attribution
  .extend(handoffContactShape)
  .extend({
    zip: leadInputSchema.shape.zip,
    bills: z.object({ internet: cents, mobile: cents, tv: cents, electricity: cents }),
    mobileLines: z.number().int().min(1).max(10).optional().default(1),
    ownsHome: z.boolean().optional().default(false),
  })
  .refine((v) => Object.values(v.bills).some((b) => (b ?? 0) > 0), { path: ['bills'], message: 'Enter at least one monthly bill first' })
  .refine((v) => v.preferredContact !== 'email' || v.email !== '', { path: ['email'], message: 'Add an email address, or choose phone or text' });
export type HandoffInput = z.input<typeof handoffSchema>;
export type Handoff = z.output<typeof handoffSchema>;

export interface HandoffPreviewRow {
  category: string;
  currentMonthlyCents: Cents | null;
  /** What it was compared with: a benchmark, or the option selected on the results page. */
  comparisonMonthlyCents: Cents | null;
  comparison: string;
  differenceCents: Cents | null;
}

/** What the customer was shown when they asked for help. Always illustrative, never a quote. */
export interface HandoffPreview {
  source: 'home_preview' | 'results';
  illustrative: true;
  verified: false;
  benchmarksVersion: string;
  rows: HandoffPreviewRow[];
  currentMonthlyCents: Cents | null;
  monthlyDifferenceCents: Cents;
  annualDifferenceCents: Cents;
  mobileLines?: number;
  ownsHome?: boolean;
}

const billInput = (h: Pick<Handoff, 'bills' | 'mobileLines' | 'ownsHome'>) => ({ ...h.bills, mobileLines: h.mobileLines, ownsHome: h.ownsHome });

/** The home-page preview, recomputed on the server from the bills. Client-side totals are never trusted. */
export function previewFromBills(h: Pick<Handoff, 'bills' | 'mobileLines' | 'ownsHome'>): HandoffPreview {
  const p = quickPreview(billInput(h));
  return {
    source: 'home_preview',
    illustrative: true,
    verified: false,
    benchmarksVersion: BENCHMARKS_VERSION,
    rows: p.rows.map((r) => ({
      category: r.category,
      currentMonthlyCents: r.current,
      comparisonMonthlyCents: r.benchmark,
      comparison: r.benchmark === null ? 'Not compared (solar is for homeowners)' : 'Tucker benchmark',
      differenceCents: r.benchmark === null ? null : r.savings,
    })),
    currentMonthlyCents: p.currentMonthly,
    monthlyDifferenceCents: p.monthlySavings,
    annualDifferenceCents: p.annualSavings,
    mobileLines: h.bills.mobile ? h.mobileLines : undefined,
    ownsHome: h.ownsHome,
  };
}

/** The results-page view, from the options the customer had selected. */
export function previewFromOpportunities(drafts: OpportunityDraft[], currentMonthlyCents: Cents | null): HandoffPreview {
  const rows = drafts.map((d) => ({
    category: d.category,
    currentMonthlyCents: d.currentMonthlyCents,
    comparisonMonthlyCents: d.proposedMonthlyCents,
    comparison: d.planName,
    differenceCents: d.monthlySavingsCents,
  }));
  const monthly = rows.reduce((s, r) => s + Math.max(0, r.differenceCents ?? 0), 0);
  return { source: 'results', illustrative: true, verified: false, benchmarksVersion: BENCHMARKS_VERSION, rows, currentMonthlyCents, monthlyDifferenceCents: monthly, annualDifferenceCents: monthly * 12 };
}

/** Request sent from the results page: the same short contact details, plus the options selected there. */
export const contactSchema = leadInputSchema
  .pick({ website: true, sessionId: true })
  .extend(handoffContactShape)
  .extend({
    token: z.string().min(16).max(128),
    intent: z.enum(['callback', 'appointment', 'advisor']),
    unit: z.string().trim().max(30).optional().default(''),
    city: z.string().trim().max(60).optional().default(''),
    /** The options the customer selected on the results page (offer id or "keep"). The server re-derives all figures. */
    selections: z.partialRecord(z.enum(PLATFORM_CATEGORIES), z.string().trim().max(80)).optional().default({}),
  })
  .refine((v) => v.preferredContact !== 'email' || v.email !== '', { path: ['email'], message: 'Add an email address, or choose phone or text' });
export type ContactInput = z.input<typeof contactSchema>;

export const billCategories = (bills: Handoff['bills']): PlatformCategory[] => PLATFORM_CATEGORIES.filter((c) => (bills[c] ?? 0) > 0);

/** The same answers as an assessment, so the lead gets a full analysis and opportunities without the customer filling in anything else. */
export function assessmentFromBills(h: Pick<Handoff, 'bills' | 'mobileLines' | 'ownsHome' | 'zip'>): AssessmentInput {
  const categories = billCategories(h.bills);
  const a: AssessmentInput = { zip: h.zip, categories };
  if (h.bills.internet) a.internet = { monthlyCents: h.bills.internet };
  if (h.bills.mobile) a.mobile = { monthlyCents: h.bills.mobile, lines: h.mobileLines };
  if (h.bills.tv) a.tv = { monthlyCents: h.bills.tv };
  if (h.bills.electricity) a.electricity = { monthlyCents: h.bills.electricity, homeownership: h.ownsHome ? 'own' : 'unknown' };
  return a;
}

/** What the customer is told after the request is saved. Nothing here is invented: no response time, no appointment. */
export interface HandoffResult {
  leadId: string;
  bookingToken: string;
  market: string;
  /** True when a lead already existed for this exact request (retry or double tap). */
  repeat: boolean;
  routing: { outcome: 'assigned' | 'queued' | 'unsupported'; representative: string | null };
  /** Link to the full preview built from the same bills (home-page requests only). */
  results?: { id: string; token: string };
}
