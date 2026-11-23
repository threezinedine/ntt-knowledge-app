import { useSyncExternalStore } from 'react';

/** An entry of a custom quick pick (e.g. "Change Display Language"). */
export interface QuickPickItem {
  id: string;
  label: string;
  description?: string;
  /** Marks the current choice. */
  current?: boolean;
  run: () => void;
}

export interface CustomPick {
  placeholder: string;
  items: readonly QuickPickItem[];
}

/**
 * The single quick input box (VS Code's): `value` starting with ">" lists
 * commands, otherwise nodes; or a custom pick list.
 */
export interface QuickInputState {
  open: boolean;
  /** Bumped on every open, so re-opening resets the selection and refocuses. */
  session: number;
  initialValue: string;
  custom: CustomPick | null;
  /**
   * Focused before the box first opened; given back on close. Kept across
   * re-opens (Ctrl+P then F1), when the active element is the box itself.
   */
  returnFocus: Element | null;
}

let state: QuickInputState = {
  open: false,
  session: 0,
  initialValue: '',
  custom: null,
  returnFocus: null,
};
const listeners = new Set<() => void>();

function set(next: QuickInputState): void {
  state = next;
  for (const listener of listeners) listener();
}

function open(initialValue: string, custom: CustomPick | null): void {
  set({
    open: true,
    session: state.session + 1,
    initialValue,
    custom,
    returnFocus: state.open ? state.returnFocus : document.activeElement,
  });
}

export function openQuickInput(initialValue: string): void {
  open(initialValue, null);
}

export function openQuickPick(custom: CustomPick): void {
  open('', custom);
}

export function closeQuickInput(): void {
  if (state.open) set({ ...state, open: false });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useQuickInput(): QuickInputState {
  return useSyncExternalStore(subscribe, () => state);
}
