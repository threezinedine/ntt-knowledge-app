import { wouldCreateTagCycle, type CreateTagData, type Tag, type UpdateTagInput } from '@km/core';
import { transaction } from '../database.js';
import { ConflictError, DomainValidationError, NotFoundError } from '../errors.js';
import { isUniqueViolation, nextTimestamp, type RepoContext } from './context.js';

interface TagRow {
  id: string;
  name: string;
  parent_id: string | null;
  color: string | null;
  created_at: number;
  updated_at: number;
}

const toTag = (row: TagRow): Tag => ({
  id: row.id,
  name: row.name,
  parentId: row.parent_id,
  color: row.color,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const COLUMNS = 'id, name, parent_id, color, created_at, updated_at';

export type TagRepository = ReturnType<typeof createTagRepository>;

/**
 * @param onRemove called inside the delete transaction so links to the tag
 *   can be tombstoned with the same timestamp.
 */
export function createTagRepository(
  { db, now, newId }: RepoContext,
  onRemove: (tagId: string, ts: number) => void,
) {
  const selectById = db.prepare(`SELECT ${COLUMNS} FROM tags WHERE id = ? AND deleted_at IS NULL`);
  const selectAll = db.prepare(
    `SELECT ${COLUMNS} FROM tags WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE`,
  );
  const countChildren = db.prepare(
    'SELECT COUNT(*) AS n FROM tags WHERE parent_id = ? AND deleted_at IS NULL',
  );
  const insert = db.prepare(
    `INSERT INTO tags (${COLUMNS}) VALUES (:id, :name, :parent_id, :color, :created_at, :updated_at)`,
  );
  const updateRow = db.prepare(
    `UPDATE tags SET name = :name, parent_id = :parent_id, color = :color, updated_at = :updated_at
      WHERE id = :id AND deleted_at IS NULL`,
  );
  const softDelete = db.prepare(
    'UPDATE tags SET deleted_at = :ts, updated_at = :ts WHERE id = :id',
  );

  function get(id: string): Tag | undefined {
    const row = selectById.get(id) as TagRow | undefined;
    return row && toTag(row);
  }

  function all(): Tag[] {
    return (selectAll.all() as unknown as TagRow[]).map(toTag);
  }

  function write(statement: typeof insert, params: Record<string, string | number | null>) {
    try {
      statement.run(params);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError(
          'TAG_NAME_TAKEN',
          `A sibling tag named "${String(params.name)}" already exists`,
        );
      }
      throw error;
    }
  }

  function assertParentExists(parentId: string | null): void {
    if (parentId !== null && !get(parentId)) throw new NotFoundError('Tag', parentId);
  }

  return {
    get,
    all,

    exists(id: string): boolean {
      return get(id) !== undefined;
    },

    create(data: CreateTagData): Tag {
      return transaction(db, () => {
        assertParentExists(data.parentId);
        const ts = now();
        const tag: Tag = { id: newId(), ...data, createdAt: ts, updatedAt: ts };
        write(insert, {
          id: tag.id,
          name: tag.name,
          parent_id: tag.parentId,
          color: tag.color,
          created_at: ts,
          updated_at: ts,
        });
        return tag;
      });
    },

    update(id: string, patch: UpdateTagInput): Tag {
      return transaction(db, () => {
        const existing = get(id);
        if (!existing) throw new NotFoundError('Tag', id);

        const parentId = patch.parentId === undefined ? existing.parentId : patch.parentId;
        if (parentId !== existing.parentId) {
          assertParentExists(parentId);
          if (wouldCreateTagCycle(all(), id, parentId)) {
            throw new DomainValidationError(
              'TAG_CYCLE',
              'A tag cannot be moved under itself or its descendants',
            );
          }
        }

        const next: Tag = {
          ...existing,
          name: patch.name ?? existing.name,
          color: patch.color === undefined ? existing.color : patch.color,
          parentId,
          updatedAt: nextTimestamp(now, existing.updatedAt),
        };
        if (
          next.name === existing.name &&
          next.color === existing.color &&
          next.parentId === existing.parentId
        ) {
          return existing;
        }
        write(updateRow, {
          id,
          name: next.name,
          parent_id: next.parentId,
          color: next.color,
          updated_at: next.updatedAt,
        });
        return next;
      });
    },

    /**
     * Refuses to delete a tag that still has children (explicit is better than
     * a surprise cascade). Its links to nodes are tombstoned.
     */
    remove(id: string): void {
      transaction(db, () => {
        if (!get(id)) throw new NotFoundError('Tag', id);
        const { n } = countChildren.get(id) as { n: number };
        if (n > 0)
          throw new ConflictError('TAG_HAS_CHILDREN', 'Delete or move the child tags first');
        const ts = now();
        softDelete.run({ id, ts });
        onRemove(id, ts);
      });
    },
  };
}
