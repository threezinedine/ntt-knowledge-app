import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from './sha256.js';

const reference = (s: string) => createHash('sha256').update(s).digest('hex');

describe('sha256Hex', () => {
  it.each([
    '',
    'abc',
    'a'.repeat(55),
    'a'.repeat(56),
    'a'.repeat(64),
    'x'.repeat(1000),
    'Tiếng Việt có dấu 😀 and 中文',
  ])('matches node:crypto for %#', (s) => {
    expect(sha256Hex(s)).toBe(reference(s));
  });
});
