import { API_ERROR_CODES, API_ERROR_REASONS } from '@km/core';
import { describe, expect, it } from 'vitest';
import { LOCALES, SOURCE_LOCALE, SOURCE_MESSAGES } from './catalog';
import { placeholders } from './format';

/**
 * Guards every file in locales/, including ones added later: a typo'd key or
 * a dropped `{placeholder}` fails here instead of silently showing English.
 */
const sourceKeys = Object.keys(SOURCE_MESSAGES);

describe('locale files', () => {
  it('include the source locale and Vietnamese', () => {
    expect(LOCALES.map((l) => l.code)).toEqual(expect.arrayContaining([SOURCE_LOCALE, 'vi']));
  });

  describe.each(LOCALES.map((l) => [l.code, l] as const))('%s', (_code, locale) => {
    it('has a language name', () => {
      expect(locale.messages['meta.languageName']).toBeTruthy();
    });

    it('has no keys that English does not define', () => {
      const unknown = Object.keys(locale.messages).filter((k) => !(k in SOURCE_MESSAGES));
      expect(unknown).toEqual([]);
    });

    it('only has string values and keeps every placeholder', () => {
      for (const [key, value] of Object.entries(locale.messages)) {
        expect(typeof value, key).toBe('string');
        expect(placeholders(value), key).toEqual(placeholders(SOURCE_MESSAGES[key] ?? ''));
      }
    });
  });

  // Partial locales are allowed (missing keys fall back to English), but the
  // bundled ones must be complete.
  it.each(['vi'])('%s translates every key', (code) => {
    const messages = LOCALES.find((l) => l.code === code)?.messages ?? {};
    expect(sourceKeys.filter((k) => !messages[k])).toEqual([]);
  });
});

describe('API errors', () => {
  // Every code and reason the server can send has a message (errorText would
  // otherwise fall back to a bare "error 403").
  it('each error code and reason has an English message', () => {
    const missing = [
      ...API_ERROR_CODES.map((c) => `error.code.${c}`),
      ...API_ERROR_REASONS.map((r) => `error.reason.${r}`),
    ].filter((key) => !(key in SOURCE_MESSAGES));
    expect(missing).toEqual([]);
  });
});
