import type { Tag } from './schemas/tag.js';

export interface TagTreeNode {
  tag: Tag;
  /** Names from the root down to (and including) this tag. */
  path: string[];
  depth: number;
  children: TagTreeNode[];
}

/**
 * Builds a forest from a flat tag list. Tags whose parent is missing
 * (e.g. deleted) are promoted to roots so nothing silently disappears.
 * Siblings are sorted by name.
 */
export function buildTagTree(tags: readonly Tag[]): TagTreeNode[] {
  const byId = new Map(tags.map((c) => [c.id, c]));
  const childrenOf = new Map<string | null, Tag[]>();
  for (const c of tags) {
    const parentKey = c.parentId !== null && byId.has(c.parentId) ? c.parentId : null;
    const siblings = childrenOf.get(parentKey) ?? [];
    siblings.push(c);
    childrenOf.set(parentKey, siblings);
  }

  const visited = new Set<string>();
  const build = (parentKey: string | null, parentPath: string[]): TagTreeNode[] =>
    (childrenOf.get(parentKey) ?? [])
      .filter((c) => !visited.has(c.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((tag) => {
        visited.add(tag.id);
        const path = [...parentPath, tag.name];
        return {
          tag,
          path,
          depth: parentPath.length,
          children: build(tag.id, path),
        };
      });

  return build(null, []);
}

/** Depth-first flattening, handy for `<select>` options and indented lists. */
export function flattenTagTree(tree: readonly TagTreeNode[]): TagTreeNode[] {
  return tree.flatMap((node) => [node, ...flattenTagTree(node.children)]);
}

/**
 * True if re-parenting `tagId` under `newParentId` would create a cycle
 * (including parenting a tag to itself).
 */
export function wouldCreateTagCycle(
  tags: readonly Pick<Tag, 'id' | 'parentId'>[],
  tagId: string,
  newParentId: string | null,
): boolean {
  const parentOf = new Map(tags.map((c) => [c.id, c.parentId]));
  let cursor = newParentId;
  const seen = new Set<string>();
  while (cursor !== null) {
    if (cursor === tagId) return true;
    if (seen.has(cursor)) return true; // pre-existing corruption: refuse rather than loop
    seen.add(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  return false;
}
