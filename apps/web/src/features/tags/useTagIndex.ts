import { buildTagTree, flattenTagTree, type Tag, type TagTreeNode } from '@km/core';
import { useMemo } from 'react';
import { useTags } from '../../api/queries';

export interface TagIndex {
  all: Tag[];
  tree: TagTreeNode[];
  /** Depth-first, for pickers and palettes. */
  flat: TagTreeNode[];
  byId: ReadonlyMap<string, TagTreeNode>;
  isPending: boolean;
  error: Error | null;
}

/** One memoised view of the tag tree, shared by every tag-aware component. */
export function useTagIndex(): TagIndex {
  const tags = useTags();
  return useMemo(() => {
    const all = tags.data ?? [];
    const tree = buildTagTree(all);
    const flat = flattenTagTree(tree);
    return {
      all,
      tree,
      flat,
      byId: new Map(flat.map((n) => [n.tag.id, n])),
      isPending: tags.isPending,
      error: tags.error,
    };
  }, [tags.data, tags.isPending, tags.error]);
}

/** Orders tag ids the way the tree does (depth-first), unknown ids dropped. */
export function sortTagIds(ids: readonly string[], index: TagIndex): TagTreeNode[] {
  const order = new Map(index.flat.map((n, i) => [n.tag.id, i]));
  return ids
    .map((id) => index.byId.get(id))
    .filter((n): n is TagTreeNode => n !== undefined)
    .sort((a, b) => (order.get(a.tag.id) ?? 0) - (order.get(b.tag.id) ?? 0));
}
