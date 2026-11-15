import type { Appointment, Slot } from '../shared/schemas';
import { transaction, type DB } from './db';
import { safeEqual, sha256 } from './lib/auth';
import { addDays, dateIn, dayOfWeek, formatTime, isValidDate, zonedToUtc } from './lib/time';
import * as repo from './repo';

export interface ScheduleRules {
  slotMinutes: number;
  capacityPerSlot: number;
  openDays: number[];
  dayStart: string;
  dayEnd: string;
  minLeadHours: number;
  maxDaysAhead: number;
}

export function rulesFromSettings(s: Record<string, string>): ScheduleRules {
  return {
    slotMinutes: Number(s['schedule.slotMinutes'] ?? 60),
    capacityPerSlot: Number(s['schedule.capacityPerSlot'] ?? 1),
    openDays: (s['schedule.openDays'] ?? '1,2,3,4,5').split(',').map(Number),
    dayStart: s['schedule.dayStart'] ?? '09:00',
    dayEnd: s['schedule.dayEnd'] ?? '17:00',
    minLeadHours: Number(s['schedule.minLeadHours'] ?? 12),
    maxDaysAhead: Number(s['schedule.maxDaysAhead'] ?? 21),
  };
}

/** All bookable dates (YYYY-MM-DD, local) within the booking window. */
export function bookableDates(rules: ScheduleRules, timeZone: string, now = new Date()): string[] {
  const today = dateIn(timeZone, now);
  const out: string[] = [];
  for (let i = 0; i <= rules.maxDaysAhead; i++) {
    const d = addDays(today, i);
    if (rules.openDays.includes(dayOfWeek(d))) out.push(d);
  }
  return out;
}

/** Candidate slot start times for a local date, ignoring existing bookings. */
export function candidateSlots(date: string, rules: ScheduleRules, timeZone: string, now = new Date()) {
  if (!isValidDate(date) || !bookableDates(rules, timeZone, now).includes(date)) return [];
  const start = zonedToUtc(date, rules.dayStart, timeZone).getTime();
  const end = zonedToUtc(date, rules.dayEnd, timeZone).getTime();
  const step = rules.slotMinutes * 60000;
  const earliest = now.getTime() + rules.minLeadHours * 3600000;
  const out: { start: Date; end: Date }[] = [];
  for (let t = start; t + step <= end; t += step) {
    if (t >= earliest) out.push({ start: new Date(t), end: new Date(t + step) });
  }
  return out;
}

export function availableSlots(db: DB, date: string, timeZone: string, now = new Date()): Slot[] {
  const rules = rulesFromSettings(repo.getSettings(db));
  const candidates = candidateSlots(date, rules, timeZone, now);
  if (!candidates.length) return [];
  const booked = repo.bookedCountsBetween(
    db,
    candidates[0].start.toISOString(),
    candidates[candidates.length - 1].end.toISOString(),
  );
  return candidates
    .map((c) => {
      const startUtc = c.start.toISOString();
      return {
        startUtc,
        endUtc: c.end.toISOString(),
        label: formatTime(c.start, timeZone),
        remaining: rules.capacityPerSlot - (booked.get(startUtc) ?? 0),
      };
    })
    .filter((s) => s.remaining > 0);
}

export class BookingError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Book (or reschedule) the lead's appointment. Runs in a single write
 * transaction so two people can never take the last seat in a slot.
 */
export function bookAppointment(
  db: DB,
  input: { leadId: string; token: string; startUtc: string; notes: string },
  timeZone: string,
  now = new Date(),
): Appointment {
  return transaction(db, () => {
    const tokenHash = repo.getLeadTokenHash(db, input.leadId);
    if (!tokenHash || !safeEqual(tokenHash, sha256(input.token))) {
      throw new BookingError(403, 'This booking link is invalid or has expired. Please resubmit the form.');
    }

    const start = new Date(input.startUtc);
    const startUtc = start.toISOString();
    const rules = rulesFromSettings(repo.getSettings(db));
    const localDate = dateIn(timeZone, start);
    const slot = candidateSlots(localDate, rules, timeZone, now).find((c) => c.start.toISOString() === startUtc);
    if (!slot) throw new BookingError(400, 'That time is not available. Please choose another slot.');

    const existing = repo.getActiveAppointmentForLead(db, input.leadId);
    if (existing?.startUtc === startUtc) return existing;

    if (repo.countBookedAt(db, startUtc) >= rules.capacityPerSlot) {
      throw new BookingError(409, 'Someone just booked that time. Please pick another slot.');
    }

    if (existing) {
      repo.setAppointmentStatus(db, existing.id, 'cancelled');
      repo.addNote(db, input.leadId, `Rescheduled from ${existing.startUtc} to ${startUtc}`, 'system');
    }
    const appt = repo.insertAppointment(db, {
      leadId: input.leadId,
      startUtc,
      endUtc: slot.end.toISOString(),
      notes: input.notes,
    });
    const lead = repo.getLead(db, input.leadId)!;
    if (lead.status === 'new' || lead.status === 'contacted') {
      repo.updateLeadStatus(db, input.leadId, 'appointment_set', 'system');
    }
    return appt;
  });
}
