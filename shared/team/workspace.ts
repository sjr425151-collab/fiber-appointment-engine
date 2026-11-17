/**
 * Agent Workspace rules, in one place: dispositions and what they change,
 * qualification and outcome values, follow-up task types, note categories,
 * work queues, KPI definitions and the "next best action" rules.
 *
 * A lead has five separate facts:
 *  1. pipeline stage  (`status`, see ../lead-status.ts) — where it stands overall
 *  2. latest disposition (`disposition`) — what happened in the last interaction
 *  3. qualification   (`qualification`) — whether it meets known requirements
 *  4. outcome         (`outcome`) — the final result, once there is one
 *  5. follow-up state (`nextFollowUpAt`) — the next open task, if any
 * `applyDisposition` keeps them consistent. It is a pure function: the server
 * calls it, records the result and the event, and nothing else moves them.
 */
import type { LeadStatus } from '../lead-status';

export type WorkRole = 'admin' | 'manager' | 'rep';

export const DISPOSITION_GROUPS = [
  {
    id: 'contact',
    label: 'Contact activity',
    items: [
      ['attempted', 'Attempted contact'],
      ['no_answer', 'No answer'],
      ['voicemail', 'Voicemail left'],
      ['contacted', 'Contacted'],
      ['in_conversation', 'Conversation in progress'],
    ],
  },
  {
    id: 'interest',
    label: 'Customer interest',
    items: [
      ['interested', 'Interested'],
      ['needs_info', 'Needs more information'],
      ['considering', 'Considering options'],
      ['callback_requested', 'Callback requested'],
      ['not_interested', 'Not interested'],
    ],
  },
  {
    id: 'qualification',
    label: 'Qualification',
    items: [
      ['qualified', 'Qualified'],
      ['pending_qualification', 'Pending qualification'],
      ['serviceability_check', 'Serviceability verification needed'],
      ['not_qualified', 'Not qualified'],
      ['ineligible', 'Ineligible'],
    ],
  },
  {
    id: 'outcome',
    label: 'Opportunity outcome',
    items: [
      ['consultation_scheduled', 'Consultation scheduled'],
      ['rep_follow_up', 'Representative follow-up needed'],
      ['provider_referral', 'Provider referral initiated'],
      ['order_submitted', 'Provider order submitted (verified)'],
      ['activation_confirmed', 'Provider activation confirmed'],
      ['closed_won', 'Closed – won'],
      ['closed_lost', 'Closed – lost'],
    ],
  },
  {
    id: 'admin',
    label: 'Administrative',
    items: [
      ['duplicate', 'Duplicate'],
      ['invalid_contact', 'Invalid contact information'],
      ['do_not_contact', 'Do not contact'],
      ['spam', 'Spam / invalid submission'],
    ],
  },
] as const;

export type Disposition = (typeof DISPOSITION_GROUPS)[number]['items'][number][0];
export const DISPOSITIONS = DISPOSITION_GROUPS.flatMap((g) => g.items.map(([code]) => code)) as Disposition[];
export const DISPOSITION_LABEL = Object.fromEntries(DISPOSITION_GROUPS.flatMap((g) => g.items.map(([c, l]) => [c, l]))) as Record<Disposition, string>;
/** Shown when nothing has been recorded yet. */
export const NO_DISPOSITION_LABEL = 'New / unworked';

/** Dispositions that mean a person actually spoke with the customer. */
export const REACHED: Disposition[] = ['contacted', 'in_conversation', 'interested', 'needs_info', 'considering', 'callback_requested', 'not_interested'];
/** Dispositions that count as an attempt to reach the customer (for "contacted" KPIs, together with REACHED). */
export const ATTEMPTS: Disposition[] = ['attempted', 'no_answer', 'voicemail'];
export const INTERESTED: Disposition[] = ['interested', 'needs_info', 'considering', 'callback_requested'];

