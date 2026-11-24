import { describe, expect, it } from 'vitest';
import { DEFAULT_GRAPH_SETTINGS } from '../features/graph/graphSettings';
import {
  buildSettingsFile,
  planSettingsImport,
  portableBinding,
  SETTINGS_FORMAT,
  settingsFileName,
  shortList,
  type RawStorage,
} from './settingsFile';

const memory = (init: Record<string, string> = {}): RawStorage & { data: Map<string, string> } => {
  const data = new Map(Object.entries(init));
  return { data, get: (k) => data.get(k) ?? null, set: (k, v) => data.set(k, v) };
};

/** Plans the import and writes it, as bootImport does after the reload. */
const importInto = (text: string, to: ReturnType<typeof memory>, isMac = false) => {
  const result = planSettingsImport(text, to, isMac);
  if (result.ok) for (const [k, v] of result.writes) to.set(k, v);
  return result;
};

const file = (settings: Record<string, unknown>) =>
  JSON.stringify({ format: SETTINGS_FORMAT, settings });

describe('settings file', () => {
  it('exports only what is set, with the language as stored (plain string)', () => {
    const storage = memory({
      'km.locale': 'vi',
      'km.vimMode': 'true',
      'km.linkCheck.depth': '2',
      'km.sidebarVisible': 'false', // passing state: not exported
      'km.whys.promptLanguage': '"xx"', // invalid: not exported
    });
    const doc = JSON.parse(buildSettingsFile(storage, new Date('2026-11-24T10:00:00Z'))) as {
      format: string;
      exportedAt: string;
      settings: Record<string, unknown>;
    };
    expect(doc.format).toBe(SETTINGS_FORMAT);
    expect(doc.exportedAt).toBe('2026-11-24T10:00:00.000Z');
    expect(doc.settings).toEqual({ language: 'vi', vimMode: true, linkCheckDepth: 2 });
  });

  it('round-trips to another device, leaving what the file lacks', () => {
    const from = memory({
      'km.graph.settings': JSON.stringify({ ...DEFAULT_GRAPH_SETTINGS, maxRadius: 50 }),
      'km.keybindings': JSON.stringify({ 'km.graph.fitView': ['Shift+F'] }),
      'km.locale': 'vi',
    });
    const to = memory({ 'km.vimMode': 'true' });
    const result = importInto(buildSettingsFile(from), to);
    expect(result).toMatchObject({
      ok: true,
      applied: ['graph', 'keybindings', 'language'],
      skipped: [],
    });
    expect(JSON.parse(to.data.get('km.graph.settings') ?? '{}')).toMatchObject({ maxRadius: 50 });
    expect(to.data.get('km.locale')).toBe('vi');
    expect(to.data.get('km.vimMode')).toBe('true');
  });

  it('only plans: nothing is written to the device it reads', () => {
    const to = memory();
    planSettingsImport(file({ vimMode: true }), to);
    expect(to.data.size).toBe(0);
  });

  it('merges graph settings over this device’s, so missing fields keep their value', () => {
    const to = memory({
      'km.graph.settings': JSON.stringify({ ...DEFAULT_GRAPH_SETTINGS, showArrows: false }),
    });
    importInto(file({ graph: { showLinkLabels: false } }), to);
    expect(JSON.parse(to.data.get('km.graph.settings') ?? '{}')).toMatchObject({
      showLinkLabels: false,
      showArrows: false,
    });
  });

  it('carries the command key between Windows and Mac as Mod', () => {
    expect(portableBinding('Ctrl+Shift+F', false)).toBe('Mod+Shift+F');
    expect(portableBinding('Ctrl+K Ctrl+S', false)).toBe('Mod+K Mod+S');
    expect(portableBinding('Meta+Shift+F', true)).toBe('Mod+Shift+F');
    expect(portableBinding('Ctrl+Meta+F', true)).toBe('Ctrl+Mod+F'); // Mac Ctrl stays Ctrl

    const windows = memory({
      'km.keybindings': JSON.stringify({ 'km.graph.fitView': ['Ctrl+Shift+F'] }),
    });
    const mac = memory();
    importInto(buildSettingsFile(windows, new Date(), false), mac, true);
    expect(JSON.parse(mac.data.get('km.keybindings') ?? '{}')).toEqual({
      'km.graph.fitView': ['Shift+Meta+F'],
    });

    const back = memory();
    importInto(buildSettingsFile(mac, new Date(), true), back, false);
    expect(JSON.parse(back.data.get('km.keybindings') ?? '{}')).toEqual({
      'km.graph.fitView': ['Ctrl+Shift+F'],
    });
  });

  it('skips invalid and unknown entries, and cleans the valid ones', () => {
    const to = memory();
    const result = importInto(
      file({
        graph: { maxRadius: 9999, junk: 1 },
        language: 'klingon',
        vimMode: 'yes',
        linkCheckDepth: 99,
        keybindings: { 'no.such.command': ['Ctrl+X'], 'km.graph.fitView': ['Shift+F', 42] },
        somethingNew: 1,
      }),
      to,
    );
    expect(result).toMatchObject({
      ok: true,
      applied: ['graph', 'keybindings'],
      skipped: ['language', 'vimMode', 'linkCheckDepth', 'somethingNew'],
    });
    const graph = JSON.parse(to.data.get('km.graph.settings') ?? '{}') as Record<string, unknown>;
    expect(graph.maxRadius).toBe(120);
    expect(graph).not.toHaveProperty('junk');
    expect(JSON.parse(to.data.get('km.keybindings') ?? '{}')).toEqual({
      'km.graph.fitView': ['Shift+F'],
    });
  });

  it('refuses anything that is not a settings file', () => {
    const to = memory();
    expect(planSettingsImport('not json', to)).toEqual({ ok: false, reason: 'invalidJson' });
    expect(planSettingsImport('{"format":"km-whys/1","whys":[]}', to)).toEqual({
      ok: false,
      reason: 'notSettings',
    });
    expect(planSettingsImport('[]', to)).toEqual({ ok: false, reason: 'notSettings' });
  });

  it('names the file by local date, and keeps the skipped list short', () => {
    expect(settingsFileName(new Date(2026, 0, 5))).toBe('km-settings-2026-01-05.json');
    expect(shortList(['a', 'b'])).toBe('a, b');
    expect(shortList(['a', 'b', 'c', 'd', 'e', 'f', 'g'])).toBe('a, b, c, d, e +2');
  });
});
