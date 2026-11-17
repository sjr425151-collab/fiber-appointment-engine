/**
 * Reporting periods with explicit boundaries in the organization's timezone.
 * A period is [from, to): `from` is included, `to` is not. Weeks start on Monday.
 */
import { addDays, dateIn, dayOfWeek, isValidDate, zonedToUtc } from './time';

export const PERIODS = ['today', 'yesterday', 'this_week', 'last_week', 'this_month', 'last_month', 'last_7_days', 'last_30_days', 'custom'] as const;
export type PeriodKey = (typeof PERIODS)[number];

export interface Period {
  key: PeriodKey;
  label: string;
  /** Local calendar dates, inclusive, for display. */
  fromDate: string;
  toDate: string;
  /** UTC instants for queries: from <= t < to. */
  from: string;
  to: string;
  timezone: string;
}

const LABEL: Record<PeriodKey, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  this_week: 'This week',
  last_week: 'Last week',
  this_month: 'This month',
  last_month: 'Last month',
  last_7_days: 'Last 7 days',
  last_30_days: 'Last 30 days',
  custom: 'Custom range',
};

const monthStart = (d: string) => `${d.slice(0, 7)}-01`;

export function resolvePeriod(key: PeriodKey, timezone: string, o: { from?: string; to?: string; now?: Date } = {}): Period {
  const today = dateIn(timezone, o.now ?? new Date());
  // dayOfWeek: 0 = Sunday. Monday-based offset back to the start of the week.
  const weekStart = addDays(today, -((dayOfWeek(today) + 6) % 7));
  let first = today;
  let last = today;
  switch (key) {
    case 'yesterday':
      first = last = addDays(today, -1);
      break;
    case 'this_week':
      first = weekStart;
      break;
    case 'last_week':
      first = addDays(weekStart, -7);
      last = addDays(weekStart, -1);
      break;
    case 'this_month':
      first = monthStart(today);
      break;
    case 'last_month':
      last = addDays(monthStart(today), -1);
      first = monthStart(last);
      break;
    case 'last_7_days':
      first = addDays(today, -6);
      break;
    case 'last_30_days':
      first = addDays(today, -29);
      break;
    case 'custom':
      if (!o.from || !o.to || !isValidDate(o.from) || !isValidDate(o.to) || o.from > o.to) throw new Error('Choose a valid start and end date.');
      first = o.from;
      last = o.to;
      break;
    case 'today':
      break;
  }
  return {
    key,
    label: LABEL[key],
    fromDate: first,
    toDate: last,
    from: zonedToUtc(first, '00:00', timezone).toISOString(),
    to: zonedToUtc(addDays(last, 1), '00:00', timezone).toISOString(),
    timezone,
  };
}
