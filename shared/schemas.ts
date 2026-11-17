import { z } from 'zod';

// Our CSP forbids eval; tell Zod not to probe for it (it would log a CSP violation).
z.config({ jitless: true });

export { CLOSED_LEAD_STATUSES, LEAD_STATUS_LABEL, LEAD_STATUSES, OPEN_LEAD_STATUSES, type LeadStatus } from './lead-status';
import { LEAD_STATUSES, type LeadStatus } from './lead-status';

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
  /** Market slug the visitor signed up through (defaults to the default market). */
  market: z.string().trim().max(40).optional().default(''),
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
  market: z.string().trim().max(40).optional(),
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
  'outbound_click',
  'assessment_start',
  'assessment_step',
  'results_view',
  'results_adjust',
  'assessment_complete',
  'advisor_request',
  // Representative handoff funnel
  'preview_view',
  'handoff_cta_view',
  'handoff_cta_click',
  'handoff_start',
  'handoff_error',
  'handoff_submit',
  'rep_assigned',
  'lead_qualified',
  'lead_converted',
  // Website chat
  'chat_open',
  'chat_first_message',
  'chat_preview',
  'chat_handoff_click',
  'chat_handoff_submit',
] as const;
/** Recorded by the server when the thing actually happened; the same name from a browser is ignored. */
export const SERVER_ONLY_EVENTS: readonly string[] = ['lead_submit', 'appointment_booked', 'handoff_submit', 'rep_assigned', 'lead_qualified', 'lead_converted', 'chat_open', 'chat_preview', 'chat_handoff_submit'];
export type TrackedEvent = (typeof TRACKED_EVENTS)[number];

export const eventInputSchema = z.object({
  name: z.enum(TRACKED_EVENTS),
  sessionId: z.string().trim().max(64).default(''),
  path: z.string().trim().max(300).default(''),
  props: z
    .record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean()]))
    .refine((o) => Object.keys(o).length <= 10, 'Too many event properties')
    .refine((o) => JSON.stringify(o).length <= 1000, 'Event properties too large')
    .default({}),
  utmSource: z.string().trim().max(100).default(''),
  utmCampaign: z.string().trim().max(100).default(''),
  market: z.string().trim().max(40).default(''),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

export const leadUpdateSchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  note: z.string().trim().min(1).max(2000).optional(),
  /** Admin only: hand the lead to a representative, or null to return it to the queue. */
  assignRepId: z.union([z.string().uuid(), z.null()]).optional(),
});

const slugList = z.array(z.string().trim().regex(/^(\*|[a-z0-9-]{2,40})$/)).max(50);
/** A representative who receives leads and can sign in to see only their own. */
export const repInputSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(80),
  email: z.string().trim().toLowerCase().email('Enter a valid email').max(254),
  phone: z.string().trim().max(30).optional().default(''),
  active: z.boolean().optional().default(true),
  /** Set by a person: "send new leads to this representative now". */
  accepting: z.boolean().optional().default(false),
  /** Location slugs, or "*" for every served location. */
  markets: slugList.optional().default(['*']),
  /** Services handled; empty means all. */
  categories: z.array(z.enum(['internet', 'mobile', 'tv', 'electricity', 'security'])).max(5).optional().default([]),
  maxOpenLeads: z.number().int().min(0).max(1000).optional().default(0),
  /** Sign-in password; leave out to keep the current one. */
  password: z.string().min(12, 'Use at least 12 characters').max(200).optional(),
  /** Representative or sales manager (managers see and reassign every lead). Leave out to keep the current role. */
  role: z.enum(['rep', 'manager']).optional(),
});

export interface Representative {
  id: string;
  name: string;
  email: string;
  phone: string;
  active: boolean;
  accepting: boolean;
  markets: string[];
  categories: ('internet' | 'mobile' | 'tv' | 'electricity' | 'security')[];
  maxOpenLeads: number;
  canSignIn: boolean;
  /** admin | manager | rep | analyst (see shared/team/permissions.ts). */
  role: 'admin' | 'manager' | 'rep' | 'analyst';
  status: 'invited' | 'active' | 'suspended' | 'deactivated';
  teamId: string | null;
  /** Short human id, e.g. R-1001. */
  repCode: string;
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  openLeads: number;
  lastAssignedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export const appointmentUpdateSchema = z.object({
  status: z.enum(['scheduled', 'completed', 'no_show', 'cancelled']),
});

export const serviceAreaSchema = z.object({
  zip,
  city: z.string().trim().min(2).max(60),
  status: z.enum(AREA_STATUSES),
  marketId: z.string().trim().min(2).max(40),
});

// ---- API response types ----
export interface AvailabilityResult {
  zip: string;
  city: string | null;
  /** Market the ZIP belongs to (may differ from the page the visitor is on). */
  market: { slug: string; name: string; state: string } | null;
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
  marketId: string;
  /** Earlier lead with the same email + phone, when this is a repeat submission. */
  duplicateOf: string | null;
  /** Household assessment this lead came from (parent platform). */
  assessmentId: string | null;
  /** Representative this lead is assigned to, if any. */
  assignedRepId: string | null;
  assignedAt: string | null;
  /** Result of automatic routing: assigned, queued or unsupported ('' for leads from before routing). */
  routingOutcome: string;
  routingReason: string;
  /** What the customer was shown when they asked for help (illustrative, never a quote). */
  preview: unknown;
  bestTime: string;
  marketingConsent: boolean;
  /** When a representative first confirmed speaking with the customer. */
  firstContactAt: string | null;
  consentAt: string;
  createdAt: string;
  updatedAt: string;
  // Agent workspace (see shared/team/workspace.ts).
  preferredName: string;
  householdNotes: string;
  disposition: string;
  dispositionAt: string | null;
  qualification: string;
  qualifiedAt: string | null;
  outcome: string;
  outcomeAt: string | null;
  doNotContact: boolean;
  nextFollowUpAt: string | null;
  lastActivityAt: string | null;
  /** Goes up on every change; an edit must name the version it started from. */
  version: number;
}

export interface Appointment {
  id: string;
  leadId: string;
  startUtc: string;
  endUtc: string;
  status: 'scheduled' | 'completed' | 'no_show' | 'cancelled';
  notes: string;
  createdAt: string;
  marketId: string;
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
  /** 'note' is written by a person (or a handoff summary); 'system' lines record changes. */
  kind: 'note' | 'system';
  category: string;
  pinned: boolean;
  editedAt: string | null;
  editedBy: string;
  archivedAt: string | null;
}
