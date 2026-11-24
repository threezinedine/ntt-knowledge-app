import { useState } from 'react';
import { readJson, writeJson } from '../../commands/storage';
import { flushAllAutosaves } from '../../hooks/useAutosave';
import { useI18n } from '../../i18n/context';

/**
 * Shared by the prompts the app builds for an AI chat (5 Whys, link check).
 * The app calls no AI itself: it copies a prompt the user pastes anywhere.
 */
export type PromptLanguage = 'en' | 'vi';
export const PROMPT_LANGUAGES: readonly PromptLanguage[] = ['en', 'vi'];

/** A prompt language remembered per device under `storageKey`; else the UI language. */
export function usePromptLanguage(
  storageKey: string,
): [PromptLanguage, (lang: PromptLanguage) => void] {
  const { locale } = useI18n();
  const [lang, setLangState] = useState<PromptLanguage>(() => {
    const saved = readJson(storageKey);
    if (PROMPT_LANGUAGES.includes(saved as PromptLanguage)) return saved as PromptLanguage;
    return locale.startsWith('vi') ? 'vi' : 'en';
  });
  const setLang = (next: PromptLanguage) => {
    setLangState(next);
    writeJson(storageKey, next);
  };
  return [lang, setLang];
}

/**
 * The async Clipboard API only exists in a secure context (HTTPS or
 * localhost). The phone app, or a browser on another PC, loads the web app
 * over plain http on the LAN, where `navigator.clipboard` is undefined.
 */
export function clipboardApiAvailable(): boolean {
  return window.isSecureContext && typeof navigator.clipboard !== 'undefined';
}

/**
 * The old way, for insecure contexts: a hidden textarea and the copy command.
 * It only works inside the user gesture, so the text must be ready now.
 */
export function copyTextNow(text: string): boolean {
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const area = document.createElement('textarea');
  area.value = text;
  area.readOnly = true;
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  let ok: boolean;
  try {
    // Deprecated, but the only clipboard access a non-secure page has.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  focused?.focus();
  return ok;
}

/**
 * Copies a prompt from a click/keydown handler. With the Clipboard API it
 * copies `later()` (fresh data, built after saving and refetching); without
 * it (plain http) it copies `now()` (built from what is cached) synchronously,
 * as the copy command requires. That fallback quotes what is cached, so text
 * typed in the last moment (not autosaved yet) may be missing; saving it is
 * still started. Resolves to what was copied; rejects with
 * `NothingCachedError` when the fallback has nothing to copy yet, or with the
 * underlying error otherwise.
 */
export function copyPrompt<T extends { text: string }>(
  later: () => Promise<T>,
  now: () => T | null,
): Promise<T> {
  if (!clipboardApiAvailable()) {
    const ready = now();
    void flushAllAutosaves(); // the server catches up for next time
    if (ready === null) return Promise.reject(new NothingCachedError());
    return copyTextNow(ready.text)
      ? Promise.resolve(ready)
      : Promise.reject(new Error('The copy command failed'));
  }
  const built = later();
  return copyTextWhenReady(built.then((b) => b.text)).then(() => built);
}

/** The plain-http fallback had nothing loaded to build the prompt from yet. */
export class NothingCachedError extends Error {
  constructor() {
    super('Nothing loaded to copy yet');
    this.name = 'NothingCachedError';
  }
}

/**
 * Puts text that is still being built on the clipboard. Call it straight from
 * the click/keydown handler: the write starts synchronously with a promise of
 * the text (ClipboardItem), so browsers that drop the user gesture across
 * awaits (Safari) still allow it. Where that form isn't supported, it falls
 * back to writeText once the text is ready. Rejects if neither works or the
 * text can't be built.
 */
export function copyTextWhenReady(text: Promise<string>): Promise<void> {
  const write = async (): Promise<void> => {
    if (typeof ClipboardItem !== 'undefined') {
      const blob = text.then((t) => new Blob([t], { type: 'text/plain' }));
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
        return;
      } catch {
        // Older engines refuse a promise in ClipboardItem: try plain text.
      }
    }
    await navigator.clipboard.writeText(await text);
  };
  return write();
}