export const QUALIFICATIONS = ['unknown', 'pending', 'serviceability_check', 'qualified', 'not_qualified', 'ineligible'] as const;
export type Qualification = (typeof QUALIFICATIONS)[number];
export const QUALIFICATION_LABEL: Record<Qualification, string> = {
  unknown: 'Not assessed',
  pending: 'Pending qualification',
  serviceability_check: 'Serviceability check needed',
  qualified: 'Qualified',
  not_qualified: 'Not qualified',
  ineligible: 'Ineligible',
};

export const OUTCOMES = ['', 'won', 'lost', 'duplicate', 'invalid', 'spam'] as const;
export type Outcome = (typeof OUTCOMES)[number];
export const OUTCOME_LABEL: Record<Outcome, string> = { '': 'Open', won: 'Won (verified)', lost: 'Lost', duplicate: 'Duplicate', invalid: 'Invalid contact', spam: 'Spam' };

/** Forward order of pipeline stages; dispositions only ever move a lead forward on this scale. */
const STAGE_RANK: Partial<Record<LeadStatus, number>> = { new: 0, assigned: 1, contact_attempted: 2, contacted: 3, appointment_set: 4, qualified: 5, sold: 6, install_scheduled: 7, installed: 8 };

export interface LeadFacts {
  status: LeadStatus;
  qualification: Qualification;
  outcome: Outcome;
  doNotContact: boolean;
}
export interface DispositionInput {
  role: WorkRole;
  /** Order number, confirmation id or other proof; required where an outcome must be verified. */
  evidence?: string;
  /** Optional reason (not interested, lost, not qualified…). */
  reason?: string;
}
export type FollowUp = 'required' | 'suggested' | null;
export type DispositionResult =
  | { ok: false; error: string }
  | {
      ok: true;
      changes: Partial<LeadFacts>;
      /** Whether the representative must (or may want to) schedule a next step. */
      followUp: FollowUp;
      /** Suggested follow-up type and title, when there is an obvious next step. */
      suggestion: { kind: TaskKind; title: string } | null;
    };

const VERIFIED: Disposition[] = ['order_submitted', 'activation_confirmed', 'closed_won'];
/** Only a manager or admin may record these: they assert a verified sale. */
const MANAGER_ONLY: Disposition[] = ['activation_confirmed', 'closed_won'];
export const needsEvidence = (d: Disposition) => VERIFIED.includes(d);
export const managerOnly = (d: Disposition) => MANAGER_ONLY.includes(d);
export const needsFollowUpTime = (d: Disposition) => d === 'callback_requested' || d === 'consultation_scheduled' || d === 'rep_follow_up';

