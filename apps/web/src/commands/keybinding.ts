/**
 * Keybinding model, pure (no DOM state, no React).
 *
 *  - A *press* is one key with modifiers, canonical form "Ctrl+Alt+Shift+Meta+Key",
 *    e.g. "Ctrl+Shift+P". Letters and digits come from `KeyboardEvent.code`, so
 *    they don't depend on the keyboard layout or IME (Telex/VNI) and Shift
 *    doesn't turn "1" into "!".
 *  - A *binding* is one press or a two-press chord separated by a space,
 *    e.g. "Ctrl+K Ctrl+S" (VS Code style).
 *  - In bindings written by hand (defaults, user input) "Mod" means Ctrl, or
 *    Cmd on macOS. Stored bindings are always canonical.
 */

export type KeyPress = string;
export type Keybinding = string;

export interface KeyEventLike {
  code: string;
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  /** Real KeyboardEvents have it; AltGr is reported through it. */
  getModifierState?: (key: string) => boolean;
}

export const IS_MAC =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

const MODIFIERS = ['Ctrl', 'Alt', 'Shift', 'Meta'] as const;
type Modifier = (typeof MODIFIERS)[number];

const CODE_KEYS: Readonly<Record<string, string>> = {
  Space: 'Space',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Comma: ',',
  Period: '.',
  Slash: '/',
  NumpadAdd: 'Plus',
  NumpadSubtract: '-',
  NumpadMultiply: '*',
  NumpadDivide: '/',
  NumpadEnter: 'Enter',
};

const NAMED_KEYS: Readonly<Record<string, string>> = {
  Escape: 'Escape',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ' ': 'Space',
};

const NOT_A_KEY = new Set([
  'Control',
  'Shift',
  'Alt',
  'AltGraph',
  'Meta',
  'OS',
  'CapsLock',
  'NumLock',
  'ScrollLock',
  'Fn',
  'Dead',
  'Process',
  'Unidentified',
]);

const F_KEY = /^F([1-9]|1\d|2[0-4])$/;

/** Every key name a binding may use, besides single printable characters. */
const VALID_NAMES = new Set([...Object.values(CODE_KEYS), ...Object.values(NAMED_KEYS)]);

function keyName(e: KeyEventLike): string | null {
  // A dead key *with* a command modifier is still a shortcut (macOS
  // Option+N reports key "Dead"); on its own it starts an accent.
  const commandModifier = e.ctrlKey || e.altKey || e.metaKey;
  const physical = /^(Key[A-Z]|Digit\d)$/.test(e.code);
  if (NOT_A_KEY.has(e.key) && !(e.key === 'Dead' && commandModifier && physical)) return null;
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5);
  if (/^Numpad\d$/.test(e.code)) return e.code.slice(6);
  const byCode = CODE_KEYS[e.code];
  if (byCode) return byCode;
  if (F_KEY.test(e.key)) return e.key;
  const named = NAMED_KEYS[e.key];
  if (named) return named;
  return e.key.length === 1 ? e.key.toUpperCase() : null;
}

function joinPress(mods: ReadonlySet<Modifier>, key: string): KeyPress {
  return [...MODIFIERS.filter((m) => mods.has(m)), key].join('+');
}

/** The canonical press for a keydown, or null for a lone modifier / unknown key. */
export function pressFromEvent(e: KeyEventLike): KeyPress | null {
  // AltGr (reported as Ctrl+Alt on Windows) types characters like "@" on
  // German layouts; it is never a shortcut.
  if (e.getModifierState?.('AltGraph')) return null;
  const key = keyName(e);
  if (key === null) return null;
  const mods = new Set<Modifier>();
  if (e.ctrlKey) mods.add('Ctrl');
  if (e.altKey) mods.add('Alt');
  if (e.shiftKey) mods.add('Shift');
  if (e.metaKey) mods.add('Meta');
  return joinPress(mods, key);
}

