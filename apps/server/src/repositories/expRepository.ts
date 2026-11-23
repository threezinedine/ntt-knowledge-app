import { countWords, type ExpNode, type ExpTag } from '@km/core';
import { transaction } from '../db/database.js';
import type { RepoContext } from './context.js';
import { parseTagIds, tagIdsSubquery } from './tagLinkRepository.js';

export type ExpRepository = ReturnType<typeof createExpRepository>;

/**
 * What EXP is computed from: live tags and live nodes' word counts and tags.
 * Reads the cached `content_words`, never the content itself.
 */
export function createExpRepository({ db }: RepoContext) {
  backfillContentWords(db);
  const selectTags = db.prepare(
    'SELECT id, parent_id FROM tags WHERE deleted_at IS NULL ORDER BY id',
  );
  const selectNodes = db.prepare(
    `SELECT COALESCE(n.content_words, 0) AS words, ${tagIdsSubquery('nodes', 'n.id')} AS tag_ids
       FROM nodes n WHERE n.deleted_at IS NULL`,
  );

  return {
    inputs(): { tags: ExpTag[]; nodes: ExpNode[] } {
      const tags = (selectTags.all() as { id: string; parent_id: string | null }[]).map((r) => ({
        id: r.id,
        parentId: r.parent_id,
      }));
      const nodes = (selectNodes.all() as { words: number; tag_ids: unknown }[]).map((r) => ({
        words: r.words,
        tagIds: parseTagIds(r.tag_ids),
      }));
      return { tags, nodes };
    },
  };
}

/**
 * Counts words for rows that have none yet (added by migration 5; SQLite has
 * no Unicode word splitting, so it happens here). Derived data: updated_at is
 * left alone. A no-op once every row is counted.
 */
export function backfillContentWords(db: RepoContext['db']): number {
  const pending = db.prepare('SELECT id, content FROM nodes WHERE content_words IS NULL').all() as {
    id: string;
    content: string;
  }[];
  if (pending.length === 0) return 0;
  const set = db.prepare('UPDATE nodes SET content_words = ? WHERE id = ?');
  transaction(db, () => {
    for (const row of pending) set.run(countWords(row.content), row.id);
  });
  return pending.length;
}
