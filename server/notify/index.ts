import { randomUUID } from 'node:crypto';
import type { Appointment, Lead } from '../../shared/schemas';
import type { Market } from '../../shared/market';
import type { AppConfig } from '../config';
import type { DB } from '../db';
import * as repo from '../repo';
import { buildIcs } from './ics';
import { LogMailer, MailError, ResendMailer, type Mailer, type OutgoingEmail } from './mailer';
import * as t from './templates';

export type NotificationKind =
  | 'team_new_lead'
  | 'team_returning_lead'
  | 'team_booking'
  | 'customer_confirmation'
  | 'customer_reminder'
  | 'customer_lead_received';

export interface NotificationRow {
  id: string;
  kind: NotificationKind;
  leadId: string;
  appointmentId: string | null;
  marketId: string;
  status: 'pending' | 'sending' | 'sent' | 'logged' | 'skipped' | 'failed';
  sendAfter: string;
  attempts: number;
  to: string;
  subject: string;
  error: string;
  sentAt: string | null;
  createdAt: string;
}

const MAX_ATTEMPTS = 5;
/** Abuse guard: the lead form emails whatever address is typed in. */
export const PER_RECIPIENT_DAILY_LIMIT = 3;
const BACKOFF_MIN = [1, 5, 15, 60]; // minutes before attempts 2..5
/** "We got your request" waits this long, and is skipped if they book meanwhile. */
export const LEAD_FOLLOWUP_DELAY_MIN = 20;

/** Reminder 24h before; if that's too soon, 3h before; none if the appointment is imminent. */
export function reminderTime(startUtc: string, now = new Date()): Date | null {
  const start = new Date(startUtc).getTime();
  const dayBefore = start - 24 * 3600_000;
  if (dayBefore >= now.getTime() + 30 * 60_000) return new Date(dayBefore);
  const threeBefore = start - 3 * 3600_000;
  return threeBefore > now.getTime() ? new Date(threeBefore) : null;
}

const toRow = (r: Record<string, unknown>): NotificationRow => ({
  id: r.id as string,
  kind: r.kind as NotificationKind,
  leadId: r.lead_id as string,
  appointmentId: (r.appointment_id as string) ?? null,
  marketId: r.market_id as string,
  status: r.status as NotificationRow['status'],
  sendAfter: r.send_after as string,
  attempts: r.attempts as number,
  to: r.to_addr as string,
  subject: r.subject as string,
  error: r.error as string,
  sentAt: (r.sent_at as string) ?? null,
  createdAt: r.created_at as string,
});

export function listNotifications(db: DB, leadId: string): NotificationRow[] {
  return (db.prepare('SELECT * FROM notifications WHERE lead_id = ? ORDER BY created_at, send_after').all(leadId) as Record<string, unknown>[]).map(toRow);
}

export function mailerFromConfig(config: AppConfig): Mailer {
  return config.email.resendApiKey ? new ResendMailer(config.email.resendApiKey) : new LogMailer(process.env.NODE_ENV === 'test');
}

export type Notifier = ReturnType<typeof createNotifier>;

