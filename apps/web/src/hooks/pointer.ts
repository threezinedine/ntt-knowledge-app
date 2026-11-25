/**
 * A touch screen (finger) rather than a mouse: no hover, an on-screen
 * keyboard that pops up on focus, drags that should scroll the page.
 * Asked each time, so a hybrid laptop switching modes is followed.
 */
export function isCoarsePointer(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
}
