import { useEffect, useSyncExternalStore } from 'react';

/** One short, transient status message ("Link copied"). */
let message: { text: string; id: number } | null = null;
let seq = 0;
const listeners = new Set<() => void>();

export function showToast(text: string): void {
  message = { text, id: ++seq };
  for (const listener of listeners) listener();
}

function clear(id: number): void {
  if (message?.id !== id) return;
  message = null;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Mount once. Polite live region, so screen readers hear it too. */
export function Toast() {
  const current = useSyncExternalStore(subscribe, () => message);
  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(() => {
      clear(current.id);
    }, 2500);
    return () => {
      clearTimeout(timer);
    };
  }, [current]);
  return (
    <div className="toast-region" role="status" aria-live="polite">
      {current && <div className="toast">{current.text}</div>}
    </div>
  );
}
