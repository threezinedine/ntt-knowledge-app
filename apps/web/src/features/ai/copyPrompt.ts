import { useState } from 'react';
import { readJson, writeJson } from '../../commands/storage';
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