export function applyDisposition(lead: LeadFacts, d: Disposition, input: DispositionInput): DispositionResult {
  if (lead.outcome) return { ok: false, error: 'This lead is closed. A manager can reopen it first.' };
  if (managerOnly(d) && input.role === 'rep') return { ok: false, error: 'A manager or admin confirms a won sale or an activation.' };
  if (needsEvidence(d) && (input.evidence ?? '').trim().length < 4) return { ok: false, error: 'Add the provider’s order or confirmation reference. A sale is only recorded when it is verified.' };

  const changes: Partial<LeadFacts> = {};
  const forward = (to: LeadStatus) => {
    const cur = STAGE_RANK[lead.status];
    const next = STAGE_RANK[to];
    if (cur !== undefined && next !== undefined && next > cur) changes.status = to;
  };
  const close = (status: LeadStatus, outcome: Outcome) => {
    changes.status = status;
    changes.outcome = outcome;
  };
  let followUp: FollowUp = null;
  let suggestion: { kind: TaskKind; title: string } | null = null;

  switch (d) {
    case 'attempted':
    case 'no_answer':
    case 'voicemail':
      forward('contact_attempted');
      followUp = 'suggested';
      suggestion = { kind: 'call', title: 'Try calling again' };
      break;
    case 'contacted':
    case 'in_conversation':
    case 'interested':
    case 'considering':
      forward('contacted');
      break;
    case 'needs_info':
      forward('contacted');
      followUp = 'suggested';
      suggestion = { kind: 'message', title: 'Send the information they asked for' };
      break;
    case 'callback_requested':
      forward('contacted');
      followUp = 'required';
      suggestion = { kind: 'call', title: 'Call back (customer asked)' };
      break;
    case 'not_interested':
      close('not_interested', 'lost');
      break;
    case 'qualified':
      changes.qualification = 'qualified';
      forward('qualified');
      break;
    case 'pending_qualification':
      changes.qualification = 'pending';
      break;
    case 'serviceability_check':
      changes.qualification = 'serviceability_check';
      followUp = 'suggested';
      suggestion = { kind: 'verify_serviceability', title: 'Verify serviceability at the address' };
      break;
    case 'not_qualified':
      changes.qualification = 'not_qualified';
      break;
    case 'ineligible':
      changes.qualification = 'ineligible';
      break;
    case 'consultation_scheduled':
      forward('appointment_set');
      followUp = 'required';
      suggestion = { kind: 'confirm_appointment', title: 'Consultation' };
      break;
    case 'rep_follow_up':
      followUp = 'required';
      suggestion = { kind: 'general', title: 'Follow up' };
      break;
    case 'provider_referral':
      followUp = 'suggested';
      suggestion = { kind: 'check_order', title: 'Check the provider referral' };
      break;
    case 'order_submitted':
      forward('sold');
      followUp = 'suggested';
      suggestion = { kind: 'check_order', title: 'Check installation or order status' };
      break;
    case 'activation_confirmed':
      close('installed', 'won');
      break;
    case 'closed_won':
      changes.outcome = 'won';
      forward('sold');
      break;
    case 'closed_lost':
      close('lost', 'lost');
      break;
    case 'duplicate':
      close('lost', 'duplicate');
      break;
    case 'invalid_contact':
      close('lost', 'invalid');
      break;
    case 'spam':
      close('lost', 'spam');
      break;
    case 'do_not_contact':
      changes.doNotContact = true;
      break;
  }
  return { ok: true, changes, followUp, suggestion };
}

/** Stage after reopening a closed lead (manager or admin only). */
export const reopenStatus = (firstContactAt: string | null, assigned: boolean): LeadStatus => (firstContactAt ? 'contacted' : assigned ? 'assigned' : 'new');

