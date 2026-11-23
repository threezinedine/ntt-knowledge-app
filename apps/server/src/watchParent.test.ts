import { afterEach, describe, expect, it, vi } from 'vitest';
import { isAlive, watchParent } from './watchParent.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('watchParent', () => {
  it('fires once, after the watched process is gone', () => {
    vi.useFakeTimers();
    let alive = true;
    const onGone = vi.fn();
    watchParent(123, onGone, 1000, () => alive);

    vi.advanceTimersByTime(3000);
    expect(onGone).not.toHaveBeenCalled();
    alive = false;
    vi.advanceTimersByTime(3000);
    expect(onGone).toHaveBeenCalledTimes(1);
  });

  it('can be stopped', () => {
    vi.useFakeTimers();
    const onGone = vi.fn();
    const stop = watchParent(123, onGone, 1000, () => false);
    stop();
    vi.advanceTimersByTime(3000);
    expect(onGone).not.toHaveBeenCalled();
  });

  it('isAlive sees this process', () => {
    expect(isAlive(process.pid)).toBe(true);
  });
});
