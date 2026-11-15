import { z } from 'zod';

/** Lead pipeline stages — sales & installation tracking builds on these. */
export const LEAD_STATUSES = [
  'new',
  'contacted',
  'appointment_set',
  'sold',
  'install_scheduled',
  'installed',
  'lost',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const AREA_STATUSES = ['available', 'verify', 'coming_soon', 'not_serviceable'] as const;
export type AreaStatus = (typeof AREA_STATUSES)[number];

export const CONTACT_METHODS = ['phone', 'text', 'email'] as const;

const zip = z
  .string()
  .trim()
  .regex(/^\d{5}$/, 'Enter a 5-digit ZIP code');

const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''))
  .refine((v) => /^\d{10}$/.test(v), 'Enter a valid 10-digit US phone number');

export const availabilityQuerySchema = z.object({ zip });

export const leadInputSchema = z.object({
  firstName: z.string().trim().min(1, 'First name is required').max(60),
  lastName: z.string().trim().min(1, 'Last name is required').max(60),
  email: z.string().trim().toLowerCase().email('Enter a valid email').max(254),
  phone,
  street: z.string().trim().min(3, 'Street address is required').max(120),
  unit: z.string().trim().max(30).optional().default(''),
  city: z.string().trim().min(2, 'City is required').max(60),
  zip,
  preferredContact: z.enum(CONTACT_METHODS).default('phone'),
  currentProvider: z.string().trim().max(60).optional().default(''),
  /** TCPA: express written consent to be contacted. Must be true. */
  consent: z.literal(true, { error: 'Consent is required so we can contact you' }),
  source: z.string().trim().max(60).optional().default('landing_page'),
  utmSource: z.string().trim().max(100).optional().default(''),
  utmMedium: z.string().trim().max(100).optional().default(''),
  utmCampaign: z.string().trim().max(100).optional().default(''),
  utmContent: z.string().trim().max(100).optional().default(''),
  utmTerm: z.string().trim().max(100).optional().default(''),
  /** gclid / fbclid / msclkid from ad or social clicks. */
  clickId: z.string().trim().max(255).optional().default(''),
  referrer: z.string().trim().max(500).optional().default(''),
  landingPage: z.string().trim().max(300).optional().default(''),
  sessionId: z.string().trim().max(64).optional().default(''),
  /** Honeypot: real users never fill this hidden field. */
  website: z.string().optional().default(''),
});
export type LeadInput = z.input<typeof leadInputSchema>;

export const bookingInputSchema = z.object({
  leadId: z.string().uuid(),
  /** Booking token issued with the lead so only the submitter can book for it. */
  token: z.string().min(16).max(128),
  startUtc: z.string().datetime(),
  notes: z.string().trim().max(500).optional().default(''),
});

export const slotsQuerySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'),
});

/** Conversion events accepted from the browser. */
export const TRACKED_EVENTS = [
  'page_view',
  'cta_click',
  'zip_check',
  'form_start',
  'lead_submit',
  'appointment_booked',
  'booking_skipped',
  'call_click',
  'sms_click',
] as const;
export type TrackedEvent = (typeof TRACKED_EVENTS)[number];

export const eventInputSchema = z.object({
  name: z.enum(TRACKED_EVENTS),
  sessionId: z.string().trim().max(64).default(''),
  path: z.string().trim().max(300).default(''),
  props: z.record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean()])).default({}),
  utmSource: z.string().trim().max(100).default(''),
  utmCampaign: z.string().trim().max(100).default(''),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

export const leadUpdateSchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  note: z.string().trim().min(1).max(2000).optional(),
});

export const appointmentUpdateSchema = z.object({
  status: z.enum(['scheduled', 'completed', 'no_show', 'cancelled']),
});

export const serviceAreaSchema = z.object({
  zip,
  city: z.string().trim().min(2).max(60),
  status: z.enum(AREA_STATUSES),
});

// ---- API response types ----
export interface AvailabilityResult {
  zip: string;
  city: string | null;
  status: AreaStatus | 'unknown';
  headline: string;
  message: string;
}

export interface Slot {
  startUtc: string;
  endUtc: string;
  label: string;
  remaining: number;
}

export interface Lead {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  street: string;
  unit: string;
  city: string;
  zip: string;
  preferredContact: string;
  currentProvider: string;
  status: LeadStatus;
  areaStatus: string;
  source: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  utmTerm: string;
  clickId: string;
  referrer: string;
  landingPage: string;
  consentAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface Appointment {
  id: string;
  leadId: string;
  startUtc: string;
  endUtc: string;
  status: 'scheduled' | 'completed' | 'no_show' | 'cancelled';
  notes: string;
  createdAt: string;
  leadName?: string;
  leadPhone?: string;
  leadAddress?: string;
}

export interface LeadNote {
  id: string;
  leadId: string;
  body: string;
  author: string;
  createdAt: string;
}
