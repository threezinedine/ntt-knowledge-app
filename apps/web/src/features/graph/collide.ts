import type { Position } from '@km/core';

export interface Circle {
  x: number;
  y: number;
  r: number;
}

export interface PushOptions {
  /** Room always kept between two dots' edges (labels sit below dots). */
  gap: number;
  /** A dragged dot affects others whose edges are within this distance of its own... */
  reach: number;
  /** ...moving them this share of the way out of reach (0 = only hard collisions). */
  softness: number;
}

export const PUSH_DEFAULTS: PushOptions = { gap: 28, reach: 110, softness: 0.45 };

/** How many times pushed dots may push their own neighbours. */
const PASSES = 4;

/**
 * While dots are dragged, where the others should be. Each starts from where
 * it was when the drag began (`origins`):
 *
 * - near a dragged dot (within `reach`), it is eased away from it, more the
 *   closer it is, and never closer than `gap` edge to edge;
 * - a pushed dot that now overlaps a neighbour (closer than `gap`) shoves it
 *   just enough, for a few passes, so a crowd parts without the whole
 *   cluster spreading out;
 * - once the drag moves on, dots fall back to their origin.
 *
 * Returns the new centre of every dot that isn't at its origin.
 */
export function pushAway(
  dragged: ReadonlyMap<string, Circle>,
  origins: ReadonlyMap<string, Circle>,
  { gap, reach, softness }: PushOptions = PUSH_DEFAULTS,
): Map<string, Position> {
  const placed = new Map<string, Circle>();
  for (const [id, c] of origins) if (!dragged.has(id)) placed.set(id, { ...c });

  /** Moves `mover` straight away from `from` to at least `want` (centre to centre). */
  const moveTo = (
    mover: Circle,
    from: Circle,
    dist: number,
    dx: number,
    dy: number,
    want: number,
  ) => {
    if (dist < 0.001) {
      // Exactly on top: pick a stable direction rather than dividing by 0.
      dx = 1;
      dy = 0;
      dist = 1;
    }
    mover.x = from.x + (dx / dist) * want;
    mover.y = from.y + (dy / dist) * want;
  };

  /** Hard: just clear of `from` by `gap` (or by `atMost`, if that is less). */
  const separate = (mover: Circle, from: Circle, atMost = Infinity) => {
    const min = Math.min(mover.r + from.r + gap, atMost);
    const dx = mover.x - from.x;
    const dy = mover.y - from.y;
    const dist = Math.hypot(dx, dy);
    if (dist >= min) return false;
    moveTo(mover, from, dist, dx, dy, min);
    return true;
  };

  /** Soft: eased out of a dragged dot's reach, and at least clear of it. */
  const yieldTo = (mover: Circle, from: Circle) => {
    const min = mover.r + from.r + gap;
    const far = mover.r + from.r + reach;
    const dx = mover.x - from.x;
    const dy = mover.y - from.y;
    const dist = Math.hypot(dx, dy);
    if (dist >= far && dist >= min) return false;
    const want = Math.max(min, dist + Math.max(0, far - dist) * softness);
    if (want - dist < 0.01) return false;
    moveTo(mover, from, dist, dx, dy, want);
    return true;
  };

  /** Clear of every dragged dot (a few rounds: clearing one can bump into another). */
  const clearOfDragged = (c: Circle, soft: boolean) => {
    let any = false;
    for (let round = 0; round < 4; round++) {
      let bumped = false;
      for (const d of dragged.values()) {
        // Soft easing only on the first round; later rounds just resolve overlaps.
        if (soft && round === 0 ? yieldTo(c, d) : separate(c, d)) bumped = true;
      }
      if (!bumped) break;
      any = true;
    }
    return any;
  };

  // 1. Out of the way of what is being dragged.
  const moved = new Set<string>();
  for (const [id, c] of placed) if (clearOfDragged(c, true)) moved.add(id);
  // 2. Pushed dots shove neighbours they now overlap (never into a dragged one).
  for (let pass = 0; pass < PASSES && moved.size > 0; pass++) {
    let changed = false;
    for (const pusherId of [...moved]) {
      const pusher = placed.get(pusherId);
      if (!pusher) continue;
      for (const [id, c] of placed) {
        if (id === pusherId || moved.has(id)) continue;
        // Dots that already sat this close before the drag are left that close:
        // a drag elsewhere shouldn't tidy up a cluster the user built.
        const a = origins.get(id);
        const b = origins.get(pusherId);
        const before = a && b ? Math.hypot(a.x - b.x, a.y - b.y) : Infinity;
        if (separate(c, pusher, before)) {
          moved.add(id);
          changed = true;
          clearOfDragged(c, false);
        }
      }
    }
    if (!changed) break;
  }

  const out = new Map<string, Position>();
  for (const id of moved) {
    const c = placed.get(id);
    const o = origins.get(id);
    if (c && o && (Math.abs(c.x - o.x) > 0.01 || Math.abs(c.y - o.y) > 0.01)) {
      out.set(id, { x: c.x, y: c.y });
    }
  }
  return out;
}
