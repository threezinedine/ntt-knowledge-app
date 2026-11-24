import type { TagExp } from '@km/core';
import { describe, expect, it } from 'vitest';
import { detectLevelUps } from './levelUps';

const e = (tagId: string, level: number): TagExp => ({
  tagId,
  level,
  exp: 0,
  nodeCount: 0,
  levelStartExp: 0,
  nextLevelExp: 50,
});

describe('detectLevelUps', () => {
  it('records the first snapshot without celebrating', () => {
    const { ups, best } = detectLevelUps(new Map(), [e('a', 3), e('b', 1)]);
    expect(ups).toEqual([]);
    expect([...best]).toEqual([
      ['a', 3],
      ['b', 1],
    ]);
  });

  it('reports every tag that passes its best level, at its new level', () => {
    const start = new Map([
      ['a', 1],
      ['b', 2],
      ['c', 1],
    ]);
    const { ups, best } = detectLevelUps(start, [e('a', 2), e('b', 2), e('c', 3)]);
    expect(ups).toEqual([
      { tagId: 'a', level: 2 },
      { tagId: 'c', level: 3 },
    ]);
    expect(best.get('c')).toBe(3);
  });

  it('does not celebrate a new tag, or a level regained after dropping', () => {
    const start = new Map([['a', 2]]);
    const down = detectLevelUps(start, [e('a', 1), e('new', 2)]);
    expect(down.ups).toEqual([]);
    expect(down.best.get('a')).toBe(2);
    expect(detectLevelUps(down.best, [e('a', 2), e('new', 2)]).ups).toEqual([]);
    expect(detectLevelUps(down.best, [e('a', 3)]).ups).toEqual([{ tagId: 'a', level: 3 }]);
  });
});
