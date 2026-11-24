import { describe, expect, it } from 'vitest';
import {
  computeTagExp,
  countWords,
  DEFAULT_LEVEL_CONFIG,
  expSnapshot,
  levelConfigSchema,
  levelFor,
  nodeExp,
  whysExp,
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
    expect(nodeExp(0, config)).toBe(10);
    expect(nodeExp(25, config)).toBe(12);
    expect(nodeExp(1000, config)).toBe(15); // capped
  });
});

describe('whysExp', () => {
  const whys = levelConfigSchema.parse({ expPerWhy: 5, maxWhysExpPerNode: 100 });

  it('doubles per level of depth', () => {
    expect(whysExp([], whys)).toBe(0);
    expect(whysExp([1], whys)).toBe(5);
    expect(whysExp([2], whys)).toBe(10);
    expect(whysExp([1, 2, 3, 4], whys)).toBe(5 + 10 + 20 + 40);
  });

  it('is capped per node, even for a very deep why', () => {
    expect(whysExp([1, 2, 3, 4, 5], whys)).toBe(100); // 155 uncapped
    expect(whysExp([30], whys)).toBe(100);
  });

  it('defaults to 5 per top-level why, at most 200 per node', () => {
    expect(whysExp([1, 3], DEFAULT_LEVEL_CONFIG)).toBe(25);
    expect(whysExp([6, 6], DEFAULT_LEVEL_CONFIG)).toBe(200);
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
    const totals = computeTagExp(tags, [{ words: 0, tagIds: ['cpu'], whyDepths: [] }], config);
    expect(totals.get('cpu')).toEqual({ exp: 10, nodeCount: 1 });
    expect(totals.get('computer')).toEqual({ exp: 10, nodeCount: 1 });
    expect(totals.get('gpu')).toEqual({ exp: 0, nodeCount: 0 });
  });

  it('counts a node once per field, however many of its tags lie below it', () => {
    const totals = computeTagExp(
      tags,
      [{ words: 0, tagIds: ['cpu', 'gpu', 'computer'], whyDepths: [] }],
      config,
    );
    expect(totals.get('computer')).toEqual({ exp: 10, nodeCount: 1 });
  });

  it('adds 5 Whys EXP to the node, so to all its fields', () => {
    const totals = computeTagExp(tags, [{ words: 0, tagIds: ['cpu'], whyDepths: [1, 2] }], {
      ...config,
      expPerWhy: 3,
      maxWhysExpPerNode: 100,
    });
    expect(totals.get('cpu')).toEqual({ exp: 10 + 3 + 6, nodeCount: 1 });
    expect(totals.get('computer')).toEqual({ exp: 19, nodeCount: 1 });
  });

  it('ignores unknown tags and survives a corrupt cycle', () => {
    const cyclic = [
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ];
    const totals = computeTagExp(
      cyclic,
      [{ words: 0, tagIds: ['a', 'gone'], whyDepths: [] }],
      config,
    );
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
        { words: 0, tagIds: ['cpu'], whyDepths: [] },
        { words: 0, tagIds: ['cpu'], whyDepths: [] },
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
