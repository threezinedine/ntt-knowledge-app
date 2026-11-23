import { useSyncExternalStore } from 'react';
import { readJson, writeJson } from '../commands/storage';

/** Vim keys in the node editor (title + content). Per device, off by default. */
const STORAGE_KEY = 'km.vimMode';

let enabled = readJson(STORAGE_KEY) === true;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  enabled = next;
  for (const listener of listeners) listener();
}

export function setVimMode(next: boolean): void {
  set(next);
  writeJson(STORAGE_KEY, next);
}

export function toggleVimMode(): void {
  setVimMode(!enabled);
}

// Another tab changed it.
if (typeof window !== 'undefined') {
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY || e.key === null) set(readJson(STORAGE_KEY) === true);
  };
  window.addEventListener('storage', onStorage);
  import.meta.hot?.dispose(() => {
    window.removeEventListener('storage', onStorage);
  });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useVimMode(): boolean {
  return useSyncExternalStore(subscribe, () => enabled);
}
