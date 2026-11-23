import type { Category } from './schemas/task.js';

export interface CategoryTreeNode {
  category: Category;
  /** Names from the root down to (and including) this category. */
  path: string[];
  depth: number;
  children: CategoryTreeNode[];
}

/**
 * Builds a forest from a flat category list. Categories whose parent is missing
 * (e.g. deleted) are promoted to roots so nothing silently disappears.
 * Siblings are sorted by name.
 */
export function buildCategoryTree(categories: readonly Category[]): CategoryTreeNode[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const childrenOf = new Map<string | null, Category[]>();
  for (const c of categories) {
    const parentKey = c.parentId !== null && byId.has(c.parentId) ? c.parentId : null;
    const siblings = childrenOf.get(parentKey) ?? [];
    siblings.push(c);
    childrenOf.set(parentKey, siblings);
  }

  const visited = new Set<string>();
  const build = (parentKey: string | null, parentPath: string[]): CategoryTreeNode[] =>
    (childrenOf.get(parentKey) ?? [])
      .filter((c) => !visited.has(c.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((category) => {
        visited.add(category.id);
        const path = [...parentPath, category.name];
        return {
          category,
          path,
          depth: parentPath.length,
          children: build(category.id, path),
        };
      });

  return build(null, []);
}

/** Depth-first flattening, handy for `<select>` options and indented lists. */
export function flattenCategoryTree(tree: readonly CategoryTreeNode[]): CategoryTreeNode[] {
  return tree.flatMap((node) => [node, ...flattenCategoryTree(node.children)]);
}

/**
 * True if re-parenting `categoryId` under `newParentId` would create a cycle
 * (including parenting a category to itself).
 */
export function wouldCreateCategoryCycle(
  categories: readonly Pick<Category, 'id' | 'parentId'>[],
  categoryId: string,
  newParentId: string | null,
): boolean {
  const parentOf = new Map(categories.map((c) => [c.id, c.parentId]));
  let cursor = newParentId;
  const seen = new Set<string>();
  while (cursor !== null) {
    if (cursor === categoryId) return true;
    if (seen.has(cursor)) return true; // pre-existing corruption: refuse rather than loop
    seen.add(cursor);
    cursor = parentOf.get(cursor) ?? null;
  }
  return false;
}
