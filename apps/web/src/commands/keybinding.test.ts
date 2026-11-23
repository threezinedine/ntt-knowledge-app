import { describe, expect, it } from 'vitest';
import {
  ariaKeyShortcut,
  firesWhileTyping,
  formatBinding,
  formatPress,
  isEditableTarget,
  parseBinding,
  pressFromEvent,
  type KeyEventLike,
} from './keybinding';

const ev = (code: string, key: string, mods: Partial<KeyEventLike> = {}): KeyEventLike => ({
  code,
  key,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods,
});

describe('pressFromEvent', () => {
  it('uses the physical key for letters and digits, whatever the layout or Shift', () => {
    expect(pressFromEvent(ev('KeyP', 'P', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+P');
    expect(pressFromEvent(ev('Digit1', '!', { shiftKey: true }))).toBe('Shift+1');
    // Vietnamese Telex: the key produces "ư", the physical key is still W.
    expect(pressFromEvent(ev('KeyW', 'ư', { altKey: true }))).toBe('Alt+W');
  });

  it('names special keys and orders modifiers canonically', () => {
    expect(pressFromEvent(ev('F1', 'F1'))).toBe('F1');
    expect(pressFromEvent(ev('ArrowUp', 'ArrowUp', { metaKey: true, altKey: true }))).toBe(
      'Alt+Meta+Up',
    );
    expect(pressFromEvent(ev('Equal', '='))).toBe('=');
    expect(pressFromEvent(ev('Minus', '-'))).toBe('-');
  });

  it('never treats AltGr as a shortcut (Windows reports it as Ctrl+Alt)', () => {
    const altGr = ev('KeyQ', '@', {
      ctrlKey: true,
      altKey: true,
      getModifierState: (k) => k === 'AltGraph',
    });
    expect(pressFromEvent(altGr)).toBeNull();
    // A real Ctrl+Alt+Q (no AltGr) is still a press.
    expect(pressFromEvent(ev('KeyQ', 'q', { ctrlKey: true, altKey: true }))).toBe('Ctrl+Alt+Q');
  });

  it('a dead key with a command modifier is still a shortcut (macOS Option+N)', () => {
    expect(pressFromEvent(ev('KeyN', 'Dead', { altKey: true, ctrlKey: true }))).toBe('Ctrl+Alt+N');
    expect(pressFromEvent(ev('KeyE', 'Dead'))).toBeNull(); // starting an accent
  });

  it('ignores lone modifiers and dead keys', () => {
    expect(pressFromEvent(ev('ControlLeft', 'Control', { ctrlKey: true }))).toBeNull();
    expect(pressFromEvent(ev('Quote', 'Dead'))).toBeNull();
  });
});

describe('parseBinding', () => {
  it('maps Mod to Ctrl, or Cmd on macOS', () => {
    expect(parseBinding('Mod+Shift+P', false)).toBe('Ctrl+Shift+P');
    expect(parseBinding('Mod+Shift+P', true)).toBe('Shift+Meta+P');
  });

  it('accepts chords, aliases and any case', () => {
    expect(parseBinding('mod+k mod+s', false)).toBe('Ctrl+K Ctrl+S');
    expect(parseBinding('option+cmd+up', false)).toBe('Alt+Meta+Up');
    expect(parseBinding('f12', false)).toBe('F12');
    expect(parseBinding('Mod+K V', false)).toBe('Ctrl+K V');
  });

  it('rejects garbage and over-long chords', () => {
    expect(parseBinding('', false)).toBeNull();
    expect(parseBinding('Hyper+X', false)).toBeNull();
    expect(parseBinding('Ctrl+Banana', false)).toBeNull();
    expect(parseBinding('A B C', false)).toBeNull();
    expect(parseBinding('Ctrl+', false)).toBeNull();
  });
});

describe('formatting', () => {
  it('shows plain names on Windows/Linux and symbols on macOS', () => {
    expect(formatPress('Ctrl+Shift+P', false)).toBe('Ctrl+Shift+P');
    expect(formatPress('Shift+Meta+P', false)).toBe('Shift+Win+P');
    expect(formatPress('Shift+Meta+P', true)).toBe('⇧⌘P');
    expect(formatBinding('Ctrl+K Ctrl+S', false)).toBe('Ctrl+K Ctrl+S');
  });
});

describe('typing guard', () => {
  it('lets only modifier, function and Escape presses through while typing', () => {
    expect(firesWhileTyping('Ctrl+B')).toBe(true);
    expect(firesWhileTyping('Alt+N')).toBe(true);
    expect(firesWhileTyping('F2')).toBe(true);
    expect(firesWhileTyping('Escape')).toBe(true);
    expect(firesWhileTyping('=')).toBe(false);
    expect(firesWhileTyping('Shift+1')).toBe(false);
  });

  it('on macOS, Option+key types a character, so it never fires while typing', () => {
    expect(firesWhileTyping('Alt+L', true)).toBe(false);
    expect(firesWhileTyping('Ctrl+Alt+L', true)).toBe(true);
    expect(firesWhileTyping('Meta+P', true)).toBe(true);
    expect(firesWhileTyping('Alt+L', false)).toBe(true);
  });

  it('treats text fields and contenteditable as typing targets', () => {
    const text = document.createElement('input');
    const checkbox = Object.assign(document.createElement('input'), { type: 'checkbox' });
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    document.body.append(editable);
    expect(isEditableTarget(text)).toBe(true);
    expect(isEditableTarget(document.createElement('textarea'))).toBe(true);
    expect(isEditableTarget(checkbox)).toBe(false);
    expect(isEditableTarget(document.createElement('button'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
    editable.remove();
  });
});

describe('ariaKeyShortcut', () => {
  it('spells single presses the ARIA way', () => {
    expect(ariaKeyShortcut('Ctrl+Shift+P')).toBe('Control+Shift+P');
    expect(ariaKeyShortcut('Alt+Meta+Up')).toBe('Alt+Meta+ArrowUp');
    expect(ariaKeyShortcut('F2')).toBe('F2');
  });

  it('has no syntax for chords', () => {
    expect(ariaKeyShortcut('Ctrl+K Ctrl+S')).toBeNull();
  });
});
