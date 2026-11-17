/**
 * CRM adapter. No CRM is connected today: every lead is stored in Tucker's own
 * database and worked in the team area. When a CRM is chosen, implement this
 * interface and pass it to the app; pushes must be retry-safe (use the lead id
 * as the idempotency key) and their outcome recorded, like the email outbox.
 */
import type { Lead } from '../../shared/schemas';

export interface CrmAdapter {
  readonly name: string;
  /** False means nothing is sent anywhere; the team area says so. */
  readonly configured: boolean;
  /** Create or update the lead in the CRM. Must be safe to call twice for the same lead. */
  pushLead(lead: Lead): Promise<{ externalId: string }>;
}

export const noCrm: CrmAdapter = {
  name: 'none',
  configured: false,
  pushLead: () => Promise.reject(new Error('No CRM is connected')),
};
