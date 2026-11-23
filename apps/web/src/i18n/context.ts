import { createContext, use, type ReactNode } from 'react';
import type { LocaleInfo, MessageKey } from './catalog';

export type Params = Readonly<Record<string, string | number>>;

export interface I18n {
  locale: string;
  locales: readonly LocaleInfo[];
  setLocale: (code: string) => void;
  /** Translated, interpolated plain text (labels, placeholders, aria-*). */
  t: (key: MessageKey, params?: Params) => string;
  /** Like `t`, but params may be elements, e.g. a `<Link>` inside a sentence. */
  tx: (key: MessageKey, params: Readonly<Record<string, ReactNode>>) => ReactNode;
  /** A user-facing, translated description of a failed request or other error. */
  errorText: (error: unknown) => string;
}

export const I18nContext = createContext<I18n | null>(null);

export function useI18n(): I18n {
  const i18n = use(I18nContext);
  if (!i18n) throw new Error('useI18n() must be used inside <I18nProvider>');
  return i18n;
}
