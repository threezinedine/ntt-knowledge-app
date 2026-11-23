import { describe, expect, it } from 'vitest';
import {
  buildCategoryTree,
  flattenCategoryTree,
  wouldCreateCategoryCycle,
} from './categoryTree.js';
import type { Category } from './schemas/task.js';

const cat = (id: string, name: string, parentId: string | null = null): Category => ({
  id,
  name,
  parentId,
  color: null,
  createdAt: 0,
  updatedAt: 0,
});

describe('buildCategoryTree', () => {
  it('nests children under parents and sorts siblings by name', () => {
    const tree = buildCategoryTree([
      cat('w', 'Work'),
      cat('b', 'Backend', 'w'),
      cat('a', 'API', 'b'),
      cat('h', 'Health'),
      cat('f', 'Frontend', 'w'),
    ]);

    expect(tree.map((n) => n.category.name)).toEqual(['Health', 'Work']);
    const work = tree[1];
    expect(work?.children.map((n) => n.category.name)).toEqual(['Backend', 'Frontend']);
    expect(work?.children[0]?.children[0]?.path).toEqual(['Work', 'Backend', 'API']);
    expect(work?.children[0]?.children[0]?.depth).toBe(2);
  });

  it('promotes orphans whose parent is missing to roots', () => {
    const tree = buildCategoryTree([cat('x', 'Orphan', 'missing')]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.path).toEqual(['Orphan']);
  });

  it('flattens depth-first', () => {
    const flat = flattenCategoryTree(
      buildCategoryTree([cat('w', 'Work'), cat('b', 'Backend', 'w'), cat('h', 'Health')]),
    );
    expect(flat.map((n) => n.category.id)).toEqual(['h', 'w', 'b']);
  });
});

describe('wouldCreateCategoryCycle', () => {
  const cats = [cat('a', 'A'), cat('b', 'B', 'a'), cat('c', 'C', 'b')];

  it('rejects self-parenting', () => {
    expect(wouldCreateCategoryCycle(cats, 'a', 'a')).toBe(true);
  });

  it('rejects parenting to a descendant', () => {
    expect(wouldCreateCategoryCycle(cats, 'a', 'c')).toBe(true);
  });

  it('allows moving to an unrelated branch or to root', () => {
    expect(wouldCreateCategoryCycle([...cats, cat('d', 'D')], 'c', 'd')).toBe(false);
    expect(wouldCreateCategoryCycle(cats, 'c', null)).toBe(false);
  });
});
