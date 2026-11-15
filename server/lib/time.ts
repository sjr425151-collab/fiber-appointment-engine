/** Timezone helpers built on Intl — no external date library needed. */

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string) {
  let f = fmtCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    fmtCache.set(timeZone, f);
  }
  return f;
}

/** Offset of `timeZone` from UTC, in minutes, at the given instant. */
function offsetMinutes(utcMs: number, timeZone: string): number {
  const parts = partsFormatter(timeZone).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
}

/** Convert a wall-clock date/time in `timeZone` to a UTC Date (DST-aware). */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const naive = Date.UTC(y, mo - 1, d, h, mi);
  let utc = naive - offsetMinutes(naive, timeZone) * 60000;
  // Second pass corrects for DST transitions between the guess and the result.
  utc = naive - offsetMinutes(utc, timeZone) * 60000;
  return new Date(utc);
}

/** Day of week (0 = Sunday) of a YYYY-MM-DD calendar date. */
export function dayOfWeek(date: string): number {
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

/** The calendar date (YYYY-MM-DD) in `timeZone` at instant `now`. */
export function dateIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function addDays(date: string, days: number): string {
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d + days)).toISOString().slice(0, 10);
}

export function formatTime(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(d);
}

export function isValidDate(date: string): boolean {
  const [y, mo, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}
