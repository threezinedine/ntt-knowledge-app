import { buildTagTree, flattenTagTree, type Tag, type TagTreeNode } from '@km/core';
import { useMemo } from 'react';
import { useTags } from '../../api/queries';
import { DEFAULT_TAG_COLOR, resolveTagColors } from './colors';

export interface TagIndex {
  all: Tag[];
  tree: TagTreeNode[];
  /** Depth-first, for pickers and palettes. */
  flat: TagTreeNode[];
  byId: ReadonlyMap<string, TagTreeNode>;
  /** Tag id → its colour: a root's own, a shade of it below (null = uncoloured). */
  colors: ReadonlyMap<string, string | null>;
  isPending: boolean;
  error: Error | null;
}

const colorCache = new WeakMap<readonly Tag[], Map<string, string | null>>();

/** Resolved once per tag list (the query's data), however many components ask. */
function colorsOf(all: readonly Tag[]): Map<string, string | null> {
  let colors = colorCache.get(all);
  if (!colors) {
    colors = resolveTagColors(all);
    colorCache.set(all, colors);
  }
  return colors;
}

/** One tag's dot colour, without building the whole index (for chips). */
export function useTagColor(tagId: string): string {
  const tags = useTags();
  return colorsOf(tags.data ?? []).get(tagId) ?? DEFAULT_TAG_COLOR;
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
      colors: colorsOf(all),
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

/** The dot colour to show for a tag (grey when it has none). */
export function tagColor(index: TagIndex, tagId: string): string {
  return index.colors.get(tagId) ?? DEFAULT_TAG_COLOR;
}
