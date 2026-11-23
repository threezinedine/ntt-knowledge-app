import { MAX_TAGS_PER_ITEM, type TaggableKind } from '@km/core';
import { transaction, type Database } from '../db/database.js';
import { DomainValidationError, NotFoundError } from '../errors.js';
import { nextTimestamp, type RepoContext } from './context.js';

/** Table and owner column per taggable kind. Static strings only, never user input. */
const LINK_TABLES = {
  nodes: { table: 'node_tags', owner: 'node_id' },
  tasks: { table: 'task_tags', owner: 'task_id' },
} as const satisfies Record<TaggableKind, { table: string; owner: string }>;

/**
 * Live links whose tag is also live. Both sides are filtered: a link must
 * never surface a deleted tag, even if some writer forgot to tombstone it.
 */
function liveLinks(table: string): string {
  return `${table} l JOIN tags g ON g.id = l.tag_id AND g.deleted_at IS NULL`;
}

/** SQL expression yielding a JSON array of live tag ids for `ownerExpr`. */
export function tagIdsSubquery(kind: TaggableKind, ownerExpr: string): string {
  const { table, owner } = LINK_TABLES[kind];
  return `(SELECT json_group_array(l.tag_id) FROM ${liveLinks(table)}
            WHERE l.${owner} = ${ownerExpr} AND l.deleted_at IS NULL)`;
}

/** Parses the subquery's JSON array; sorted so output is deterministic. */
export function parseTagIds(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  const value: unknown = JSON.parse(raw);
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').sort() : [];
}

function prepareFor(db: Database, kind: TaggableKind) {
  const { table, owner } = LINK_TABLES[kind];
  return {
    select: db.prepare(
      `SELECT updated_at, deleted_at FROM ${table} WHERE ${owner} = :owner AND tag_id = :tag`,
    ),
    countLive: db.prepare(
      `SELECT COUNT(*) AS n FROM ${liveLinks(table)} WHERE l.${owner} = ? AND l.deleted_at IS NULL`,
    ),
    upsert: db.prepare(
      `INSERT INTO ${table} (${owner}, tag_id, created_at, updated_at) VALUES (:owner, :tag, :ts, :ts)
       ON CONFLICT (${owner}, tag_id) DO UPDATE SET deleted_at = NULL, updated_at = :ts`,
    ),
    detach: db.prepare(
      `UPDATE ${table} SET deleted_at = :ts, updated_at = MAX(updated_at + 1, :ts)
        WHERE ${owner} = :owner AND tag_id = :tag AND deleted_at IS NULL`,
    ),
    detachAllForOwner: db.prepare(
      `UPDATE ${table} SET deleted_at = :ts, updated_at = MAX(updated_at + 1, :ts)
        WHERE ${owner} = :owner AND deleted_at IS NULL`,
    ),
    detachAllForTag: db.prepare(
      `UPDATE ${table} SET deleted_at = :ts, updated_at = MAX(updated_at + 1, :ts)
        WHERE tag_id = :tag AND deleted_at IS NULL`,
    ),
  };
}

export type TagLinkRepository = ReturnType<typeof createTagLinkRepository>;

/**
 * Many-to-many links between tags and nodes/tasks. One row per pair:
 * detaching tombstones it, re-attaching revives it, each with its own
 * `updated_at` so links can sync independently of the entities.
 * Callers check that the owner exists; this checks the tag.
 */
export function createTagLinkRepository(
  { db, now }: RepoContext,
  tagExists: (id: string) => boolean,
) {
  const statements: Record<TaggableKind, ReturnType<typeof prepareFor>> = {
    nodes: prepareFor(db, 'nodes'),
    tasks: prepareFor(db, 'tasks'),
  };
  const detachTasksOfNode = db.prepare(
    `UPDATE task_tags SET deleted_at = :ts, updated_at = MAX(updated_at + 1, :ts)
      WHERE deleted_at IS NULL
        AND task_id IN (SELECT id FROM tasks WHERE node_id = :node AND deleted_at IS NULL)`,
  );

  function attach(kind: TaggableKind, ownerId: string, tagId: string): void {
    transaction(db, () => {
      if (!tagExists(tagId)) throw new NotFoundError('Tag', tagId);
      const s = statements[kind];
      const existing = s.select.get({ owner: ownerId, tag: tagId }) as
        { updated_at: number; deleted_at: number | null } | undefined;
      if (existing && existing.deleted_at === null) return; // already attached: no-op
      const { n } = s.countLive.get(ownerId) as { n: number };
      if (n >= MAX_TAGS_PER_ITEM) {
        throw new DomainValidationError(
          'TAG_LIMIT_REACHED',
          `At most ${MAX_TAGS_PER_ITEM} tags per item`,
        );
      }
      const ts = existing ? nextTimestamp(now, existing.updated_at) : now();
      s.upsert.run({ owner: ownerId, tag: tagId, ts });
    });
  }

  return {
    attach,

    /** Attaches several tags (used on create); duplicates are ignored. */
    attachAll(kind: TaggableKind, ownerId: string, tagIds: readonly string[]): void {
      transaction(db, () => {
        for (const tagId of new Set(tagIds)) attach(kind, ownerId, tagId);
      });
    },

    /** Idempotent: detaching a tag that isn't attached is fine. */
    detach(kind: TaggableKind, ownerId: string, tagId: string): void {
      statements[kind].detach.run({ owner: ownerId, tag: tagId, ts: now() });
    },

    detachAllForOwner(kind: TaggableKind, ownerId: string, ts: number): void {
      statements[kind].detachAllForOwner.run({ owner: ownerId, ts });
    },

    /** Cascade helper for node deletion: unlinks tags from the node's live tasks. */
    detachAllForTasksOfNode(nodeId: string, ts: number): void {
      detachTasksOfNode.run({ node: nodeId, ts });
    },

    detachAllForTag(tagId: string, ts: number): void {
      for (const s of Object.values(statements)) s.detachAllForTag.run({ tag: tagId, ts });
    },
  };
}
