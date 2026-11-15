import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SCRYPT_N = 16384;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: SCRYPT_N });
  return ['scrypt', SCRYPT_N, salt.toString('base64url'), hash.toString('base64url')].join(':');
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, n, saltB64, hashB64] = stored.split(':');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  try {
    const expected = Buffer.from(hashB64, 'base64url');
    if (expected.length < 32) return false;
    const actual = scryptSync(password, Buffer.from(saltB64, 'base64url'), expected.length, { N: Number(n) });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export interface Session {
  email: string;
  exp: number;
}

export const SESSION_COOKIE = 'fae_session';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

function sign(payload: string, secret: string) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

export function createSessionToken(email: string, secret: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ email, exp: now + SESSION_TTL_MS })).toString('base64url');
  return payload + '.' + sign(payload, secret);
}

export function readSessionToken(token: string | undefined, secret: string, now = Date.now()): Session | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig || !safeEqual(sig, sign(payload, secret))) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Session;
    return typeof session.exp === 'number' && session.exp > now ? session : null;
  } catch {
    return null;
  }
}

/** Random URL-safe token (256 bits). */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) {
      try {
        out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        /* ignore malformed cookie */
      }
    }
  }
  return out;
}
