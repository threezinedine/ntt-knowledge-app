import type {
  CreateEdgeData,
  Edge,
  EdgeWithNeighbor,
  NodeEdges,
  Props,
  UpdateEdgeInput,
} from '@km/core';
import { transaction } from '../db/database.js';
import { ConflictError, NotFoundError } from '../errors.js';
import {
  isUniqueViolation,
  nextTimestamp,
  parseJsonObject,
  sameJson,
  type RepoContext,
} from './context.js';
import type { NodeRepository } from './nodeRepository.js';

interface EdgeRow {
  id: string;
  from_id: string;
  to_id: string;
  name: string;
  props: string;
  created_at: number;
  updated_at: number;
}

interface EdgeNeighborRow extends EdgeRow {
  n_id: string;
  n_type: string;
  n_title: string;
  n_pos_x: number | null;
  n_pos_y: number | null;
}

const toEdge = (row: EdgeRow): Edge => ({
  id: row.id,
  fromId: row.from_id,
  toId: row.to_id,
  name: row.name,
  props: parseJsonObject(row.props) as Props,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const toEdgeWithNeighbor = (row: EdgeNeighborRow): EdgeWithNeighbor => ({
  edge: toEdge(row),
  neighbor: {
    id: row.n_id,
    type: row.n_type,
    title: row.n_title,
    position:
      row.n_pos_x === null || row.n_pos_y === null ? null : { x: row.n_pos_x, y: row.n_pos_y },
  },
});

const EDGE_COLUMNS = 'id, from_id, to_id, name, props, created_at, updated_at';
const E_COLUMNS = EDGE_COLUMNS.split(', ')
  .map((c) => `e.${c}`)
  .join(', ');
const NEIGHBOR_COLUMNS =
  'n.id AS n_id, n.type AS n_type, n.title AS n_title, l.pos_x AS n_pos_x, l.pos_y AS n_pos_y';

export type EdgeRepository = ReturnType<typeof createEdgeRepository>;

export function createEdgeRepository(
  { db, now, newId }: RepoContext,
  nodes: Pick<NodeRepository, 'exists'>,
) {
  const selectById = db.prepare(
    `SELECT ${EDGE_COLUMNS} FROM edges WHERE id = ? AND deleted_at IS NULL`,
  );
  const selectAll = db.prepare(
    `SELECT ${EDGE_COLUMNS} FROM edges WHERE deleted_at IS NULL ORDER BY id`,
  );
  const selectOutgoing = db.prepare(
    `SELECT ${E_COLUMNS}, ${NEIGHBOR_COLUMNS}
       FROM edges e JOIN nodes n ON n.id = e.to_id AND n.deleted_at IS NULL
       LEFT JOIN node_layouts l ON l.node_id = n.id
      WHERE e.from_id = ? AND e.deleted_at IS NULL
      ORDER BY e.name, n.title`,
  );
  const selectIncoming = db.prepare(
    `SELECT ${E_COLUMNS}, ${NEIGHBOR_COLUMNS}
       FROM edges e JOIN nodes n ON n.id = e.from_id AND n.deleted_at IS NULL
       LEFT JOIN node_layouts l ON l.node_id = n.id
      WHERE e.to_id = ? AND e.deleted_at IS NULL
      ORDER BY e.name, n.title`,
  );
  const selectNames = db.prepare(
    'SELECT DISTINCT name FROM edges WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE',
  );
  const insert = db.prepare(
    `INSERT INTO edges (${EDGE_COLUMNS})
     VALUES (:id, :from_id, :to_id, :name, :props, :created_at, :updated_at)`,
  );
  const updateRow = db.prepare(
    `UPDATE edges SET name = :name, props = :props, updated_at = :updated_at
      WHERE id = :id AND deleted_at IS NULL`,
  );
  const softDelete = db.prepare(
    'UPDATE edges SET deleted_at = :ts, updated_at = :ts WHERE id = :id AND deleted_at IS NULL',
  );

  function get(id: string): Edge | undefined {
    const row = selectById.get(id) as EdgeRow | undefined;
    return row && toEdge(row);
  }

  function duplicate(edge: Pick<Edge, 'fromId' | 'toId' | 'name'>): ConflictError {
    return new ConflictError(`Edge "${edge.name}" already exists between these nodes`, edge);
  }

  return {
    get,

    all(): Edge[] {
      return (selectAll.all() as unknown as EdgeRow[]).map(toEdge);
    },

    forNode(nodeId: string): NodeEdges {
      return {
        outgoing: (selectOutgoing.all(nodeId) as unknown as EdgeNeighborRow[]).map(
          toEdgeWithNeighbor,
        ),
        incoming: (selectIncoming.all(nodeId) as unknown as EdgeNeighborRow[]).map(
          toEdgeWithNeighbor,
        ),
      };
    },

    /** Distinct relation names in use, for autocomplete. */
    relationNames(): string[] {
      return (selectNames.all() as { name: string }[]).map((r) => r.name);
    },

    create(data: CreateEdgeData): Edge {
      return transaction(db, () => {
        for (const id of [data.fromId, data.toId]) {
          if (!nodes.exists(id)) throw new NotFoundError('Node', id);
        }
        const ts = now();
        const edge: Edge = { id: newId(), ...data, createdAt: ts, updatedAt: ts };
        try {
          insert.run({
            id: edge.id,
            from_id: edge.fromId,
            to_id: edge.toId,
            name: edge.name,
            props: JSON.stringify(edge.props),
            created_at: ts,
            updated_at: ts,
          });
        } catch (error) {
          if (isUniqueViolation(error)) throw duplicate(edge);
          throw error;
        }
        return edge;
      });
    },

    update(id: string, patch: UpdateEdgeInput): Edge {
      return transaction(db, () => {
        const existing = get(id);
        if (!existing) throw new NotFoundError('Edge', id);
        const next: Edge = {
          ...existing,
          name: patch.name ?? existing.name,
          props: patch.props ?? existing.props,
          updatedAt: nextTimestamp(now, existing.updatedAt),
        };
        if (next.name === existing.name && sameJson(next.props, existing.props)) return existing;
        try {
          updateRow.run({
            id,
            name: next.name,
            props: JSON.stringify(next.props),
            updated_at: next.updatedAt,
          });
        } catch (error) {
          if (isUniqueViolation(error)) throw duplicate(next);
          throw error;
        }
        return next;
      });
    },

    remove(id: string): void {
      const { changes } = softDelete.run({ id, ts: now() });
      if (changes === 0) throw new NotFoundError('Edge', id);
    },
  };
}
