import { describe, expect, it } from 'vitest';
import {
  computeTagExp,
  countWords,
  DEFAULT_LEVEL_CONFIG,
  expSnapshot,
  levelConfigSchema,
  levelFor,
  nodeExp,
} from './exp.js';

const config = levelConfigSchema.parse({
  expPerNode: 10,
  wordsPerExp: 10,
  maxContentExpPerNode: 5,
  levelThresholds: [20, 50, 100],
});

describe('countWords', () => {
  it('counts words in markdown, Vietnamese syllables one each', () => {
    expect(countWords('# Đồ thị\n\n- node **và** cạnh, x-ray')).toBe(6); // x-ray is one
    expect(countWords('')).toBe(0);
    expect(countWords("don't 2026")).toBe(2);
  });
});

describe('nodeExp', () => {
  it('is the base plus a capped bonus for content', () => {
    expect(nodeExp('', config)).toBe(10);
    expect(nodeExp('word '.repeat(25), config)).toBe(12);
    expect(nodeExp('word '.repeat(1000), config)).toBe(15); // capped
  });
});

describe('levelFor', () => {
  it('starts at level 1 and climbs at each threshold', () => {
    expect(levelFor(0, config)).toEqual({ level: 1, levelStartExp: 0, nextLevelExp: 20 });
    expect(levelFor(19, config).level).toBe(1);
    expect(levelFor(20, config)).toEqual({ level: 2, levelStartExp: 20, nextLevelExp: 50 });
    expect(levelFor(99, config).level).toBe(3);
  });

  it('stops at the top level', () => {
    expect(levelFor(100, config)).toEqual({ level: 4, levelStartExp: 100, nextLevelExp: null });
    expect(levelFor(10_000, config).level).toBe(4);
  });
});

describe('computeTagExp', () => {
  const tags = [
    { id: 'computer', parentId: null },
    { id: 'cpu', parentId: 'computer' },
    { id: 'gpu', parentId: 'computer' },
    { id: 'cooking', parentId: null },
  ];

  it('adds a node to its tags and every ancestor', () => {
    const totals = computeTagExp(tags, [{ content: '', tagIds: ['cpu'] }], config);
    expect(totals.get('cpu')).toEqual({ exp: 10, nodeCount: 1 });
    expect(totals.get('computer')).toEqual({ exp: 10, nodeCount: 1 });
    expect(totals.get('gpu')).toEqual({ exp: 0, nodeCount: 0 });
  });

  it('counts a node once per field, however many of its tags lie below it', () => {
    const totals = computeTagExp(
      tags,
      [{ content: '', tagIds: ['cpu', 'gpu', 'computer'] }],
      config,
    );
    expect(totals.get('computer')).toEqual({ exp: 10, nodeCount: 1 });
  });

  it('ignores unknown tags and survives a corrupt cycle', () => {
    const cyclic = [
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ];
    const totals = computeTagExp(cyclic, [{ content: '', tagIds: ['a', 'gone'] }], config);
    expect(totals.get('a')?.exp).toBe(10);
    expect(totals.get('b')?.exp).toBe(10);
  });
});

describe('levelConfigSchema', () => {
  it('fills defaults', () => {
    expect(DEFAULT_LEVEL_CONFIG.levelThresholds.slice(0, 3)).toEqual([50, 150, 300]);
  });

  it('rejects thresholds that do not increase, and unknown keys', () => {
    expect(levelConfigSchema.safeParse({ levelThresholds: [50, 50] }).success).toBe(false);
    expect(levelConfigSchema.safeParse({ expPerTask: 3 }).success).toBe(false);
  });
});

describe('expSnapshot', () => {
  it('gives every tag its exp and level', () => {
    const snapshot = expSnapshot(
      [{ id: 'cpu', parentId: null }],
      [
        { content: '', tagIds: ['cpu'] },
        { content: '', tagIds: ['cpu'] },
      ],
      config,
    );
    expect(snapshot).toEqual({
      maxLevel: 4,
      tags: [
        { tagId: 'cpu', exp: 20, nodeCount: 2, level: 2, levelStartExp: 20, nextLevelExp: 50 },
      ],
    });
  });
});
