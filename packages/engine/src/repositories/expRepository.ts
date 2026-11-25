import { answeredWhyDepths, countWords, type ExpNode, type ExpTag } from '@km/core';
import { transaction } from '../database.js';
import type { RepoContext } from './context.js';
import { parseTagIds, tagIdsSubquery } from './tagLinkRepository.js';
import { storedWhysSchema } from './whyRepository.js';

export type ExpRepository = ReturnType<typeof createExpRepository>;

/**
 * What EXP is computed from: live tags, live nodes' word counts and tags,
 * and the answered whys of their live 5 Whys sessions.
 * Reads the cached `content_words`, never the content itself. Invariant:
 * every writer of `nodes.content` also sets `content_words` (today only
 * nodeRepository create/update do).
 */
export function createExpRepository({ db }: RepoContext) {
  backfillContentWords(db);
  const selectTags = db.prepare(
    'SELECT id, parent_id FROM tags WHERE deleted_at IS NULL ORDER BY id',
  );
  const selectNodes = db.prepare(
    `SELECT n.id, COALESCE(n.content_words, 0) AS words, ${tagIdsSubquery('nodes', 'n.id')} AS tag_ids
       FROM nodes n WHERE n.deleted_at IS NULL`,
  );
  // Live sessions of live nodes only (a deleted node's sessions earn nothing).
  const selectWhys = db.prepare(
    `SELECT w.node_id, w.whys
       FROM why_sessions w JOIN nodes n ON n.id = w.node_id AND n.deleted_at IS NULL
      WHERE w.deleted_at IS NULL`,
  );

  /** Node id → depth of every answered why in its live sessions. */
  function whyDepthsByNode(): Map<string, number[]> {
    const out = new Map<string, number[]>();
    for (const row of selectWhys.all() as { node_id: string; whys: string }[]) {
      // Validated on write, and the column is CHECK json_valid. A tree that doesn't
      // match the schema (written before a stricter one) earns nothing rather than
      // failing /api/exp; the whys list for that node fails loudly, which is where
      // to look if EXP seems missing.
      const parsed = storedWhysSchema.safeParse(JSON.parse(row.whys));
      if (!parsed.success) continue;
      const depths = out.get(row.node_id) ?? [];
      depths.push(...answeredWhyDepths(parsed.data));
      out.set(row.node_id, depths);
    }
    return out;
  }

  /** Every live node with its id. Both readers below use it, so /exp and /exp/nodes agree. */
  function liveNodes(): (ExpNode & { id: string })[] {
    const whyDepths = whyDepthsByNode();
    return (selectNodes.all() as { id: string; words: number; tag_ids: unknown }[]).map((r) => ({
      id: r.id,
      words: r.words,
      tagIds: parseTagIds(r.tag_ids),
      whyDepths: whyDepths.get(r.id) ?? [],
    }));
  }

  return {
    /** Every live node with its id, for per-node EXP. */
    nodes: liveNodes,
    inputs(): { tags: ExpTag[]; nodes: ExpNode[] } {
      const tags = (selectTags.all() as { id: string; parent_id: string | null }[]).map((r) => ({
        id: r.id,
        parentId: r.parent_id,
      }));
      const nodes = liveNodes().map(({ words, tagIds, whyDepths }) => ({
        words,
        tagIds,
        whyDepths,
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
  // Live rows only: tombstones never count towards EXP.
  const pending = db
    .prepare('SELECT id, content FROM nodes WHERE content_words IS NULL AND deleted_at IS NULL')
    .all() as {
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