export function createNotifier(db: DB, config: AppConfig, mailer: Mailer = mailerFromConfig(config)) {
  const now = () => new Date().toISOString();

  function enqueue(kind: NotificationKind, leadId: string, marketId: string, sendAfter: Date, appointmentId: string | null = null) {
    const ts = now();
    db.prepare(
      'INSERT INTO notifications (id, kind, lead_id, appointment_id, market_id, status, send_after, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(randomUUID(), kind, leadId, appointmentId, marketId, 'pending', sendAfter.toISOString(), ts, ts);
  }

  const teamTo = (m: Market) => (m.notifyEmails.length ? m.notifyEmails : config.email.teamEmails);
  const adminUrl = (lead: Lead) => `${config.siteUrl}/admin/leads/${lead.id}`;

  /** Build the email for a row from *current* data, or explain why it shouldn't be sent. */
  function build(row: NotificationRow, at: Date): { email: OutgoingEmail } | { skip: string } {
    const lead = repo.getLead(db, row.leadId);
    if (!lead) return { skip: 'Lead no longer exists' };
    const market = repo.getMarket(db, row.marketId || lead.marketId) ?? repo.getDefaultMarket(db);
    const appt: Appointment | null = row.appointmentId ? repo.getAppointment(db, row.appointmentId) : null;
    const base = { from: config.email.from, idempotencyKey: row.id, tags: [{ name: 'kind', value: row.kind }] };
    const team = teamTo(market);

    // Non-production emails are labelled so nobody mistakes a staging alert for a real lead.
    const label = (r: t.Rendered): t.Rendered => (config.flags.env === 'production' ? r : { ...r, subject: `[${config.flags.env.toUpperCase()}] ${r.subject}` });
    const forTeam = (raw: t.Rendered): { email: OutgoingEmail } | { skip: string } => {
      const r = label(raw);
      return team.length ? { email: { ...base, ...r, to: team, replyTo: [lead.email] } } : { skip: 'No team email configured for this location' };
    };
    const forCustomer = (raw: t.Rendered, extra: Partial<OutgoingEmail> = {}): { email: OutgoingEmail } | { skip: string } => {
      const r = label(raw);
      if (config.flags.env !== 'production' && !allowedOutsideProduction(lead.email, config.email.nonProductionAllowlist)) {
        return { skip: `${config.flags.env}: customer emails only go to STAGING_EMAIL_ALLOWLIST addresses` };
      }
      const since = new Date(at.getTime() - 24 * 3600_000).toISOString();
      const toThem = db
        .prepare("SELECT COUNT(*) AS n FROM notifications WHERE to_addr = ? AND status IN ('sent','logged') AND sent_at >= ?")
        .get(lead.email, since) as { n: number };
      if (toThem.n >= PER_RECIPIENT_DAILY_LIMIT) return { skip: `Recipient limit reached (${PER_RECIPIENT_DAILY_LIMIT} emails per 24h)` };
      const total = db
        .prepare("SELECT COUNT(*) AS n FROM notifications WHERE kind LIKE 'customer_%' AND status = 'sent' AND sent_at >= ?")
        .get(since) as { n: number };
      if (total.n >= config.email.dailyCustomerLimit) return { skip: 'Daily customer email limit reached' };
      return { email: { ...base, ...r, to: [lead.email], ...(team.length ? { replyTo: [team[0]] } : {}), ...extra } };
    };

    switch (row.kind) {
      case 'team_new_lead':
      case 'team_returning_lead':
        return forTeam(t.teamNewLead(lead, market, adminUrl(lead), row.kind === 'team_returning_lead'));
      case 'team_booking':
        if (!appt) return { skip: 'Appointment not found' };
        return forTeam(t.teamBooking(lead, appt, market, adminUrl(lead)));
      case 'customer_confirmation': {
        if (!appt || appt.status !== 'scheduled') return { skip: 'Appointment is no longer scheduled' };
        const ics = buildIcs({
          uid: `${appt.id}@fiber-connect`,
          startUtc: appt.startUtc,
          endUtc: appt.endUtc,
          summary: `Free fiber consultation (${market.provider})`,
          description: `Your free fiber consultation with ${market.name} Fiber Connect.${market.phoneDisplay ? ` Questions? Call or text ${market.phoneDisplay}.` : ''}`,
          location: [lead.street, lead.unit, `${lead.city}, ${market.state} ${lead.zip}`].filter(Boolean).join(', '),
        });
        return forCustomer(t.customerConfirmation(lead, appt, market), {
          attachments: [{ filename: 'fiber-consultation.ics', content: Buffer.from(ics).toString('base64') }],
        });
      }
      case 'customer_reminder':
        if (!appt || appt.status !== 'scheduled') return { skip: 'Appointment is no longer scheduled' };
        if (new Date(appt.startUtc) <= at) return { skip: 'Appointment time has passed' };
        return forCustomer(t.customerReminder(lead, appt, market));
      case 'customer_lead_received': {
        const booked = repo.listAppointments(db, { leadId: lead.id }).some((a) => a.status !== 'cancelled');
        if (booked) return { skip: 'Lead booked an appointment (confirmation sent instead)' };
        return forCustomer(t.customerLeadReceived(lead, market));
      }
    }
  }

  let running: Promise<number> | null = null;

  /** Send everything that's due. Safe to call concurrently — runs are serialized. */
  function processDue(at = new Date()): Promise<number> {
    if (running) return running.then(() => processDue(at));
    running = (async () => {
      let handled = 0;
      for (;;) {
        // Claim a batch atomically so a row is never sent twice.
        const claimed = (
          db
            .prepare(
              `UPDATE notifications SET status = 'sending', attempts = attempts + 1, updated_at = ?
               WHERE id IN (SELECT id FROM notifications WHERE status = 'pending' AND send_after <= ? ORDER BY send_after LIMIT 20)
               RETURNING *`,
            )
            .all(now(), at.toISOString()) as Record<string, unknown>[]
        ).map(toRow);
        if (!claimed.length) return handled;
        for (const row of claimed) {
          handled++;
          const built = build(row, at);
          if ('skip' in built) {
            db.prepare("UPDATE notifications SET status = 'skipped', error = ?, updated_at = ? WHERE id = ?").run(built.skip, now(), row.id);
            continue;
          }
          const { email } = built;
          try {
            const res = await mailer.send(email);
            db.prepare('UPDATE notifications SET status = ?, to_addr = ?, subject = ?, provider_id = ?, error = ?, sent_at = ?, updated_at = ? WHERE id = ?').run(
              res.status, email.to.join(', '), email.subject, res.providerId, '', now(), now(), row.id,
            );
          } catch (err) {
            const retryable = !(err instanceof MailError) || err.retryable;
            const message = err instanceof Error ? err.message : String(err);
            const giveUp = !retryable || row.attempts >= MAX_ATTEMPTS;
            const next = new Date(at.getTime() + (BACKOFF_MIN[row.attempts - 1] ?? 60) * 60_000).toISOString();
            db.prepare('UPDATE notifications SET status = ?, send_after = ?, to_addr = ?, subject = ?, error = ?, updated_at = ? WHERE id = ?').run(
              giveUp ? 'failed' : 'pending', giveUp ? row.sendAfter : next, email.to.join(', '), email.subject, message.slice(0, 500), now(), row.id,
            );
            if (giveUp) console.error(`[email] gave up on ${row.kind} ${row.id} after ${row.attempts} attempt(s)`);
          }
        }
      }
    })().finally(() => {
      running = null;
    });
    return running;
  }

  /** Process soon without blocking the caller (used right after enqueueing). */
  function kick() {
    setImmediate(() => processDue().catch((err) => console.error('[email] worker error', err)));
  }

  return {
    mailer,
    enabled: mailer.enabled,
    teamTo,
    processDue,

    onLead(lead: Lead, duplicate: boolean) {
      enqueue(duplicate ? 'team_returning_lead' : 'team_new_lead', lead.id, lead.marketId, new Date());
      if (!duplicate) enqueue('customer_lead_received', lead.id, lead.marketId, new Date(Date.now() + LEAD_FOLLOWUP_DELAY_MIN * 60_000));
      kick();
    },

    onBooked(appt: Appointment) {
      const lead = repo.getLead(db, appt.leadId);
      if (!lead) return;
      // Re-submitting the same slot returns the existing appointment — don't email twice.
      if (db.prepare('SELECT 1 FROM notifications WHERE appointment_id = ? LIMIT 1').get(appt.id)) return;
      enqueue('team_booking', lead.id, appt.marketId, new Date(), appt.id);
      enqueue('customer_confirmation', lead.id, appt.marketId, new Date(), appt.id);
      const remindAt = reminderTime(appt.startUtc);
      if (remindAt) enqueue('customer_reminder', lead.id, appt.marketId, remindAt, appt.id);
      kick();
    },

    /** Background loop: every minute, plus recovery of rows stuck mid-send by a crash. */
    start(intervalMs = 60_000) {
      db.prepare("UPDATE notifications SET status = 'pending', updated_at = ? WHERE status = 'sending' AND updated_at < ?").run(
        now(),
        new Date(Date.now() - 10 * 60_000).toISOString(),
      );
      const timer = setInterval(() => processDue().catch((err) => console.error('[email] worker error', err)), intervalMs);
      timer.unref();
      kick();
      return () => clearInterval(timer);
    },
  };
}

/** Outside production, a customer address must match an allow-list entry: an exact address or "@domain". */
export function allowedOutsideProduction(email: string, allowlist: string[]): boolean {
  const e = email.trim().toLowerCase();
  return allowlist.some((a) => (a.startsWith('@') ? e.endsWith(a) : e === a));
}
