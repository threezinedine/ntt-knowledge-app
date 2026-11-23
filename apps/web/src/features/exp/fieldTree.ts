import type { TagTreeNode } from '@km/core';

export interface FieldRow {
  node: TagTreeNode;
  parentId: string | null;
  hasChildren: boolean;
  expanded: boolean;
  /** 1-based, among its siblings (for aria-posinset / aria-setsize). */
  posInSet: number;
  setSize: number;
}

/** Depth-first rows of the tag tree, skipping everything under a collapsed tag. */
export function visibleFieldRows(
  tree: readonly TagTreeNode[],
  collapsed: ReadonlySet<string>,
  /** Tags failing this are left out together with their subtree. */
  include: (node: TagTreeNode) => boolean = () => true,
): FieldRow[] {
  const out: FieldRow[] = [];
  const walk = (all: readonly TagTreeNode[], parentId: string | null) => {
    const nodes = all.filter(include);
    nodes.forEach((node, i) => {
      const hasChildren = node.children.some(include);
      const expanded = hasChildren && !collapsed.has(node.tag.id);
      out.push({ node, parentId, hasChildren, expanded, posInSet: i + 1, setSize: nodes.length });
      if (expanded) walk(node.children, node.tag.id);
    });
  };
  walk(tree, null);
  return out;
}

export type TreeKeyAction =
  { kind: 'focus'; id: string } | { kind: 'toggle'; id: string } | { kind: 'none' };

/** What a key does on row `id`, following the WAI-ARIA tree pattern. */
export function treeKeyAction(key: string, rows: readonly FieldRow[], id: string): TreeKeyAction {
  const i = rows.findIndex((r) => r.node.tag.id === id);
  const row = rows[i];
  if (!row) return { kind: 'none' };
  const focus = (r: FieldRow | undefined): TreeKeyAction =>
    r ? { kind: 'focus', id: r.node.tag.id } : { kind: 'none' };
  switch (key) {
    case 'ArrowDown':
      return focus(rows[i + 1]);
    case 'ArrowUp':
      return focus(rows[i - 1]);
    case 'Home':
      return focus(rows[0]);
    case 'End':
      return focus(rows.at(-1));
    case 'ArrowRight':
      if (!row.hasChildren) return { kind: 'none' };
      return row.expanded ? focus(rows[i + 1]) : { kind: 'toggle', id };
    case 'ArrowLeft':
      if (row.expanded) return { kind: 'toggle', id };
      return row.parentId === null ? { kind: 'none' } : { kind: 'focus', id: row.parentId };
    case 'Enter':
    case ' ':
      return row.hasChildren ? { kind: 'toggle', id } : { kind: 'none' };
    default:
      return { kind: 'none' };
  }
}
