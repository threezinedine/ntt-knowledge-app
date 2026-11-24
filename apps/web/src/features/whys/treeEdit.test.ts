import type { WhyItem } from '@km/core';
import { describe, expect, it } from 'vitest';
import { addChild, addSiblingAfter, emptyWhy, removeWhy, updateWhy } from './treeEdit';

const w = (id: string, children: WhyItem[] = []): WhyItem => ({
  id,
  question: id,
  answer: '',
  takeaway: '',
  children,
});

// a > (a1 > a11), b
const tree = [w('a', [w('a1', [w('a11')])]), w('b')];
const shape = (items: WhyItem[]): unknown =>
  items.map((i) => (i.children.length ? [i.id, shape(i.children)] : i.id));

describe('why tree edits', () => {
  it('updates one why anywhere in the tree', () => {
    const next = updateWhy(tree, 'a11', { answer: 'yes' });
    expect(next[0]?.children[0]?.children[0]?.answer).toBe('yes');
    expect(tree[0]?.children[0]?.children[0]?.answer).toBe(''); // not mutated
  });

  it('adds a deeper why last under its parent', () => {
    expect(shape(addChild(tree, 'a', w('x')))).toEqual([['a', [['a1', ['a11']], 'x']], 'b']);
  });

  it('adds a why at the same level right after', () => {
    expect(shape(addSiblingAfter(tree, 'a1', w('x')))).toEqual([
      ['a', [['a1', ['a11']], 'x']],
      'b',
    ]);
    expect(shape(addSiblingAfter(tree, 'a', w('x')))).toEqual([['a', [['a1', ['a11']]]], 'x', 'b']);
  });

  it('removes a why with its subtree', () => {
    expect(shape(removeWhy(tree, 'a1'))).toEqual(['a', 'b']);
    expect(shape(removeWhy(tree, 'nope'))).toEqual(shape(tree));
  });

  it('makes empty whys with fresh ids', () => {
    expect(emptyWhy().id).not.toBe(emptyWhy().id);
  });
});
