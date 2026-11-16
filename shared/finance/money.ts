/**
 * Money primitives. All monetary values are integer cents (`Cents`); rates are
 * integer basis points (1 bp = 0.01%). Binary floating point never touches a
 * stored or displayed total: every division goes through `divRound`, which is
 * exact for integers within Number.MAX_SAFE_INTEGER.
 */

/** Integer number of US cents. Negative values are credits/refunds. */
export type Cents = number;
/** Integer basis points: 10000 bp = 100%. */
export type Bps = number;

export class MoneyError extends Error {}

export function assertCents(v: number, what = 'amount'): Cents {
  if (!Number.isSafeInteger(v)) throw new MoneyError(`${what} must be an integer number of cents (got ${v})`);
  return v;
}

/** Integer division rounded half away from zero (e.g. 2.5 → 3, −2.5 → −3). */
export function divRound(numerator: number, denominator: number): number {
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator)) throw new MoneyError('divRound needs safe integers');
  if (denominator === 0) throw new MoneyError('Division by zero');
  if (denominator < 0) return divRound(-numerator, -denominator);
  const sign = numerator < 0 ? -1 : 1;
  const n = Math.abs(numerator);
  let q = Math.floor(n / denominator);
  // Correct any float drift so q is the exact integer quotient.
  while (q * denominator > n) q--;
  while ((q + 1) * denominator <= n) q++;
  const r = n - q * denominator;
  if (r * 2 >= denominator) q++;
  return sign * q;
}

/** Multiply cents by a rate in basis points, rounding half away from zero. */
export const applyBps = (amount: Cents, bps: Bps): Cents => divRound(assertCents(amount) * bps, 10_000);

/** Pro-rate an amount by a fraction (e.g. 12 of 30 days). */
export function prorate(amount: Cents, part: number, whole: number): Cents {
  if (!Number.isInteger(part) || !Number.isInteger(whole) || whole <= 0 || part < 0 || part > whole) {
    throw new MoneyError(`Invalid proration ${part}/${whole}`);
  }
  return divRound(assertCents(amount) * part, whole);
}

export const sum = (values: Cents[]): Cents => values.reduce((a, b) => assertCents(a + b, 'sum'), 0);

/**
 * Parse a user-entered dollar amount ("$1,234.5", "49.99") into cents without
 * floating point. Returns null for blanks; throws for malformed input.
 */
export function parseDollars(input: string): Cents | null {
  const s = input.trim().replace(/[$,\s]/g, '');
  if (s === '') return null;
  const m = /^(-)?(\d+)(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) throw new MoneyError(`"${input}" is not a valid dollar amount`);
  const cents = Number(m[2]) * 100 + Number((m[3] ?? '').padEnd(2, '0') || '0');
  return assertCents(m[1] ? -cents : cents, 'parsed amount');
}

/** Format cents for display: 12345 → "$123.45", -500 → "−$5.00". */
export function formatCents(c: Cents, opts: { cents?: boolean } = {}): string {
  assertCents(c);
  const abs = Math.abs(c);
  const dollars = Math.floor(abs / 100).toLocaleString('en-US');
  const body = opts.cents === false && abs % 100 === 0 ? `$${dollars}` : `$${dollars}.${String(abs % 100).padStart(2, '0')}`;
  return c < 0 ? `−${body}` : body;
}
