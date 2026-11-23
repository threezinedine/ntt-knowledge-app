import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * TOTP (RFC 6238) as Google Authenticator does it: HMAC-SHA1, 30-second
 * steps, 6 digits. No library: it is ~40 lines of the RFC.
 */
export const STEP_SECONDS = 30;
export const DIGITS = 6;
/** Accept the previous and next step too: phone clocks drift, people type slowly. */
export const DRIFT_STEPS = 1;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32.charAt((value >>> (bits - 5)) & 31);
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32.charAt((value << (5 - bits)) & 31);
  return out;
}

/** Case-insensitive; ignores spaces, dashes and `=` padding. Throws on other characters. */
export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const index = BASE32.indexOf(ch);
    if (index === -1) throw new Error(`Invalid base32 character "${ch}"`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new secret: 160 random bits (RFC 4226's recommended length), base32. */
export function newTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function stepAt(nowMs: number): number {
  return Math.floor(nowMs / 1000 / STEP_SECONDS);
}

/** HOTP (RFC 4226) value for one counter, `digits` long. */
export function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(message).digest();
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f;
  const binary = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/**
 * The step `code` is valid for (within ±DRIFT_STEPS of now), or null.
 * Compared in constant time.
 */
export function matchingStep(secret: Buffer, code: string, nowMs: number): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const given = Buffer.from(code);
  const now = stepAt(nowMs);
  let found: number | null = null;
  for (let step = now - DRIFT_STEPS; step <= now + DRIFT_STEPS; step++) {
    // Check every candidate (no early exit) so timing doesn't hint which matched.
    if (timingSafeEqual(Buffer.from(hotp(secret, step)), given)) found ??= step;
  }
  return found;
}

/** What Google Authenticator scans: otpauth://totp/Issuer:account?secret=…&issuer=… */
export function otpauthUri(secret: string, account: string, issuer = 'Knowledge Manager'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
