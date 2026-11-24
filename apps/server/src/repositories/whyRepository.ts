import {
  flattenWhys,
  whyItemSchema,
  type CreateWhySessionData,
  type UpdateWhySessionData,
  type WhyItem,
  type WhyItemData,
  type WhySession,
} from '@km/core';
import { z } from 'zod';
import { transaction } from '../db/database.js';
import { NotFoundError } from '../errors.js';
import { nextTimestamp, sameJson, type RepoContext } from './context.js';
import type { NodeRepository } from './nodeRepository.js';

interface WhySessionRow {
  id: string;
  node_id: string;
  summary: string;
  conclusion: string;
  whys: string;
  created_at: number;
  updated_at: number;
}

const storedWhysSchema = z.array(whyItemSchema);

const toSession = (row: WhySessionRow): WhySession => ({
  id: row.id,
  nodeId: row.node_id,
  summary: row.summary,
  conclusion: row.conclusion,
  whys: storedWhysSchema.parse(JSON.parse(row.whys)),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const COLUMNS = 'id, node_id, summary, conclusion, whys, created_at, updated_at';

export type WhyRepository = ReturnType<typeof createWhyRepository>;

export function createWhyRepository(
  { db, now, newId }: RepoContext,
  nodes: Pick<NodeRepository, 'exists'>,
) {
  // A session of a deleted node is gone too, even if its own tombstone is missing.
  const selectById = db.prepare(
    `SELECT ${COLUMNS.split(', ')
      .map((c) => `w.${c}`)
      .join(', ')}
       FROM why_sessions w JOIN nodes n ON n.id = w.node_id AND n.deleted_at IS NULL
      WHERE w.id = ? AND w.deleted_at IS NULL`,
  );
  const selectForNode = db.prepare(
    `SELECT ${COLUMNS} FROM why_sessions
      WHERE node_id = ? AND deleted_at IS NULL
      ORDER BY created_at DESC, id DESC`,
  );
  const selectAll = db.prepare(
    `SELECT ${COLUMNS.split(', ')
      .map((c) => `w.${c}`)
      .join(', ')}
       FROM why_sessions w JOIN nodes n ON n.id = w.node_id AND n.deleted_at IS NULL
      WHERE w.deleted_at IS NULL
      ORDER BY w.created_at, w.id`,
  );
  const insert = db.prepare(
    `INSERT INTO why_sessions (${COLUMNS})
     VALUES (:id, :node_id, :summary, :conclusion, :whys, :created_at, :updated_at)`,
  );
  const updateRow = db.prepare(
    `UPDATE why_sessions
        SET summary = :summary, conclusion = :conclusion, whys = :whys, updated_at = :updated_at
      WHERE id = :id AND deleted_at IS NULL`,
  );
  const softDelete = db.prepare(
    `UPDATE why_sessions SET deleted_at = :ts, updated_at = MAX(updated_at + 1, :ts)
      WHERE id = :id AND deleted_at IS NULL`,
  );

  /**
   * Ids for every why. A sent id is kept only if it is in `keep` (the
   * session's own whys, on edit); anything else, e.g. ids pasted in from
   * another session's JSON or minted by the client, gets a fresh one, so a
   * why id never belongs to two sessions.
   */
  const withIds = (items: readonly WhyItemData[], keep: ReadonlySet<string>): WhyItem[] =>
    items.map((w) => ({
      id: w.id !== undefined && keep.has(w.id) ? w.id : newId(),
      question: w.question,
      answer: w.answer,
      takeaway: w.takeaway,
      children: withIds(w.children, keep),
    }));

  function get(id: string): WhySession | undefined {
    const row = selectById.get(id) as WhySessionRow | undefined;
    return row && toSession(row);
  }

  return {
    get,

    /** Every live session of a live node, oldest first (export). */
    all(): WhySession[] {
      return (selectAll.all() as unknown as WhySessionRow[]).map(toSession);
    },

    /** Newest first. */
    forNode(nodeId: string): WhySession[] {
      if (!nodes.exists(nodeId)) throw new NotFoundError('Node', nodeId);
      return (selectForNode.all(nodeId) as unknown as WhySessionRow[]).map(toSession);
    },

    create(nodeId: string, data: CreateWhySessionData): WhySession {
      return transaction(db, () => {
        if (!nodes.exists(nodeId)) throw new NotFoundError('Node', nodeId);
        const ts = now();
        // Always fresh ids: a pasted export of another session must not share them.
        const session: WhySession = {
          id: newId(),
          nodeId,
          summary: data.summary,
          conclusion: data.conclusion,
          whys: withIds(data.whys, new Set()),
          createdAt: ts,
          updatedAt: ts,
        };
        insert.run({
          id: session.id,
          node_id: nodeId,
          summary: session.summary,
          conclusion: session.conclusion,
          whys: JSON.stringify(session.whys),
          created_at: ts,
          updated_at: ts,
        });
        return session;
      });
    },

    update(id: string, patch: UpdateWhySessionData): WhySession {
      return transaction(db, () => {
        const existing = get(id);
        if (!existing) throw new NotFoundError('WhySession', id);
        const next: WhySession = {
          ...existing,
          summary: patch.summary ?? existing.summary,
          conclusion: patch.conclusion ?? existing.conclusion,
          whys: patch.whys
            ? withIds(patch.whys, new Set(flattenWhys(existing.whys).map((w) => w.id)))
            : existing.whys,
        };
        if (
          next.summary === existing.summary &&
          next.conclusion === existing.conclusion &&
          sameJson(next.whys, existing.whys)
        ) {
          return existing;
        }
        next.updatedAt = nextTimestamp(now, existing.updatedAt);
        updateRow.run({
          id,
          summary: next.summary,
          conclusion: next.conclusion,
          whys: JSON.stringify(next.whys),
          updated_at: next.updatedAt,
        });
        return next;
      });
    },

    remove(id: string): void {
      if (!get(id)) throw new NotFoundError('WhySession', id);
      softDelete.run({ id, ts: now() });
    },
  };
}
