import { describe, expect, it } from 'vitest';
import { format, formatParts, lookup, matchLocale, placeholders } from './format';

describe('format', () => {
  it('fills placeholders and leaves unknown ones visible', () => {
    expect(format('Delete {name}?', { name: 'Work' })).toBe('Delete Work?');
    expect(format('{a} and {b}', { a: 1 })).toBe('1 and {b}');
    expect(format('No params {x}')).toBe('No params {x}');
  });

  it('does not re-expand placeholders inside values', () => {
    expect(format('{a}{b}', { a: '{b}', b: 'B' })).toBe('{b}B');
  });
});

describe('formatParts', () => {
  it('splits text around element params, in order', () => {
    const el = { el: true };
    expect(formatParts('No tags yet. {link}.', { link: el })).toEqual(['No tags yet. ', el, '.']);
    expect(formatParts('{x}', { x: el })).toEqual([el]);
    expect(formatParts('keep {y}', {})).toEqual(['keep ', '{y}']);
  });
});

describe('placeholders', () => {
  it('lists unique names, sorted', () => {
    expect(placeholders('{b} {a} {b}')).toEqual(['a', 'b']);
    expect(placeholders('none')).toEqual([]);
  });
});

describe('lookup', () => {
  it('falls back along the chain, skipping empty strings, then to the key', () => {
    const vi = { a: 'A-vi', b: '' };
    const en = { a: 'A', b: 'B' };
    expect(lookup([vi, en], 'a')).toBe('A-vi');
    expect(lookup([vi, en], 'b')).toBe('B');
    expect(lookup([vi, en], 'missing')).toBe('missing');
  });
});

describe('matchLocale', () => {
  const available = ['en', 'pt-BR', 'vi'];
  it('prefers an exact tag, then the base language, in preference order', () => {
    expect(matchLocale(available, ['vi-VN', 'en'])).toBe('vi');
    expect(matchLocale(available, ['PT-br'])).toBe('pt-BR');
    expect(matchLocale(available, ['pt-PT'])).toBe('pt-BR');
    expect(matchLocale(available, ['fr', 'en-GB'])).toBe('en');
    expect(matchLocale(available, ['fr'])).toBeUndefined();
  });
});
