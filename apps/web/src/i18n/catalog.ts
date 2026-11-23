import type { Messages } from './format';
import en from './locales/en.json';

/**
 * English is the source of truth: it defines every key (and so the
 * `MessageKey` type). Other locales may be partial; missing keys fall back
 * to English.
 */
export const SOURCE_LOCALE = 'en';
export type MessageKey = keyof typeof en;

export interface LocaleInfo {
  /** File name without `.json`, a BCP 47 tag such as `vi` or `pt-BR`. */
  code: string;
  /** Shown in the language picker, in that language (`meta.languageName`). */
  name: string;
  messages: Messages;
}

// Every file in locales/ is a language: adding `fr.json` is all it takes.
const files = import.meta.glob<Messages>('./locales/*.json', { eager: true, import: 'default' });

export const LOCALES: readonly LocaleInfo[] = Object.entries(files)
  .map(([path, messages]) => {
    const code = /([^/]+)\.json$/.exec(path)?.[1] ?? path;
    return { code, name: messages['meta.languageName'] ?? code, messages };
  })
  .sort((a, b) => a.code.localeCompare(b.code));

export const SOURCE_MESSAGES: Messages = en;
