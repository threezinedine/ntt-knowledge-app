import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error';

/** Every mounted autosave's flush, so the app can save everything now. */
const flushers = new Set<() => Promise<boolean>>();

/**
 * Saves every pending edit now, skipping debounce and retry backoff: right
 * after signing in again (a save failed while signed out), and before
 * signing out (a save after that would be refused).
 */
export async function flushAllAutosaves(): Promise<boolean> {
  const results = await Promise.all([...flushers].map((flush) => flush()));
  return results.every(Boolean); // false: a save failed (it retries on its own)
}

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
  /** The running save loop: a flush meanwhile waits for it (it drains new edits too). */
  const inFlight = useRef<Promise<boolean> | null>(null);
  /** For the retry timer: `flush` can't name itself in its own body. */
  const retry = useRef<() => Promise<boolean>>(() => Promise.resolve(true));
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const nextRetryMs = useRef(retryMs);
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  /**
   * Resolves once every edit so far is saved (true), or a save failed (false;
   * a retry is then scheduled).
   */
  const flush = useCallback((): Promise<boolean> => {
    clearTimeout(timer.current);
    if (inFlight.current) return inFlight.current; // it picks up new edits too
    const take = () => {
      const next = pending.current;
      pending.current = null;
      return next;
    };
    const run = async (): Promise<boolean> => {
      for (let next = take(); next !== null; next = take()) {
        setStatus('saving');
        try {
          await saveRef.current(next.value);
        } catch (error) {
          console.error('Autosave failed', error);
          pending.current ??= next; // unless a newer edit superseded it
          setStatus('error');
          timer.current = setTimeout(() => void retry.current(), nextRetryMs.current);
          nextRetryMs.current = Math.min(nextRetryMs.current * 2, maxRetryMs);
          return false;
        }
      }
      nextRetryMs.current = retryMs;
      setStatus('saved');
      return true;
    };
    inFlight.current = run().finally(() => {
      inFlight.current = null;
    });
    return inFlight.current;
  }, [retryMs, maxRetryMs]);
  useEffect(() => {
    retry.current = flush;
  }, [flush]);

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
    flushers.add(flush);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      flushers.delete(flush);
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
