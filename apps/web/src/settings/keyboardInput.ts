import { useSyncExternalStore } from 'react';

/**
 * A best guess at the keyboard input language, for the vim indicator. The
 * browser has no API for the OS input method, so it is read off what keys
 * produce: Vietnamese letters (Unikey/EVKey Telex/VNI, a Vietnamese layout),
 * an IME composing ("Process" keys), or plain Latin characters. Vim only
 * works with the last: its commands are letters, and Telex turns them into
 * other letters ("w" types "ư", "dd" types "đ").
 */
export type InputKind = 'unknown' | 'latin' | 'vietnamese' | 'ime' | 'other';

const VIETNAMESE = /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i;
const LATIN = /^[\x21-\x7e]$/;
const LETTER_OR_DIGIT = /^(Key[A-Z]|Digit\d)$/;

export interface KeyLike {
  key: string;
  code: string;
  keyCode?: number;
  isComposing?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

/** What one keydown says about the input language; null if nothing. */
export function classifyKey(e: KeyLike): InputKind | null {
  if (e.isComposing || e.key === 'Process' || e.keyCode === 229) return 'ime';
  if (e.ctrlKey || e.metaKey || e.altKey || !/^.$/u.test(e.key)) return null;
  return (
    classifyText(e.key) ?? (LATIN.test(e.key) && LETTER_OR_DIGIT.test(e.code) ? 'latin' : null)
  );
}

/** What typed text says (Telex tools often insert without a keydown). */
export function classifyText(text: string): InputKind | null {
  if (VIETNAMESE.test(text)) return 'vietnamese';
  if (/[^\t\n\r -~]/.test(text)) return 'other'; // beyond printable ASCII
  return null;
}

/** From the layout map (Chromium): what the letter and digit keys type. */
export function classifyLayout(map: ReadonlyMap<string, string>): InputKind | null {
  const typed = [...map].filter(([code]) => LETTER_OR_DIGIT.test(code)).map(([, key]) => key);
  if (typed.length === 0) return null;
  return classifyText(typed.join('')) ?? 'latin';
}

let kind: InputKind = 'unknown';
const listeners = new Set<() => void>();

function set(next: InputKind | null): void {
  if (next === null || next === kind) return;
  kind = next;
  for (const listener of listeners) listener();
}

let installed = false;
function install(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const opts = { capture: true, passive: true } as const;
  document.addEventListener(
    'keydown',
    (e) => {
      set(classifyKey(e));
    },
    opts,
  );
  document.addEventListener(
    'compositionstart',
    () => {
      set('ime');
    },
    opts,
  );
  document.addEventListener(
    'beforeinput',
    (e) => {
      if (e.data) set(classifyText(e.data));
    },
    opts,
  );
  // A starting guess before any key (Chromium only; tools like Unikey don't show here).
  const keyboard = (
    navigator as Navigator & {
      keyboard?: { getLayoutMap?: () => Promise<ReadonlyMap<string, string>> };
    }
  ).keyboard;
  void keyboard
    ?.getLayoutMap?.()
    .then((map) => {
      if (kind === 'unknown') set(classifyLayout(map));
    })
    .catch(() => undefined);
}

function subscribe(listener: () => void): () => void {
  install();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useInputKind(): InputKind {
  return useSyncExternalStore(subscribe, () => kind);
}
