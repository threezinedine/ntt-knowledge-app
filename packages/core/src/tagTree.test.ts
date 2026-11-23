import { describe, expect, it } from 'vitest';
import { buildTagTree, flattenTagTree, wouldCreateTagCycle } from './tagTree.js';
import type { Tag } from './schemas/tag.js';

const cat = (id: string, name: string, parentId: string | null = null): Tag => ({
  id,
  name,
  parentId,
  color: null,
  createdAt: 0,
  updatedAt: 0,
});

describe('buildTagTree', () => {
  it('nests children under parents and sorts siblings by name', () => {
    const tree = buildTagTree([
      cat('w', 'Work'),
      cat('b', 'Backend', 'w'),
      cat('a', 'API', 'b'),
      cat('h', 'Health'),
      cat('f', 'Frontend', 'w'),
    ]);

    expect(tree.map((n) => n.tag.name)).toEqual(['Health', 'Work']);
    const work = tree[1];
    expect(work?.children.map((n) => n.tag.name)).toEqual(['Backend', 'Frontend']);
    expect(work?.children[0]?.children[0]?.path).toEqual(['Work', 'Backend', 'API']);
    expect(work?.children[0]?.children[0]?.depth).toBe(2);
  });

  it('promotes orphans whose parent is missing to roots', () => {
    const tree = buildTagTree([cat('x', 'Orphan', 'missing')]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.path).toEqual(['Orphan']);
  });

  it('flattens depth-first', () => {
    const flat = flattenTagTree(
      buildTagTree([cat('w', 'Work'), cat('b', 'Backend', 'w'), cat('h', 'Health')]),
    );
    expect(flat.map((n) => n.tag.id)).toEqual(['h', 'w', 'b']);
  });
});

describe('wouldCreateTagCycle', () => {
  const cats = [cat('a', 'A'), cat('b', 'B', 'a'), cat('c', 'C', 'b')];

  it('rejects self-parenting', () => {
    expect(wouldCreateTagCycle(cats, 'a', 'a')).toBe(true);
  });

  it('rejects parenting to a descendant', () => {
    expect(wouldCreateTagCycle(cats, 'a', 'c')).toBe(true);
  });

  it('allows moving to an unrelated branch or to root', () => {
    expect(wouldCreateTagCycle([...cats, cat('d', 'D')], 'c', 'd')).toBe(false);
    expect(wouldCreateTagCycle(cats, 'c', null)).toBe(false);
  });
});
