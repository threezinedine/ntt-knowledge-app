import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { CommandId } from './catalog';

type Handler = () => void;
interface Entry {
  handler: Handler;
  seq: number;
}

/**
 * Who can run each command right now. Components register handlers while
 * mounted (a page's commands exist only on that page), so "available" is just
 * "has a handler". If several components register the same command, the most
 * recent registration wins (the innermost/latest view, like VS Code focus).
 */
const handlers = new Map<CommandId, Entry[]>();
const listeners = new Set<() => void>();
let seq = 0;
let snapshot: ReadonlyMap<CommandId, number> = new Map();

function publish(): void {
  const next = new Map<CommandId, number>();
  for (const [id, entries] of handlers) {
    const top = entries.at(-1);
    if (top) next.set(id, top.seq);
  }
  snapshot = next;
  for (const listener of listeners) listener();
}

export function registerHandler(id: CommandId, handler: Handler): () => void {
  const entry: Entry = { handler, seq: ++seq };
  handlers.set(id, [...(handlers.get(id) ?? []), entry]);
  publish();
  return () => {
    const rest = (handlers.get(id) ?? []).filter((e) => e !== entry);
    if (rest.length) handlers.set(id, rest);
    else handlers.delete(id);
    publish();
  };
}

/** Runs the command if something can; returns whether it ran. */
export function runCommand(id: CommandId): boolean {
  const entry = handlers.get(id)?.at(-1);
  if (!entry) return false;
  entry.handler();
  return true;
}

/** Available command ids → registration order (higher = more recent). */
export function availableCommands(): ReadonlyMap<CommandId, number> {
  return snapshot;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAvailableCommands(): ReadonlyMap<CommandId, number> {
  return useSyncExternalStore(subscribe, availableCommands);
}

/**
 * Makes `id` runnable while this component is mounted (and `enabled`). The
 * latest `handler` is always used, so callers needn't memoise it.
 */
export function useCommandHandler(id: CommandId, handler: Handler, enabled = true): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => {
    if (!enabled) return;
    return registerHandler(id, () => {
      latest.current();
    });
  }, [id, enabled]);
}
