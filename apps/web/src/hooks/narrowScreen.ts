import { useSyncExternalStore } from 'react';

/** Must match the phone layout's `@media (max-width: 800px)` in styles.css. */
const NARROW = '(max-width: 800px)';

const query = () => (typeof window === 'undefined' ? null : window.matchMedia(NARROW));

/**
 * A phone-sized screen (the Android app, or a browser that narrow): one view
 * per tab in the bottom bar, no sidebar. Follows rotation and resizing.
 */
export function useNarrowScreen(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = query();
      mq?.addEventListener('change', onChange);
      return () => mq?.removeEventListener('change', onChange);
    },
    () => query()?.matches ?? false,
    () => false,
  );
}
