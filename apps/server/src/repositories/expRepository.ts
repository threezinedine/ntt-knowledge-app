import type { ExpNode, ExpTag } from '@km/core';
import { parseTagIds, tagIdsSubquery } from './tagLinkRepository.js';
import type { RepoContext } from './context.js';

export type ExpRepository = ReturnType<typeof createExpRepository>;

/** What EXP is computed from: live tags and live nodes with their tags. */
export function createExpRepository({ db }: RepoContext) {
  const selectTags = db.prepare(
    'SELECT id, parent_id FROM tags WHERE deleted_at IS NULL ORDER BY id',
  );
  const selectNodes = db.prepare(
    `SELECT n.content, ${tagIdsSubquery('nodes', 'n.id')} AS tag_ids
       FROM nodes n WHERE n.deleted_at IS NULL`,
  );

  return {
    inputs(): { tags: ExpTag[]; nodes: ExpNode[] } {
      const tags = (selectTags.all() as { id: string; parent_id: string | null }[]).map((r) => ({
        id: r.id,
        parentId: r.parent_id,
      }));
      const nodes = (selectNodes.all() as { content: string; tag_ids: unknown }[]).map((r) => ({
        content: r.content,
        tagIds: parseTagIds(r.tag_ids),
      }));
      return { tags, nodes };
    },
  };
}
