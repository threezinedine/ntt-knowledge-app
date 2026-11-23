import { buildTagTree, type Tag } from '@km/core';
import { describe, expect, it } from 'vitest';
import { treeKeyAction, visibleFieldRows } from './fieldTree';

const tag = (id: string, name: string, parentId: string | null = null): Tag => ({
  id,
  name,
  parentId,
  color: null,
  createdAt: 0,
  updatedAt: 0,
});

// Computer > (CPU > Cache), GPU; Math
const tree = buildTagTree([
  tag('c', 'Computer'),
  tag('cpu', 'CPU', 'c'),
  tag('l1', 'Cache', 'cpu'),
  tag('gpu', 'GPU', 'c'),
  tag('m', 'Math'),
]);
const ids = (collapsed: string[]) =>
  visibleFieldRows(tree, new Set(collapsed)).map((r) => r.node.tag.id);

describe('visibleFieldRows', () => {
  it('lists everything depth-first when nothing is collapsed', () => {
    expect(ids([])).toEqual(['c', 'cpu', 'l1', 'gpu', 'm']);
  });

  it('hides the whole subtree of a collapsed tag', () => {
    expect(ids(['cpu'])).toEqual(['c', 'cpu', 'gpu', 'm']);
    expect(ids(['c'])).toEqual(['c', 'm']);
  });

  it('leaves out an excluded tag with its subtree, renumbering siblings', () => {
    const rows = visibleFieldRows(tree, new Set(), (n) => n.tag.id !== 'cpu');
    expect(rows.map((r) => r.node.tag.id)).toEqual(['c', 'gpu', 'm']);
    expect(rows[1]).toMatchObject({ posInSet: 1, setSize: 1, parentId: 'c' });
  });

  it('ignores collapsing a leaf and reports set positions', () => {
    const rows = visibleFieldRows(tree, new Set(['gpu']));
    const gpu = rows.find((r) => r.node.tag.id === 'gpu');
    expect(gpu).toMatchObject({ hasChildren: false, expanded: false, posInSet: 2, setSize: 2 });
    expect(rows[0]).toMatchObject({ hasChildren: true, expanded: true, parentId: null });
  });
});

describe('treeKeyAction', () => {
  const rows = visibleFieldRows(tree, new Set(['cpu']));
  it('moves up and down the visible rows', () => {
    expect(treeKeyAction('ArrowDown', rows, 'cpu')).toEqual({ kind: 'focus', id: 'gpu' });
    expect(treeKeyAction('ArrowUp', rows, 'c')).toEqual({ kind: 'none' });
    expect(treeKeyAction('End', rows, 'c')).toEqual({ kind: 'focus', id: 'm' });
  });

  it('Right expands a collapsed tag, then enters it', () => {
    expect(treeKeyAction('ArrowRight', rows, 'cpu')).toEqual({ kind: 'toggle', id: 'cpu' });
    expect(treeKeyAction('ArrowRight', rows, 'c')).toEqual({ kind: 'focus', id: 'cpu' });
    expect(treeKeyAction('ArrowRight', rows, 'gpu')).toEqual({ kind: 'none' });
  });

  it('Home, Enter and Space', () => {
    expect(treeKeyAction('Home', rows, 'm')).toEqual({ kind: 'focus', id: 'c' });
    expect(treeKeyAction('Enter', rows, 'cpu')).toEqual({ kind: 'toggle', id: 'cpu' });
    expect(treeKeyAction(' ', rows, 'c')).toEqual({ kind: 'toggle', id: 'c' });
    expect(treeKeyAction('Enter', rows, 'gpu')).toEqual({ kind: 'none' });
    expect(treeKeyAction(' ', rows, 'm')).toEqual({ kind: 'none' });
  });

  it('Left collapses an open tag, else goes to the parent', () => {
    expect(treeKeyAction('ArrowLeft', rows, 'c')).toEqual({ kind: 'toggle', id: 'c' });
    expect(treeKeyAction('ArrowLeft', rows, 'gpu')).toEqual({ kind: 'focus', id: 'c' });
    expect(treeKeyAction('ArrowLeft', rows, 'm')).toEqual({ kind: 'none' });
  });
});