// ------------------------------------------------------------------ tasks --
export const TASK_KINDS = ['call', 'message', 'review_savings', 'verify_serviceability', 'confirm_appointment', 'review_provider_options', 'check_order', 'general'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];
export const TASK_KIND_LABEL: Record<TaskKind, string> = {
  call: 'Call customer',
  message: 'Send message',
  review_savings: 'Review savings',
  verify_serviceability: 'Verify serviceability',
  confirm_appointment: 'Confirm appointment',
  review_provider_options: 'Review provider options',
  check_order: 'Check installation or order status',
  general: 'General follow-up',
};
/** Task types that mean reaching out to the customer: blocked while a lead is marked Do Not Contact. */
export const CONTACT_TASKS: TaskKind[] = ['call', 'message', 'confirm_appointment'];
export const TASK_PRIORITIES = ['low', 'normal', 'high'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export type TaskBucket = 'overdue' | 'today' | 'upcoming' | 'completed';
/** Calendar date (YYYY-MM-DD) of an instant in a time zone; correct across daylight-saving changes. */
export function localDate(iso: string | Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function taskBucket(t: { dueAt: string; doneAt: string | null }, now: Date, timeZone: string): TaskBucket {
  if (t.doneAt) return 'completed';
  if (new Date(t.dueAt) < now) return 'overdue';
  return localDate(t.dueAt, timeZone) === localDate(now, timeZone) ? 'today' : 'upcoming';
}
export function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(0);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------ notes --
export const NOTE_CATEGORIES = ['general', 'preferences', 'objection', 'billing', 'follow_up', 'qualification', 'provider_verification', 'handoff'] as const;
export type NoteCategory = (typeof NOTE_CATEGORIES)[number];
export const NOTE_CATEGORY_LABEL: Record<NoteCategory, string> = {
  general: 'General',
  preferences: 'Customer preferences',
  objection: 'Objection',
  billing: 'Billing information',
  follow_up: 'Follow-up',
  qualification: 'Qualification',
  provider_verification: 'Provider verification',
  handoff: 'Internal handoff',
};
export const NOTE_TEMPLATE = 'Customer concern: \nCurrent situation: \nPotential opportunity: \nNext action: ';

// ----------------------------------------------------------------- queues --
export const QUEUES = [
  { id: 'mine', label: 'All my leads', managers: false },
  { id: 'new', label: 'New leads', managers: false },
  { id: 'uncontacted', label: 'Uncontacted', managers: false },
  { id: 'followup_due', label: 'Follow-up due', managers: false },
  { id: 'interested', label: 'Interested', managers: false },
  { id: 'qualified', label: 'Qualified', managers: false },
  { id: 'consultations', label: 'Consultations scheduled', managers: false },
  { id: 'awaiting_verification', label: 'Awaiting provider verification', managers: false },
  { id: 'won', label: 'Closed won', managers: false },
  { id: 'lost', label: 'Closed lost', managers: false },
  { id: 'unassigned', label: 'Unassigned', managers: true },
] as const;
export type QueueId = (typeof QUEUES)[number]['id'];

// ------------------------------------------------------------------- KPIs --
/** Every number on the overview, with how it is counted. Counts are unique leads unless stated. */
export const KPI_DEFINITIONS: Record<string, { label: string; definition: string }> = {
  assigned: { label: 'Assigned leads', definition: 'Open leads currently assigned to you (stage not closed, no outcome).' },
  newToday: { label: 'New today', definition: 'Leads assigned to you since midnight in your time zone.' },
  contacted: { label: 'Leads worked', definition: 'Unique leads with at least one contact disposition (attempt or conversation) recorded by you in the period.' },
  followUpsDue: { label: 'Follow-ups due today', definition: 'Your open follow-ups due between now and midnight in your time zone.' },
  overdue: { label: 'Overdue', definition: 'Your open follow-ups whose due time has passed.' },
  interested: { label: 'Interested', definition: 'Your open leads whose latest disposition is Interested, Needs more information, Considering options or Callback requested.' },
  qualified: { label: 'Qualified', definition: 'Your open leads with qualification set to Qualified.' },
  consultations: { label: 'Consultations', definition: 'Your open leads at the Appointment scheduled stage.' },
  won: { label: 'Verified wins', definition: 'Your leads given a Won outcome in the period. A win needs a provider reference and a manager or admin.' },
  leadToContact: { label: 'Lead → contact', definition: 'Of leads assigned to you in the period, the share where a conversation was confirmed.' },
  contactToQualified: { label: 'Contact → qualified', definition: 'Of those contacted leads, the share that reached Qualified.' },
  qualifiedToWon: { label: 'Qualified → won', definition: 'Of those qualified leads, the share with a verified Won outcome.' },
};

/**
 * Next best actions, in this fixed order (oldest first within each rule):
 *  1. overdue follow-ups
 *  2. follow-ups due in the next two hours
 *  3. assigned leads with nothing recorded yet
 *  4. leads waiting for a serviceability check
 *  5. qualified leads with no next step scheduled
 * No scores are invented: every item says which rule put it there.
 */
export const NEXT_ACTION_RULES = ['overdue_task', 'task_due_soon', 'new_lead', 'serviceability', 'qualified_no_next_step'] as const;
export type NextActionRule = (typeof NEXT_ACTION_RULES)[number];
export const NEXT_ACTION_LABEL: Record<NextActionRule, string> = {
  overdue_task: 'Overdue follow-up',
  task_due_soon: 'Follow-up due soon',
  new_lead: 'New lead awaiting first response',
  serviceability: 'Awaiting serviceability confirmation',
  qualified_no_next_step: 'Qualified, no next step scheduled',
};
