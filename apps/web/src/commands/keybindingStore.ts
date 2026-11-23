import { useSyncExternalStore } from 'react';
import { COMMAND_LIST, isCommandId, type CommandId } from './catalog';
import { IS_MAC, parseBinding, splitBinding, type Keybinding } from './keybinding';
import { readJson, writeJson } from './storage';

/**
 * User keybindings: per command, a full replacement of the default list
 * (empty list = unbound). Kept per device in localStorage, like VS Code's
 * keybindings.json; not part of the synced graph data.
 */
export type Overrides = Partial<Record<CommandId, Keybinding[]>>;
export type Bindings = ReadonlyMap<CommandId, readonly Keybinding[]>;

const STORAGE_KEY = 'km.keybindings';

export function defaultBindings(isMac = IS_MAC): Bindings {
  return new Map(
    COMMAND_LIST.map((c) => [
      c.id,
      (isMac && c.macKeys ? c.macKeys : c.keys)
        .map((k) => parseBinding(k, isMac))
        .filter((k): k is string => k !== null),
    ]),
  );
}

/** Drops unknown commands and unparsable bindings from untrusted JSON. */
export function sanitizeOverrides(raw: unknown, isMac = IS_MAC): Overrides {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const out: Overrides = {};
  for (const [id, keys] of Object.entries(raw)) {
    if (!isCommandId(id) || !Array.isArray(keys)) continue;
    out[id] = [
      ...new Set(
        keys
          .filter((k): k is string => typeof k === 'string')
          .map((k) => parseBinding(k, isMac))
          .filter((k): k is string => k !== null),
      ),
    ];
  }
  return out;
}

export function mergeBindings(defaults: Bindings, overrides: Overrides): Bindings {
  const merged = new Map(defaults);
  for (const [id, keys] of Object.entries(overrides) as [CommandId, Keybinding[]][]) {
    merged.set(id, keys);
  }
  return merged;
}

/**
 * Two bindings clash if they are equal, or if one is a single press that is
 * the other's chord prefix: binding "Ctrl+K" alone makes "Ctrl+K Ctrl+S"
 * unreachable (the single press runs first).
 */
export function bindingsClash(a: Keybinding, b: Keybinding): boolean {
  if (a === b) return true;
  const [a1, a2] = splitBinding(a);
  const [b1, b2] = splitBinding(b);
  return (
    (a2 === undefined && b2 !== undefined && a1 === b1) ||
    (b2 === undefined && a2 !== undefined && a1 === b1)
  );
}

/** Commands (other than `except`) whose bindings clash with `binding`. */
export function clashingCommands(
  binding: Keybinding,
  bindings: Bindings,
  except?: CommandId,
): CommandId[] {
  return [...bindings]
    .filter(([id, keys]) => id !== except && keys.some((k) => bindingsClash(binding, k)))
    .map(([id]) => id);
}

/** Every command with at least one clash → the commands it clashes with. */
export function findConflicts(bindings: Bindings): ReadonlyMap<CommandId, CommandId[]> {
  const out = new Map<CommandId, CommandId[]>();
  for (const [id, keys] of bindings) {
    const others = [...new Set(keys.flatMap((k) => clashingCommands(k, bindings, id)))];
    if (others.length) out.set(id, others);
  }
  return out;
}

// ---- store -----------------------------------------------------------------

const DEFAULTS = defaultBindings();
let overrides: Overrides = sanitizeOverrides(readJson(STORAGE_KEY));
let bindings: Bindings = mergeBindings(DEFAULTS, overrides);
const listeners = new Set<() => void>();

function apply(next: Overrides): void {
  overrides = next;
  bindings = mergeBindings(DEFAULTS, overrides);
  for (const listener of listeners) listener();
}

function commit(next: Overrides): void {
  apply(next);
  writeJson(STORAGE_KEY, overrides);
}

// Another tab (or the installed PWA) changed them: adopt, don't clobber later.
if (typeof window !== 'undefined') {
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) apply(sanitizeOverrides(readJson(STORAGE_KEY)));
  };
  window.addEventListener('storage', onStorage);
  // Dev only: don't stack listeners on every hot reload of this module.
  import.meta.hot?.dispose(() => {
    window.removeEventListener('storage', onStorage);
  });
}

export function currentBindings(): Bindings {
  return bindings;
}

/** Replaces all of the command's bindings. */
export function setBinding(id: CommandId, keys: Keybinding[]): void {
  commit({ ...overrides, [id]: [...new Set(keys)] });
}

/** Adds one binding, keeping the existing ones. */
export function addBinding(id: CommandId, key: Keybinding): void {
  setBinding(id, [...(bindings.get(id) ?? []), key]);
}

export function resetBinding(id: CommandId): void {
  commit(Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== id)));
}

export function isUserBinding(id: CommandId): boolean {
  return id in overrides;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useBindings(): Bindings {
  return useSyncExternalStore(subscribe, currentBindings);
}
