import type { TagExp } from '@km/core';

export interface LevelUp {
  tagId: string;
  level: number;
}

/**
 * Compares a fresh EXP snapshot with the highest level seen so far per tag.
 * A tag seen for the first time is only recorded (no celebration on page load
 * or for a brand-new tag); a tag that passes its best level so far is a level
 * up. Using the best level, not the last one, means untagging a node and
 * tagging it back doesn't celebrate the same level twice.
 */
export function detectLevelUps(
  best: ReadonlyMap<string, number>,
  tags: readonly TagExp[],
): { ups: LevelUp[]; best: Map<string, number> } {
  const next = new Map(best);
  const ups: LevelUp[] = [];
  for (const e of tags) {
    const prev = best.get(e.tagId);
    if (prev === undefined || e.level > prev) next.set(e.tagId, e.level);
    if (prev !== undefined && e.level > prev) ups.push({ tagId: e.tagId, level: e.level });
  }
  return { ups, best: next };
}
