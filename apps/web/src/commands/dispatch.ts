import { useEffect, useSyncExternalStore } from 'react';
import { COMMAND_BY_ID, type CommandId } from './catalog';
import { currentBindings, type Bindings } from './keybindingStore';
import { firesWhileTyping, isEditableTarget, pressFromEvent, type KeyPress } from './keybinding';
import { availableCommands, runCommand } from './registry';

export type Resolution =
  | { kind: 'run'; id: CommandId }
  | { kind: 'chord'; prefix: KeyPress }
  | { kind: 'chordMiss'; binding: string }
  /** Ours, but do nothing (a held key auto-repeating). */
  | { kind: 'swallow' }
  | { kind: 'none' };

/**
 * What a press does, given a pending chord prefix. Among commands bound to
 * the same keys, the most recently registered available one wins. Holding a
 * key (`repeat`) only re-runs commands marked `repeatable` (zoom); otherwise
 * e.g. holding Alt+N would create a node per auto-repeat.
 */
export function resolvePress(
  press: KeyPress,
  pending: KeyPress | null,
  bindings: Bindings,
  available: ReadonlyMap<CommandId, number>,
  repeat = false,
): Resolution {
  const target = pending === null ? press : `${pending} ${press}`;
  let best: { id: CommandId; seq: number } | null = null;
  let startsChord = false;
  for (const [id, keys] of bindings) {
    const seq = available.get(id);
    if (seq === undefined) continue;
    for (const k of keys) {
      if (k === target && (best === null || seq > best.seq)) best = { id, seq };
      if (pending === null && k.startsWith(`${press} `)) startsChord = true;
    }
  }
  if (best) {
    return repeat && !COMMAND_BY_ID.get(best.id)?.repeatable
      ? { kind: 'swallow' }
      : { kind: 'run', id: best.id };
  }
  if (pending !== null) {
    return repeat ? { kind: 'swallow' } : { kind: 'chordMiss', binding: target };
  }
  if (startsChord) return repeat ? { kind: 'swallow' } : { kind: 'chord', prefix: press };
  return { kind: 'none' };
}

// ---- chord status (shown at the bottom, like VS Code's status bar) ---------

export type ChordStatus =
  { kind: 'waiting'; prefix: KeyPress } | { kind: 'miss'; binding: string } | null;

let status: ChordStatus = null;
const listeners = new Set<() => void>();
function setStatus(next: ChordStatus): void {
  status = next;
  for (const l of listeners) l();
}
export function useChordStatus(): ChordStatus {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => status,
  );
}

// ---- suspension (while recording a new keybinding) -------------------------

let suspended = 0;
/** Stops global shortcuts until the returned function is called. */
export function suspendKeybindings(): () => void {
  suspended++;
  let done = false;
  return () => {
    if (!done) suspended--;
    done = true;
  };
}

/**
 * A modal <dialog> (e.g. naming a new relation) makes the rest of the page
 * inert: a palette opened behind it couldn't take focus, and navigating away
 * would throw away what was typed. Shortcuts wait until it closes.
 */
function modalDialogOpen(): boolean {
  try {
    return document.querySelector('dialog:modal') !== null;
  } catch {
    return document.querySelector('dialog[open]') !== null; // no :modal support
  }
}

const CHORD_TIMEOUT_MS = 3000;
const MISS_DISPLAY_MS = 2000;

/** Installs the global keydown handler. Mount once, at the app root. */
export function useKeybindingDispatcher(): void {
  useEffect(() => {
    let pending: KeyPress | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const clearPending = (next: ChordStatus = null, ms = 0) => {
      pending = null;
      clearTimeout(timer);
      setStatus(next);
      if (next) {
        timer = setTimeout(() => {
          setStatus(null);
        }, ms);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (suspended > 0 || e.isComposing || modalDialogOpen()) return;
      const press = pressFromEvent(e);
      if (press === null) return;
      if (pending !== null && press === 'Escape') {
        e.preventDefault();
        clearPending();
        return;
      }
      if (pending === null && isEditableTarget(e.target) && !firesWhileTyping(press)) return;

      const result = resolvePress(press, pending, currentBindings(), availableCommands(), e.repeat);
      if (result.kind === 'none') return;
      // Ours: keep the browser (print, bookmarks, ...) and the editor out of it.
      e.preventDefault();
      e.stopPropagation();
      if (result.kind === 'swallow') return;
      if (result.kind === 'chord') {
        pending = result.prefix;
        clearTimeout(timer);
        setStatus({ kind: 'waiting', prefix: result.prefix });
        timer = setTimeout(() => {
          clearPending();
        }, CHORD_TIMEOUT_MS);
      } else if (result.kind === 'chordMiss') {
        clearPending({ kind: 'miss', binding: result.binding }, MISS_DISPLAY_MS);
      } else {
        clearPending();
        runCommand(result.id);
      }
    };

    // Capture phase: runs before CodeMirror and other widgets see the key.
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      clearTimeout(timer);
      setStatus(null); // don't leave "waiting for second key" behind
    };
  }, []);
}
