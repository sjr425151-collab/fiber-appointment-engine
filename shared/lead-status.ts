/**
 * Lead lifecycle. Stored values are stable; labels are what people see.
 * `sold` is shown as "Converted" and `lost` as "Closed" (their stored names
 * predate the household platform). A status only changes when a person or a
 * confirmed event changes it: routing sets `assigned`, a booking sets
 * `appointment_set`, and everything else is set by a representative.
 */
export const LEAD_STATUSES = [
  'new',
  'assigned',
  'contact_attempted',
  'contacted',
  'appointment_set',
  'qualified',
  'sold',
  'install_scheduled',
  'installed',
  'not_interested',
  'unserviceable',
  'lost',
] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  new: 'New',
  assigned: 'Assigned',
  contact_attempted: 'Contact attempted',
  contacted: 'Contacted',
  appointment_set: 'Appointment scheduled',
  qualified: 'Qualified',
  sold: 'Converted',
  install_scheduled: 'Install scheduled',
  installed: 'Installed',
  not_interested: 'Not interested',
  unserviceable: 'Unserviceable',
  lost: 'Closed',
};

/** Still being worked: counts toward a representative's open leads. */
export const OPEN_LEAD_STATUSES: LeadStatus[] = ['new', 'assigned', 'contact_attempted', 'contacted', 'appointment_set', 'qualified'];
/** Finished without a sale: a new request from the same person starts a fresh lead. */
export const CLOSED_LEAD_STATUSES: LeadStatus[] = ['not_interested', 'unserviceable', 'lost'];
