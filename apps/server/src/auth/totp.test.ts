import { describe, expect, it } from 'vitest';
import {
  base32Decode,
  base32Encode,
  hotp,
  matchingStep,
  newTotpSecret,
  otpauthUri,
  stepAt,
} from './totp.js';

// RFC 6238 appendix B, SHA-1: secret "12345678901234567890" (ASCII).
const RFC_SECRET = Buffer.from('12345678901234567890');

describe('TOTP (RFC 6238)', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('matches the RFC test vector at T=%i', (seconds, expected) => {
    expect(hotp(RFC_SECRET, stepAt(seconds * 1000), 8)).toBe(expected);
  });

  it('6-digit codes are the RFC values truncated (as Google Authenticator shows)', () => {
    expect(hotp(RFC_SECRET, stepAt(59_000))).toBe('287082');
  });

  it('accepts the current step and one either side, nothing further', () => {
    const now = 1_700_000_000_000;
    const step = stepAt(now);
    const code = (s: number) => hotp(RFC_SECRET, s);
    expect(matchingStep(RFC_SECRET, code(step), now)).toBe(step);
    expect(matchingStep(RFC_SECRET, code(step - 1), now)).toBe(step - 1);
    expect(matchingStep(RFC_SECRET, code(step + 1), now)).toBe(step + 1);
    expect(matchingStep(RFC_SECRET, code(step - 2), now)).toBeNull();
    expect(matchingStep(RFC_SECRET, code(step + 2), now)).toBeNull();
  });

  it('rejects anything that is not exactly six digits', () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', ' 123456', '12 456']) {
      expect(matchingStep(RFC_SECRET, bad, 0)).toBeNull();
    }
  });
});

describe('base32', () => {
  it('round-trips and matches the RFC 4648 vectors', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    expect(base32Decode('mzxw 6ytb-oi======').toString()).toBe('foobar');
    expect(() => base32Decode('MZXW1')).toThrow(/Invalid base32/);
  });

  it('new secrets are 160 bits (32 base32 characters)', () => {
    const secret = newTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
    expect(newTotpSecret()).not.toBe(secret);
  });
});

describe('otpauthUri', () => {
  it('is what Google Authenticator expects', () => {
    const uri = new URL(otpauthUri('JBSWY3DPEHPK3PXP', 'local'));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.host).toBe('totp');
    expect(decodeURIComponent(uri.pathname)).toBe('/Knowledge Manager:local');
    expect(Object.fromEntries(uri.searchParams)).toEqual({
      secret: 'JBSWY3DPEHPK3PXP',
      issuer: 'Knowledge Manager',
      algorithm: 'SHA1',
      digits: '6',
      period: '30',
    });
  });
});
