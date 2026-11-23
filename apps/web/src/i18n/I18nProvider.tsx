import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { LOCALES, SOURCE_LOCALE, SOURCE_MESSAGES } from './catalog';
import { I18nContext, type I18n } from './context';
import { describeError } from './errorText';
import { format, formatParts, lookup, matchLocale } from './format';

const STORAGE_KEY = 'km.locale';
const codes = LOCALES.map((l) => l.code);

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage blocked (private mode, sandboxed iframe)
  }
}

function store(code: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch {
    // Not persisted; the choice still applies for this session.
  }
}

/** Saved choice, else the browser's languages, else English. */
export function initialLocale(): string {
  const stored = readStored();
  const preferred = stored === null ? [] : [stored];
  if (typeof navigator !== 'undefined') preferred.push(...navigator.languages);
  return matchLocale(codes, preferred) ?? SOURCE_LOCALE;
}

export function I18nProvider({
  children,
  locale: forced,
}: {
  children: ReactNode;
  /** Fixed locale (tests); otherwise detected and user-selectable. */
  locale?: string;
}) {
  const [locale, setLocaleState] = useState(() => forced ?? initialLocale());

  const setLocale = useCallback((code: string) => {
    if (!codes.includes(code)) return;
    store(code);
    setLocaleState(code);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18n>(() => {
    const own = LOCALES.find((l) => l.code === locale)?.messages ?? SOURCE_MESSAGES;
    const chain = [own, SOURCE_MESSAGES];
    const t: I18n['t'] = (key, params) => format(lookup(chain, key), params);
    return {
      locale,
      locales: LOCALES,
      setLocale,
      t,
      tx: (key, params) =>
        formatParts<ReactNode>(lookup(chain, key), params).map((part, i) => (
          <Fragment key={i}>{part}</Fragment>
        )),
      errorText: (error) => describeError(t, (key) => lookup(chain, key) !== key, error),
    };
  }, [locale, setLocale]);

  return <I18nContext value={value}>{children}</I18nContext>;
}
