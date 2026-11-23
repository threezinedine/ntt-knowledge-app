/**
 * Pure message helpers: no React, no locale state, so they are trivially
 * testable and shared by the provider and the locale-file checks.
 */

export type Messages = Readonly<Record<string, string>>;

/** `{name}`: a placeholder filled from params. Names are word characters only. */
const PLACEHOLDER = /\{(\w+)\}/g;

/** Placeholder names used by a message, sorted and de-duplicated. */
export function placeholders(message: string): string[] {
  return [...new Set(Array.from(message.matchAll(PLACEHOLDER), (m) => m[1] ?? ''))].sort();
}

/** First catalogue in the chain that has the key wins; the key itself is the last resort. */
export function lookup(chain: readonly Messages[], key: string): string {
  for (const messages of chain) {
    const value = messages[key];
    if (value !== undefined && value !== '') return value;
  }
  return key;
}

/** Fills `{name}` placeholders; unknown ones stay visible so a missing param is obvious. */
export function format(message: string, params?: Readonly<Record<string, string | number>>) {
  if (!params) return message;
  return message.replace(PLACEHOLDER, (whole, name: string) =>
    name in params ? String(params[name]) : whole,
  );
}

/**
 * Like `format`, but params may be arbitrary values (e.g. React elements).
 * Returns the message split into text and param parts, in order.
 */
export function formatParts<T>(
  message: string,
  params: Readonly<Record<string, T>>,
): (string | T)[] {
  // With a capture group, split() alternates text, name, text, name, ...
  return message
    .split(/\{(\w+)\}/)
    .map((part, i) => {
      if (i % 2 === 0) return part;
      return part in params ? (params[part] as T) : `{${part}}`;
    })
    .filter((part) => part !== '');
}

/**
 * Picks the best available locale for the user's preferences (BCP 47 tags,
 * most preferred first): exact match, then same base language ("vi-VN" → "vi").
 */
export function matchLocale(
  available: readonly string[],
  wanted: readonly string[],
): string | undefined {
  const byLower = new Map(available.map((code) => [code.toLowerCase(), code]));
  for (const tag of wanted) {
    const lower = tag.toLowerCase();
    const exact = byLower.get(lower);
    if (exact) return exact;
    const base = lower.split('-')[0] ?? lower;
    const sameBase =
      byLower.get(base) ?? available.find((code) => code.toLowerCase().split('-')[0] === base);
    if (sameBase) return sameBase;
  }
  return undefined;
}
