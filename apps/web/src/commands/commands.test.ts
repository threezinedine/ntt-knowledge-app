import { describe, expect, it, vi } from 'vitest';
import { BROWSER_RESERVED, COMMAND_LIST, COMMANDS, type CommandId } from './catalog';
import { resolvePress, yieldsToVim } from './dispatch';
import { parseBinding, splitBinding } from './keybinding';
import {
  bindingsClash,
  defaultBindings,
  findConflicts,
  mergeBindings,
  sanitizeOverrides,
  type Bindings,
} from './keybindingStore';
import { availableCommands, registerHandler, runCommand } from './registry';

describe('catalog', () => {
  it('has unique ids and valid default keybindings on every platform', () => {
    expect(new Set(COMMANDS.map((c) => c.id)).size).toBe(COMMANDS.length);
    for (const c of COMMAND_LIST) {
      for (const k of [...c.keys, ...(c.macKeys ?? [])]) {
        expect(parseBinding(k, false), `${c.id}: ${k}`).not.toBeNull();
        expect(parseBinding(k, true), `${c.id}: ${k}`).not.toBeNull();
      }
    }
  });

  it.each([
    ['Windows/Linux', false],
    ['macOS', true],
  ])('has no conflicting defaults on %s (incl. chord prefixes)', (_name, isMac) => {
    expect([...findConflicts(defaultBindings(isMac))]).toEqual([]);
  });

  it.each([
    ['Windows/Linux', false],
    ['macOS', true],
  ])('no default takes a browser/editing shortcut on %s', (_name, isMac) => {
    const reserved = new Set(BROWSER_RESERVED.map((k) => parseBinding(k, isMac)));
    for (const [id, keys] of defaultBindings(isMac)) {
      for (const k of keys) {
        expect(reserved.has(splitBinding(k)[0] ?? ''), `${id}: ${k}`).toBe(false);
      }
    }
  });

  it('on macOS, no default is Option+key alone (that types characters there)', () => {
    for (const [id, keys] of defaultBindings(true)) {
      for (const k of keys) {
        const mods = (splitBinding(k)[0] ?? '').split('+').slice(0, -1);
        expect(
          mods.includes('Alt') && !mods.includes('Ctrl') && !mods.includes('Meta'),
          `${id}: ${k}`,
        ).toBe(false);
      }
    }
  });
});

describe('user keybindings', () => {
  it('sanitizes stored JSON: unknown commands and bad keys are dropped', () => {
    expect(
      sanitizeOverrides(
        {
          'km.go.tags': ['alt+9', 'Nope+Q', 42],
          'not.a.command': ['Ctrl+X'],
          'km.go.graph': 'Ctrl+G',
        },
        false,
      ),
    ).toEqual({ 'km.go.tags': ['Alt+9'] });
    expect(sanitizeOverrides('garbage')).toEqual({});
    expect(sanitizeOverrides(null)).toEqual({});
  });

  it('an override replaces the default list; [] unbinds', () => {
    const merged = mergeBindings(defaultBindings(false), {
      'workbench.action.showCommands': ['Ctrl+Alt+P'],
      'km.go.tags': [],
    });
    expect(merged.get('workbench.action.showCommands')).toEqual(['Ctrl+Alt+P']);
    expect(merged.get('km.go.tags')).toEqual([]);
    expect(merged.get('km.go.graph')).toEqual(['Alt+1']);
  });

  it('reports bindings shared by several commands', () => {
    const merged = mergeBindings(defaultBindings(false), { 'km.go.tags': ['Alt+1'] });
    expect(findConflicts(merged).get('km.go.tags')).toEqual(['km.go.graph']);
    expect(findConflicts(merged).get('km.go.graph')).toEqual(['km.go.tags']);
  });

  it('reports a single press that shadows a chord starting with it', () => {
    expect(bindingsClash('Ctrl+K', 'Ctrl+K Ctrl+S')).toBe(true);
    expect(bindingsClash('Ctrl+K Ctrl+S', 'Ctrl+K')).toBe(true);
    expect(bindingsClash('Ctrl+K V', 'Ctrl+K Ctrl+S')).toBe(false);
    const merged = mergeBindings(defaultBindings(false), { 'km.go.tags': ['Ctrl+K'] });
    expect(findConflicts(merged).get('km.go.tags')).toEqual(
      expect.arrayContaining([
        'workbench.action.openGlobalKeybindings',
        'km.markdown.togglePreview',
        'km.markdown.openPreviewToSide',
      ]),
    );
  });
});

