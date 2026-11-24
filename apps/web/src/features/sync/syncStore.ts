import { hubIsNewer, type SyncStatus } from '@km/core';
import { useSyncExternalStore } from 'react';

/**
 * UI state of sync that lives outside any one component: whether the Sync
 * dialog is open (the title bar, the palette and the edit warning open it),
 * and the "a newer version is on the hub" warning shown when you start
 * editing anyway.
 */
export type SyncAction = 'push' | 'pull';

interface State {
  dialog: { action: SyncAction | null } | null;
  /** The hub version the edit warning is about, while it is shown. */
  warning: number | null;
}

let state: State = { dialog: null, warning: null };
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  for (const l of listeners) l();
};

export const useSyncUi = (): State =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );

/** Opens the Sync dialog; with an action, it starts it at once. */
export function openSyncDialog(action: SyncAction | null = null): void {
  set({ dialog: { action }, warning: null });
}

export function closeSyncDialog(): void {
  set({ dialog: null });
}

export function dismissSyncWarning(): void {
  set({ warning: null });
}

/** Which hub version the user was already warned about (once each, across reloads). */
const WARNED_KEY = 'km.sync.warnedHash';

function warnedHash(): string | null {
  try {
    return localStorage.getItem(WARNED_KEY);
  } catch {
    return null;
  }
}

/**
 * Called on every edit (main.tsx, MutationCache). If the hub has a version
 * this device hasn't pulled, warns once for that version, then lets you edit:
 * the edit goes ahead either way. Offline (the hub didn't answer) it stays
 * quiet: there is nothing newer to know about.
 */
export function noteEdit(status: SyncStatus | undefined): void {
  if (!status?.connected || !hubIsNewer(status) || status.hub === null) return;
  if (warnedHash() === status.hub.hash || state.dialog !== null) return;
  try {
    localStorage.setItem(WARNED_KEY, status.hub.hash);
  } catch {
    // Storage blocked: it warns again after a reload, no worse than that.
  }
  set({ warning: status.hub.version });
}
