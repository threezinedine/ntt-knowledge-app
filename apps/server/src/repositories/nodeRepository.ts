import type {
  CreateNodeData,
  GraphNode,
  NodeListQuery,
  NodeSummary,
  Position,
  Props,
  UpdateNodeInput,
} from '@km/core';
import { countWords } from '@km/core';
import { transaction } from '../db/database.js';
import { NotFoundError } from '../errors.js';
import {
  escapeLike,
  nextTimestamp,
  parseJsonObject,
  sameJson,
  type RepoContext,
} from './context.js';
import { parseTagIds, tagIdsSubquery, type TagLinkRepository } from './tagLinkRepository.js';

interface NodeRow {
  id: string;
  type: string;
  title: string;
  content: string;
  props: string;
  pos_x: number | null;
  pos_y: number | null;
  created_at: number;
  updated_at: number;
  tag_ids: string;
}

type SummaryRow = Pick<NodeRow, 'id' | 'type' | 'title' | 'pos_x' | 'pos_y'>;

const toPosition = (row: Pick<NodeRow, 'pos_x' | 'pos_y'>): Position | null =>
  row.pos_x === null || row.pos_y === null ? null : { x: row.pos_x, y: row.pos_y };

const toSummary = (row: SummaryRow): NodeSummary => ({
  id: row.id,
  type: row.type,
  title: row.title,
  position: toPosition(row),
});

const toNode = (row: NodeRow): GraphNode => ({
  ...toSummary(row),
  content: row.content,
  props: parseJsonObject(row.props) as Props,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  tagIds: parseTagIds(row.tag_ids),
});

/** Nodes joined with their (optional) canvas layout and live tag ids. */
const SELECT_NODE = `
  SELECT n.id, n.type, n.title, n.content, n.props, l.pos_x, l.pos_y, n.created_at, n.updated_at,
         ${tagIdsSubquery('nodes', 'n.id')} AS tag_ids
    FROM nodes n LEFT JOIN node_layouts l ON l.node_id = n.id`;

export type NodeRepository = ReturnType<typeof createNodeRepository>;

