import type {
  CreateNodeData,
  GraphNode,
  NodeListQuery,
  NodeSummary,
  Position,
  Props,
  UpdateNodeInput,
} from '@km/core';
import { transaction } from '../db/database.js';
import { NotFoundError } from '../errors.js';
import {
  escapeLike,
  nextTimestamp,
  parseJsonObject,
  sameJson,
  type RepoContext,
} from './context.js';

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
});

/** Nodes joined with their (optional) canvas layout. */
const SELECT_NODE = `
  SELECT n.id, n.type, n.title, n.content, n.props, l.pos_x, l.pos_y, n.created_at, n.updated_at
    FROM nodes n LEFT JOIN node_layouts l ON l.node_id = n.id`;

export type NodeRepository = ReturnType<typeof createNodeRepository>;

export function createNodeRepository({ db, now, newId }: RepoContext) {
  const selectById = db.prepare(`${SELECT_NODE} WHERE n.id = ? AND n.deleted_at IS NULL`);
  const insert = db.prepare(
    `INSERT INTO nodes (id, type, title, content, props, created_at, updated_at)
     VALUES (:id, :type, :title, :content, :props, :ts, :ts)`,
  );
  const updateRow = db.prepare(
    `UPDATE nodes
        SET type = :type, title = :title, content = :content, props = :props, updated_at = :updated_at
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
  const softDeleteTasks = db.prepare(
    'UPDATE tasks SET deleted_at = :ts, updated_at = :ts WHERE node_id = :id AND deleted_at IS NULL',
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
        const node: GraphNode = { id: newId(), ...data, createdAt: ts, updatedAt: ts };
        insert.run({
          id: node.id,
          type: node.type,
          title: node.title,
          content: node.content,
          props: JSON.stringify(node.props),
          ts,
        });
        if (node.position) writeLayout(node.id, node.position);
        return node;
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
          });
        }
        if (!sameJson(position, existing.position)) writeLayout(id, position);

        return { ...existing, ...content, position, updatedAt };
      });
    },

    /** Soft-deletes the node together with its edges and tasks (one shared tombstone ts). */
    remove(id: string): void {
      transaction(db, () => {
        const ts = now();
        const { changes } = softDeleteNode.run({ id, ts });
        if (changes === 0) throw new NotFoundError('Node', id);
        softDeleteEdges.run({ id, ts });
        softDeleteTasks.run({ id, ts });
      });
    },
  };
}
