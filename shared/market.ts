import { z } from 'zod';

// Our CSP forbids eval; tell Zod not to probe for it (it would log a CSP violation).
z.config({ jitless: true });

/**
 * A market is one launch location (e.g. Monroe, MI). Everything that differs
 * between locations lives here and is editable in Admin → Locations, so a new
 * city can go live without a code change.
 */

const httpUrl = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), 'Must start with http:// or https://');

const validTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const RESERVED_SLUGS = ['default', 'internet', 'savings', 'platform', 'admin', 'api', 'privacy', 'assets', 'media', 'robots.txt', 'sitemap.xml', 'favicon.svg'];

export const planSchema = z.object({
  name: z.string().trim().min(1).max(40),
  speed: z.string().trim().max(60).default(''),
  price: z.string().trim().min(1).max(20), // e.g. "$50/mo" — exactly as the provider advertises it
  highlights: z.array(z.string().trim().min(1).max(60)).max(8).default([]),
  fineprint: z.string().trim().max(300).optional(),
  featured: z.boolean().optional(),
});
export type Plan = z.infer<typeof planSchema>;

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');

export const scheduleSchema = z.object({
  slotMinutes: z.number().int().min(15).max(240).default(60),
  capacityPerSlot: z.number().int().min(1).max(50).default(2),
  openDays: z.array(z.number().int().min(0).max(6)).min(1).default([1, 2, 3, 4, 5, 6]),
  dayStart: time.default('09:00'),
  dayEnd: time.default('19:00'),
  minLeadHours: z.number().int().min(0).max(168).default(12),
  maxDaysAhead: z.number().int().min(1).max(90).default(21),
});
export type Schedule = z.infer<typeof scheduleSchema>;

export const marketSchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, numbers and dashes only')
    .min(2)
    .max(40)
    .refine((s) => !RESERVED_SLUGS.includes(s), 'That URL is reserved'),
  name: z.string().trim().min(2).max(60), // city / area name shown to visitors, e.g. "Monroe"
  state: z.string().trim().length(2).toUpperCase(), // "MI"
  region: z.string().trim().max(80).default(''), // e.g. "Monroe County"
  provider: z.string().trim().min(2).max(60), // ISP, e.g. "Omni Fiber"
  timezone: z.string().trim().min(3).max(60).refine(validTimeZone, 'Unknown timezone').default('America/Detroit'),
  phoneDisplay: z.string().trim().max(30).default(''),
  phoneE164: z
    .string()
    .trim()
    .regex(/^(\+1\d{10})?$/, 'Use +1 followed by 10 digits')
    .default(''),
  /** Team inboxes that get new-lead and booking alerts for this location. */
  notifyEmails: z.array(z.string().trim().toLowerCase().email('Enter valid email addresses')).max(10).default([]),
  /** One line under the ZIP form, e.g. "Monroe (48161, 48162) and surrounding communities." */
  areaNote: z.string().trim().max(200).default(''),
  plans: z.array(planSchema).max(6).default([]),
  plansVerifiedOn: z.string().trim().max(40).default(''),
  /** Official provider pages: exact-address checker and FCC Broadband Facts labels. */
  availabilityUrl: z.union([z.literal(''), httpUrl]).default(''),
  broadbandLabelsUrl: z.union([z.literal(''), httpUrl]).default(''),
  schedule: scheduleSchema.default(scheduleSchema.parse({})),
  /** Optional site-relative share image (1200×630), e.g. "/og-monroe.jpg". Falls back to /og-image.jpg. */
  ogImage: z
    .string()
    .trim()
    .regex(/^(\/[\w\-./]+\.(jpg|jpeg|png|webp))?$/, 'Use a site path like /og-city.jpg')
    .default(''),
  active: z.boolean().default(true),
  isDefault: z.boolean().default(false),
});
export type Market = z.infer<typeof marketSchema>;

/** The small public summary used for the location switcher and footer. */
export interface MarketSummary {
  slug: string;
  name: string;
  state: string;
}

export { plansFrom } from './market-utils';

/**
 * Pricing presets for the location editor (provided by Spotlight Marketing LLC,
 * 2026-11-15). Monroe has its own launch pricing; other Omni Fiber areas use
 * the standard prices. The same inclusions apply in every area (confirmed by
 * Spotlight Marketing LLC, 2026-11-15).
 */
const INCLUDED = ['Free installation', 'Free equipment', 'No extra taxes or fees', 'No contracts'];
const MONROE_INCLUDED = INCLUDED;
const STANDARD_INCLUDED = INCLUDED;

export const PRICING_PRESETS: { id: string; label: string; plans: Plan[] }[] = [
  {
    id: 'omni-standard',
    label: 'Omni Fiber standard pricing',
    plans: [
      { name: '500 Mbps', speed: 'Omni Fiber internet', price: '$65/mo', highlights: STANDARD_INCLUDED },
      { name: '1 Gig', speed: 'Omni Fiber internet', price: '$85/mo', highlights: STANDARD_INCLUDED },
      { name: '2 Gig', speed: 'Omni Fiber internet', price: '$105/mo', highlights: STANDARD_INCLUDED, featured: true },
    ],
  },
  {
    id: 'omni-monroe',
    label: 'Omni Fiber Monroe pricing',
    plans: [
      { name: '500 Mbps', speed: 'Omni Fiber internet', price: '$50/mo', highlights: MONROE_INCLUDED },
      { name: '1 Gig', speed: 'Omni Fiber internet', price: '$50/mo', highlights: MONROE_INCLUDED },
      { name: '2 Gig', speed: 'Omni Fiber internet', price: '$70/mo', highlights: MONROE_INCLUDED, featured: true },
    ],
  },
];
export const PRICING_PRESETS_DATE = 'November 15, 2026';

/** The Monroe launch market — used to seed a fresh database. */
export const MONROE: Market = marketSchema.parse({
  slug: 'monroe',
  name: 'Monroe',
  state: 'MI',
  region: 'Monroe County',
  provider: 'Omni Fiber',
  timezone: 'America/Detroit',
  phoneDisplay: '(734) 731-1946',
  phoneE164: '+17347311946',
  areaNote: 'Monroe (48161, 48162) and surrounding Monroe County communities.',
  plans: PRICING_PRESETS[1].plans,
  plansVerifiedOn: 'November 15, 2026',
  availabilityUrl: 'https://www.omnifiber.com/',
  broadbandLabelsUrl: 'https://www.omnifiber.com/broadbandlabels/',
  ogImage: '/og-monroe.jpg',
  schedule: { slotMinutes: 60, capacityPerSlot: 2, openDays: [1, 2, 3, 4, 5, 6], dayStart: '09:00', dayEnd: '19:00', minLeadHours: 12, maxDaysAhead: 21 },
  active: true,
  isDefault: true,
});