export function createNodeRepository({ db, now, newId }: RepoContext, links: TagLinkRepository) {
  const selectById = db.prepare(`${SELECT_NODE} WHERE n.id = ? AND n.deleted_at IS NULL`);
  const insert = db.prepare(
    `INSERT INTO nodes (id, type, title, content, content_words, props, created_at, updated_at)
     VALUES (:id, :type, :title, :content, :words, :props, :ts, :ts)`,
  );
  const updateRow = db.prepare(
    `UPDATE nodes
        SET type = :type, title = :title, content = :content, props = :props, updated_at = :updated_at,
            content_words = COALESCE(:words, content_words)
      WHERE id = :id AND deleted_at IS NULL`,
  );
  const selectLayoutTs = db.prepare('SELECT updated_at FROM node_layouts WHERE node_id = ?');
  const upsertLayout = db.prepare(
    `INSERT INTO node_layouts (node_id, pos_x, pos_y, updated_at) VALUES (:id, :x, :y, :ts)
     ON CONFLICT (node_id) DO UPDATE SET pos_x = :x, pos_y = :y, updated_at = :ts`,
  );
  const softDeleteNode = db.prepare(
    'UPDATE nodes SET deleted_at = :ts, updated_at = :ts WHERE id = :id AND deleted_at IS NULL',
  );
  const softDeleteEdges = db.prepare(
    `UPDATE edges SET deleted_at = :ts, updated_at = :ts
      WHERE (from_id = :id OR to_id = :id) AND deleted_at IS NULL`,
  );
  const softDeleteWhySessions = db.prepare(
    `UPDATE why_sessions SET deleted_at = :ts, updated_at = MAX(updated_at + 1, :ts)
      WHERE node_id = :id AND deleted_at IS NULL`,
  );
  const selectAllSummaries = db.prepare(
    `SELECT n.id, n.type, n.title, l.pos_x, l.pos_y
       FROM nodes n LEFT JOIN node_layouts l ON l.node_id = n.id
      WHERE n.deleted_at IS NULL ORDER BY n.id`,
  );

  function get(id: string): GraphNode | undefined {
    const row = selectById.get(id) as NodeRow | undefined;
    return row && toNode(row);
  }

  function getOrThrow(id: string): GraphNode {
    const node = get(id);
    if (!node) throw new NotFoundError('Node', id);
    return node;
  }

  function writeLayout(id: string, position: Position | null): void {
    const prev = selectLayoutTs.get(id) as { updated_at: number } | undefined;
    upsertLayout.run({
      id,
      x: position?.x ?? null,
      y: position?.y ?? null,
      ts: prev ? nextTimestamp(now, prev.updated_at) : now(),
    });
  }

  return {
    get,
    getOrThrow,

    exists(id: string): boolean {
      return get(id) !== undefined;
    },

    /** Most recently *edited* first (layout moves don't count); `q` matches titles. */
    list(query: NodeListQuery): GraphNode[] {
      const where = ['n.deleted_at IS NULL'];
      const params: Record<string, string | number> = { limit: query.limit };
      if (query.q) {
        where.push("n.title LIKE :q ESCAPE '\\'");
        params.q = `%${escapeLike(query.q)}%`;
      }
      if (query.type) {
        where.push('n.type = :type');
        params.type = query.type;
      }
      const sql = `${SELECT_NODE} WHERE ${where.join(' AND ')}
                   ORDER BY n.updated_at DESC, n.id DESC LIMIT :limit`;
      return (db.prepare(sql).all(params) as unknown as NodeRow[]).map(toNode);
    },

    summaries(): NodeSummary[] {
      return (selectAllSummaries.all() as unknown as SummaryRow[]).map(toSummary);
    },

    create(data: CreateNodeData): GraphNode {
      return transaction(db, () => {
        const ts = now();
        const id = newId();
        insert.run({
          id,
          type: data.type,
          title: data.title,
          content: data.content,
          words: countWords(data.content),
          props: JSON.stringify(data.props),
          ts,
        });
        if (data.position) writeLayout(id, data.position);
        links.attachAll('nodes', id, data.tagIds);
        return getOrThrow(id);
      });
    },

    /**
     * Applies only real changes: content fields bump the node's `updatedAt`,
     * `position` bumps only the layout row, and a no-op patch writes nothing.
     */
    update(id: string, patch: UpdateNodeInput): GraphNode {
      return transaction(db, () => {
        const existing = getOrThrow(id);
        const content = {
          type: patch.type ?? existing.type,
          title: patch.title ?? existing.title,
          content: patch.content ?? existing.content,
          props: patch.props ?? existing.props,
        };
        const position = patch.position === undefined ? existing.position : patch.position;

        let updatedAt = existing.updatedAt;
        const contentChanged =
          content.type !== existing.type ||
          content.title !== existing.title ||
          content.content !== existing.content ||
          !sameJson(content.props, existing.props);
        if (contentChanged) {
          updatedAt = nextTimestamp(now, existing.updatedAt);
          updateRow.run({
            id,
            ...content,
            props: JSON.stringify(content.props),
            updated_at: updatedAt,
            // Recount only when the text changed (a rename keeps the count).
            words: content.content === existing.content ? null : countWords(content.content),
          });
        }
        if (!sameJson(position, existing.position)) writeLayout(id, position);

        return { ...existing, ...content, position, updatedAt };
      });
    },

    attachTag(id: string, tagId: string): GraphNode {
      return transaction(db, () => {
        getOrThrow(id);
        links.attach('nodes', id, tagId);
        return getOrThrow(id);
      });
    },

    detachTag(id: string, tagId: string): GraphNode {
      return transaction(db, () => {
        getOrThrow(id);
        links.detach('nodes', id, tagId);
        return getOrThrow(id);
      });
    },

    /**
     * Moves several nodes on the canvas in one transaction (a drag and the
     * dots it pushed aside): every node must exist, or nothing moves.
     * Layout rows only, like a single `position` patch.
     */
    movePositions(items: readonly { id: string; position: Position }[]): void {
      transaction(db, () => {
        for (const { id, position } of items) {
          const existing = getOrThrow(id);
          if (!sameJson(position, existing.position)) writeLayout(id, position);
        }
      });
    },

    /**
     * Soft-deletes the node with its edges, tag links and 5 Whys sessions,
     * sharing one tombstone timestamp.
     */
    remove(id: string): void {
      transaction(db, () => {
        const ts = now();
        const { changes } = softDeleteNode.run({ id, ts });
        if (changes === 0) throw new NotFoundError('Node', id);
        softDeleteEdges.run({ id, ts });
        softDeleteWhySessions.run({ id, ts });
        links.detachAllForOwner('nodes', id, ts);
      });
    },
  };
}
