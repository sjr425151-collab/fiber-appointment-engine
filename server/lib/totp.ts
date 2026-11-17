/**
 * Time-based one-time passwords (RFC 6238: HMAC-SHA1, 30-second steps, six
 * digits), as used by authenticator apps. Built on node:crypto so no extra
 * package is needed.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of s.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, shown to the user once as text they type or tap into their authenticator app. */
export const newTotpSecret = () => base32Encode(randomBytes(20));

export function totpCode(secret: string, at = Date.now(), step = 0): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000) + step));
  const mac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  const code = ((mac[offset] & 127) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(code % 1_000_000).padStart(6, '0');
}

/** Accepts the current code and the ones just before and after it (clock drift). */
export function verifyTotp(secret: string, code: string, at = Date.now()): boolean {
  const given = Buffer.from(code.replace(/\s/g, ''));
  if (!secret || given.length !== 6) return false;
  let ok = false;
  for (const step of [-1, 0, 1]) {
    const expected = Buffer.from(totpCode(secret, at, step));
    if (timingSafeEqual(expected, given)) ok = true;
  }
  return ok;
}

/** Link an authenticator app opens directly on a phone. */
export const otpauthUri = (secret: string, account: string, issuer: string) =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
