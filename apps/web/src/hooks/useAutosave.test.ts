import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutosave } from './useAutosave';

/** A save function whose calls resolve/reject only when the test says so. */
function controllableSave() {
  const calls: { value: string; resolve: () => void; reject: (e: Error) => void }[] = [];
  const save = vi.fn(
    (value: string) =>
      new Promise<void>((resolve, reject) => {
        calls.push({ value, resolve, reject });
      }),
  );
  return { save, calls };
}

const settle = () =>
  act(async () => {
    await Promise.resolve();
  });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useAutosave', () => {
  it('a flush during a save resolves only once the edits made meanwhile are saved too', async () => {
    const { save, calls } = controllableSave();
    const { result } = renderHook(() => useAutosave(save, { delayMs: 10 }));
    act(() => {
      result.current.update('v1');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(calls).toHaveLength(1); // v1 in flight
    act(() => {
      result.current.update('v2');
    });
    let done = false;
    void result.current.flush().then(() => {
      done = true;
    });
    await act(async () => {
      calls[0]?.resolve();
      await Promise.resolve();
    });
    expect(calls[1]?.value).toBe('v2');
    expect(done).toBe(false);
    await act(async () => {
      calls[1]?.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(done).toBe(true);
  });

  it('debounces edits into a single save of the latest value', async () => {
    const { save, calls } = controllableSave();
    const { result } = renderHook(() => useAutosave(save, { delayMs: 100 }));

    act(() => {
      result.current.update('a');
      result.current.update('ab');
    });
    expect(result.current.status).toBe('dirty');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(save).toHaveBeenCalledTimes(1);
    expect(calls[0]?.value).toBe('ab');
    expect(result.current.status).toBe('saving');

    await act(async () => {
      calls[0]?.resolve();
      await Promise.resolve();
    });
    expect(result.current.status).toBe('saved');
  });

  it('never runs two saves at once and saves edits made during a save afterwards', async () => {
    const { save, calls } = controllableSave();
    const { result } = renderHook(() => useAutosave(save, { delayMs: 10 }));

    act(() => {
      result.current.update('v1');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    act(() => {
      result.current.update('v2');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10); // timer fires while v1 is in flight
    });
    expect(save).toHaveBeenCalledTimes(1);

    await act(async () => {
      calls[0]?.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(calls.map((c) => c.value)).toEqual(['v1', 'v2']);
    await act(async () => {
      calls[1]?.resolve();
      await Promise.resolve();
    });
    expect(result.current.status).toBe('saved');
  });

  it('keeps a failed value and retries with backoff', async () => {
    const { save, calls } = controllableSave();
    const { result } = renderHook(() =>
      useAutosave(save, { delayMs: 10, retryMs: 1_000, maxRetryMs: 5_000 }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    act(() => {
      result.current.update('x');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    await act(async () => {
      calls[0]?.reject(new Error('offline'));
      await Promise.resolve();
    });
    expect(result.current.status).toBe('error');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(calls[1]?.value).toBe('x');
  });

  it('a newer edit supersedes a failed value', async () => {
    const { save, calls } = controllableSave();
    const { result } = renderHook(() => useAutosave(save, { delayMs: 10, retryMs: 1_000 }));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    act(() => {
      result.current.update('old');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    act(() => {
      result.current.update('new'); // typed while 'old' is in flight
    });
    await act(async () => {
      calls[0]?.reject(new Error('boom'));
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(calls[1]?.value).toBe('new');
  });

  it('flushes pending edits on unmount and when the page is hidden', async () => {
    const { save, calls } = controllableSave();
    const { result, unmount } = renderHook(() => useAutosave(save, { delayMs: 10_000 }));

    act(() => {
      result.current.update('hidden');
    });
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(calls.map((c) => c.value)).toEqual(['hidden']);
    await act(async () => {
      calls[0]?.resolve();
      await Promise.resolve();
    });

    act(() => {
      result.current.update('unmount');
    });
    unmount();
    expect(calls.map((c) => c.value)).toEqual(['hidden', 'unmount']);
    await settle();
  });
});
