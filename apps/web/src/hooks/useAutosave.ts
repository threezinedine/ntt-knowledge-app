import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

export interface AutosaveOptions {
  /** Debounce after the last edit. */
  delayMs?: number;
  /** First retry delay after a failed save; doubles up to `maxRetryMs`. */
  retryMs?: number;
  maxRetryMs?: number;
}

/**
 * Debounced autosave for a local draft.
 *
 * - `update(draft)` records the latest value and schedules a save.
 * - One save in flight at a time; edits made meanwhile are drained by the same
 *   loop, so the last write always wins.
 * - A failed save keeps its value (unless superseded) and retries with
 *   exponential backoff.
 * - Pending edits are flushed on unmount, when the page is hidden (tab switch,
 *   Android backgrounding) and on `pagehide`; leaving with unsaved edits
 *   triggers the browser's "leave site?" prompt.
 */
export function useAutosave<T>(
  save: (value: T) => Promise<unknown>,
  { delayMs = 500, retryMs = 2_000, maxRetryMs = 30_000 }: AutosaveOptions = {},
) {
  const [status, setStatus] = useState<SaveStatus>('saved');
  const pending = useRef<{ value: T } | null>(null);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const nextRetryMs = useRef(retryMs);
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const flush = useCallback(async (): Promise<void> => {
    clearTimeout(timer.current);
    if (inFlight.current) return; // the running loop will pick up new edits
    inFlight.current = true;
    const take = () => {
      const next = pending.current;
      pending.current = null;
      return next;
    };
    try {
      for (let next = take(); next !== null; next = take()) {
        setStatus('saving');
        try {
          await saveRef.current(next.value);
        } catch (error) {
          console.error('Autosave failed', error);
          pending.current ??= next; // unless a newer edit superseded it
          setStatus('error');
          timer.current = setTimeout(() => void flush(), nextRetryMs.current);
          nextRetryMs.current = Math.min(nextRetryMs.current * 2, maxRetryMs);
          return;
        }
      }
      nextRetryMs.current = retryMs;
      setStatus('saved');
    } finally {
      inFlight.current = false;
    }
  }, [retryMs, maxRetryMs]);

  const update = useCallback(
    (value: T) => {
      pending.current = { value };
      setStatus('dirty');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), delayMs);
    },
    [delayMs, flush],
  );

  // Flush when the page goes away or into the background.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flush();
    };
    const onPageHide = () => void flush();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      clearTimeout(timer.current);
      void flush(); // unmount (e.g. navigating to another node)
    };
  }, [flush]);

  // Warn before closing/reloading with unsaved work.
  useEffect(() => {
    if (status === 'saved') return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [status]);

  return { status, update, flush };
}
