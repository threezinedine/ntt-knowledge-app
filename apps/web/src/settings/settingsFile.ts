import { LOCAL_GRAPH_MAX_DEPTH } from '@km/core';
import { IS_MAC } from '../commands/keybinding';
import { sanitizeOverrides } from '../commands/keybindingStore';
import { PROMPT_LANGUAGES } from '../features/ai/copyPrompt';
import { sanitizeGraphSettings } from '../features/graph/graphSettings';
import { LOCALES } from '../i18n/catalog';

/**
 * Settings as a file, like VS Code's settings export: what the user chose on
 * this device (graph settings, keybindings, language, vim, prompt languages,
 * link check depth), to load on another one. Not passing state such as the
 * sidebar being open or recent commands. Never holds anything secret. A
 * language or prompt language the app only detected (never picked) isn't in it.
 *
 * Only what is set here goes in the file; importing overwrites the entries
 * the file has and leaves the rest alone (graph settings merge field by
 * field). Every entry is checked like the app checks its own storage, so a
 * hand-edited file can't break anything.
 */
export const SETTINGS_FORMAT = 'km-settings/1';

/** Reads and writes raw storage strings (localStorage in the app, a Map in tests). */
export interface RawStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

interface Context {
  isMac: boolean;
  /** This device's current value of the entry (already checked), if any. */
  stored: unknown;
}

interface Entry {
  /** Name in the file. */
  name: string;
  storageKey: string;
  /** Stored as a plain string, not JSON (the UI language). */
  plainString?: boolean;
  /** The value to store, or undefined when it isn't valid. */
  check: (value: unknown, ctx: Context) => unknown;
  /** Stored value → file value (default: as is). */
  toFile?: (value: unknown, isMac: boolean) => unknown;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const oneOf =
  (allowed: readonly unknown[]) =>
  (v: unknown): unknown =>
    allowed.includes(v) ? v : undefined;

/**
 * Stored bindings are canonical for this platform ("Ctrl" on Windows/Linux,
 * "Meta" = Cmd on a Mac). In the file the platform's command key is "Mod"
 * again, so Ctrl+S on Windows arrives as Cmd+S on a Mac and back.
 */
export function portableBinding(binding: string, isMac: boolean): string {
  const command = isMac ? 'Meta' : 'Ctrl';
  return binding
    .split(' ')
    .map((press) => {
      const parts = press.split('+');
      const key = parts.pop() ?? '';
      return [...parts.map((m) => (m === command ? 'Mod' : m)), key].join('+');
    })
    .join(' ');
}

export const SETTINGS_ENTRIES: readonly Entry[] = [
  {
    name: 'graph',
    storageKey: 'km.graph.settings',
    // Merged over this device's values: a file from an older version (or
    // edited by hand) doesn't reset the fields it lacks.
    check: (v, { stored }) =>
      isPlainObject(v)
        ? sanitizeGraphSettings({ ...(isPlainObject(stored) ? stored : {}), ...v })
        : undefined,
  },
  {
    name: 'keybindings',
    storageKey: 'km.keybindings',
    check: (v, { isMac }) => (isPlainObject(v) ? sanitizeOverrides(v, isMac) : undefined),
    toFile: (v, isMac) =>
      Object.fromEntries(
        Object.entries(v as Record<string, string[]>).map(([id, keys]) => [
          id,
          keys.map((k) => portableBinding(k, isMac)),
        ]),
      ),
  },
  {
    name: 'language',
    storageKey: 'km.locale',
    plainString: true,
    check: oneOf(LOCALES.map((l) => l.code)),
  },
  { name: 'vimMode', storageKey: 'km.vimMode', check: oneOf([true, false]) },
  {
    name: 'whysPromptLanguage',
    storageKey: 'km.whys.promptLanguage',
    check: oneOf(PROMPT_LANGUAGES),
  },
  {
    name: 'linkCheckPromptLanguage',
    storageKey: 'km.linkCheck.promptLanguage',
    check: oneOf(PROMPT_LANGUAGES),
  },
  {
    name: 'linkCheckDepth',
    storageKey: 'km.linkCheck.depth',
    check: (v) =>
      typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= LOCAL_GRAPH_MAX_DEPTH
        ? v
        : undefined,
  },
];

function readEntry(entry: Entry, storage: RawStorage, isMac: boolean): unknown {
  const raw = storage.get(entry.storageKey);
  if (raw === null) return undefined;
  let value: unknown = raw;
  if (!entry.plainString) {
    try {
      value = JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return entry.check(value, { isMac, stored: undefined });
}

/** The file's contents for what is set on this device. */
export function buildSettingsFile(storage: RawStorage, now = new Date(), isMac = IS_MAC): string {
  const settings: Record<string, unknown> = {};
  for (const entry of SETTINGS_ENTRIES) {
    const value = readEntry(entry, storage, isMac);
    if (value !== undefined)
      settings[entry.name] = entry.toFile ? entry.toFile(value, isMac) : value;
  }
  return `${JSON.stringify(
    { format: SETTINGS_FORMAT, exportedAt: now.toISOString(), settings },
    null,
    2,
  )}\n`;
}

export type ImportResult =
  | {
      ok: true;
      /** Storage key → raw string, ready to write. */
      writes: [string, string][];
      applied: string[];
      skipped: string[];
    }
  | { ok: false; reason: 'invalidJson' | 'notSettings' };

/**
 * What importing the file would write, checked against this device's
 * `storage` (read only). Invalid and unknown entries are skipped and named.
 */
export function planSettingsImport(
  text: string,
  storage: RawStorage,
  isMac = IS_MAC,
): ImportResult {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'invalidJson' };
  }
  if (!isPlainObject(doc) || doc.format !== SETTINGS_FORMAT || !isPlainObject(doc.settings)) {
    return { ok: false, reason: 'notSettings' };
  }
  const given = doc.settings;
  const writes: [string, string][] = [];
  const applied: string[] = [];
  const skipped: string[] = [];
  for (const entry of SETTINGS_ENTRIES) {
    if (!(entry.name in given)) continue;
    const stored = readEntry(entry, storage, isMac);
    const value = entry.check(given[entry.name], { isMac, stored });
    if (value === undefined) {
      skipped.push(entry.name);
      continue;
    }
    writes.push([
      entry.storageKey,
      entry.plainString && typeof value === 'string' ? value : JSON.stringify(value),
    ]);
    applied.push(entry.name);
  }
  const known = new Set(SETTINGS_ENTRIES.map((e) => e.name));
  skipped.push(...Object.keys(given).filter((name) => !known.has(name)));
  return { ok: true, writes, applied, skipped };
}

/** localStorage as `RawStorage`; never throws (private mode, blocked storage). */
export const browserStorage: RawStorage = {
  get: (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set: (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Not persisted.
    }
  },
};

/** `km-settings-2026-11-24.json`, in the local date. */
export function settingsFileName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `km-settings-${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`;
}

/** At most `max` names, then "+N". */
export function shortList(names: readonly string[], max = 5): string {
  return names.length <= max
    ? names.join(', ')
    : `${names.slice(0, max).join(', ')} +${String(names.length - max)}`;
}