const MODIFIER_ALIASES: Readonly<Record<string, Modifier | 'Mod'>> = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  opt: 'Alt',
  shift: 'Shift',
  meta: 'Meta',
  cmd: 'Meta',
  command: 'Meta',
  win: 'Meta',
  super: 'Meta',
  mod: 'Mod',
};

function parsePress(text: string, isMac: boolean): KeyPress | null {
  const parts = text.split('+');
  const rawKey = parts.pop();
  if (rawKey === undefined || rawKey === '') return null;
  const mods = new Set<Modifier>();
  for (const part of parts) {
    const alias = MODIFIER_ALIASES[part.toLowerCase()];
    if (!alias) return null;
    mods.add(alias === 'Mod' ? (isMac ? 'Meta' : 'Ctrl') : alias);
  }
  const key =
    rawKey.length === 1
      ? rawKey.toUpperCase()
      : ([...VALID_NAMES].find((n) => n.toLowerCase() === rawKey.toLowerCase()) ??
        (F_KEY.test(rawKey.toUpperCase()) ? rawKey.toUpperCase() : null));
  if (key === null) return null;
  return joinPress(mods, key);
}

/** Canonical binding for "mod+shift+p", "Ctrl+K Ctrl+S", ...; null if invalid. */
export function parseBinding(text: string, isMac = IS_MAC): Keybinding | null {
  const presses = text.trim().split(/\s+/);
  if (presses.length === 0 || presses.length > 2 || presses[0] === '') return null;
  const parsed = presses.map((p) => parsePress(p, isMac));
  return parsed.every((p): p is string => p !== null) ? parsed.join(' ') : null;
}

export function splitBinding(binding: Keybinding): KeyPress[] {
  return binding.split(' ');
}

const MAC_SYMBOLS: Readonly<Record<string, string>> = {
  Ctrl: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Meta: '⌘',
};

/** Human label of one press: "Ctrl+Shift+P" or, on macOS, "⇧⌘P". */
export function formatPress(press: KeyPress, isMac = IS_MAC): string {
  if (!isMac) return press.replace(/(^|\+)Meta(?=\+)/, '$1Win');
  const parts = press.split('+');
  const key = parts.pop() ?? '';
  return parts.map((m) => MAC_SYMBOLS[m] ?? m).join('') + key;
}

export function formatBinding(binding: Keybinding, isMac = IS_MAC): string {
  return splitBinding(binding)
    .map((p) => formatPress(p, isMac))
    .join(' ');
}

/**
 * Whether a press may fire while the user is typing in a field: anything with
 * Ctrl/Alt/Meta, function keys and Escape. Plain keys ("=", "Shift+1") would
 * otherwise eat typed characters, and so would Option+key on macOS, which is
 * how Mac users type "©", "ł", "¡", ...
 */
export function firesWhileTyping(press: KeyPress, isMac = IS_MAC): boolean {
  const parts = press.split('+');
  const key = parts.at(-1) ?? '';
  const commandModifier = isMac
    ? parts.some((p) => p === 'Ctrl' || p === 'Meta')
    : parts.some((p) => p === 'Ctrl' || p === 'Alt' || p === 'Meta');
  return commandModifier || F_KEY.test(key) || key === 'Escape';
}

/** Inputs, textareas, selects and contenteditable (CodeMirror) count as typing. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'range', 'file'].includes(
      target.type,
    );
  }
  return false;
}

const ARIA_MODIFIERS: Readonly<Record<string, string>> = { Ctrl: 'Control' };
const ARIA_KEYS: Readonly<Record<string, string>> = {
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
};

/**
 * The binding in `aria-keyshortcuts` syntax ("Control+Shift+P"), or null for
 * a chord: that attribute separates alternatives with spaces, so it has no
 * way to say "press this, then that".
 */
export function ariaKeyShortcut(binding: Keybinding): string | null {
  const presses = splitBinding(binding);
  if (presses.length !== 1) return null;
  const parts = binding.split('+');
  const key = parts.pop() ?? '';
  return [...parts.map((m) => ARIA_MODIFIERS[m] ?? m), ARIA_KEYS[key] ?? key].join('+');
}