describe('resolvePress', () => {
  const bindings: Bindings = new Map<CommandId, string[]>([
    ['workbench.action.showCommands', ['Ctrl+Shift+P']],
    ['workbench.action.openGlobalKeybindings', ['Ctrl+K Ctrl+S']],
    ['km.markdown.openPreviewToSide', ['Ctrl+K V']],
    ['km.go.graph', ['Alt+1']],
    ['km.go.tags', ['Alt+1']],
  ]);
  const all = new Map<CommandId, number>([
    ['workbench.action.showCommands', 1],
    ['workbench.action.openGlobalKeybindings', 2],
    ['km.go.graph', 3],
    ['km.go.tags', 4],
  ]);

  it('runs a single-press binding', () => {
    expect(resolvePress('Ctrl+Shift+P', null, bindings, all)).toEqual({
      kind: 'run',
      id: 'workbench.action.showCommands',
    });
  });

  it('starts and completes a chord', () => {
    expect(resolvePress('Ctrl+K', null, bindings, all)).toEqual({
      kind: 'chord',
      prefix: 'Ctrl+K',
    });
    expect(resolvePress('Ctrl+S', 'Ctrl+K', bindings, all)).toEqual({
      kind: 'run',
      id: 'workbench.action.openGlobalKeybindings',
    });
    expect(resolvePress('X', 'Ctrl+K', bindings, all)).toEqual({
      kind: 'chordMiss',
      binding: 'Ctrl+K X',
    });
  });

  it('ignores commands nobody can run right now', () => {
    // Preview-to-side has no handler: Ctrl+K V is a miss, not a run.
    expect(resolvePress('V', 'Ctrl+K', bindings, all).kind).toBe('chordMiss');
    const onlyPalette = new Map<CommandId, number>([['workbench.action.showCommands', 1]]);
    expect(resolvePress('Ctrl+K', null, bindings, onlyPalette).kind).toBe('none');
    expect(resolvePress('Alt+1', null, bindings, onlyPalette).kind).toBe('none');
  });

  it('a held key (auto-repeat) does not re-run commands, except repeatable ones', () => {
    expect(resolvePress('Alt+1', null, bindings, all, true)).toEqual({ kind: 'swallow' });
    expect(resolvePress('Ctrl+K', null, bindings, all, true)).toEqual({ kind: 'swallow' });
    expect(resolvePress('Ctrl+K', 'Ctrl+K', bindings, all, true)).toEqual({ kind: 'swallow' });
    const zoom: Bindings = new Map<CommandId, string[]>([['km.graph.zoomIn', ['=']]]);
    const zoomAvailable = new Map<CommandId, number>([['km.graph.zoomIn', 1]]);
    expect(resolvePress('=', null, zoom, zoomAvailable, true)).toEqual({
      kind: 'run',
      id: 'km.graph.zoomIn',
    });
  });

  it('on a shared binding, the most recently registered command wins', () => {
    expect(resolvePress('Alt+1', null, bindings, all)).toEqual({ kind: 'run', id: 'km.go.tags' });
  });
});

describe('registry', () => {
  it('latest registration wins, and unregistering falls back', () => {
    const first = vi.fn();
    const second = vi.fn();
    const off1 = registerHandler('km.zoom' as CommandId, first);
    const off2 = registerHandler('km.zoom' as CommandId, second);
    runCommand('km.zoom' as CommandId);
    expect(second).toHaveBeenCalledOnce();
    off2();
    runCommand('km.zoom' as CommandId);
    expect(first).toHaveBeenCalledOnce();
    off1();
    expect(runCommand('km.zoom' as CommandId)).toBe(false);
    expect(availableCommands().has('km.zoom' as CommandId)).toBe(false);
  });
});

describe('yieldsToVim', () => {
  const inVim = () => {
    const box = document.createElement('div');
    box.setAttribute('data-km-vim', '');
    const input = document.createElement('input');
    box.append(input);
    return input;
  };

  it('gives vim its Ctrl keys inside a vim editor only', () => {
    expect(yieldsToVim('Ctrl+B', inVim())).toBe(true);
    expect(yieldsToVim('Ctrl+B', document.createElement('input'))).toBe(false);
  });

  it('keeps quick open, chords and modified presses for the app', () => {
    expect(yieldsToVim('Ctrl+P', inVim())).toBe(false);
    expect(yieldsToVim('Ctrl+K', inVim())).toBe(false);
    expect(yieldsToVim('Ctrl+Shift+B', inVim())).toBe(false);
  });
});
