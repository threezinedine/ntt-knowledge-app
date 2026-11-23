import {
  wouldCreateCategoryCycle,
  type Category,
  type CreateCategoryData,
  type UpdateCategoryInput,
} from '@km/core';
import { transaction } from '../db/database.js';
import { ConflictError, DomainValidationError, NotFoundError } from '../errors.js';
import { isUniqueViolation, nextTimestamp, type RepoContext } from './context.js';

interface CategoryRow {
  id: string;
  name: string;
  parent_id: string | null;
  color: string | null;
  created_at: number;
  updated_at: number;
}

const toCategory = (row: CategoryRow): Category => ({
  id: row.id,
  name: row.name,
  parentId: row.parent_id,
  color: row.color,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const COLUMNS = 'id, name, parent_id, color, created_at, updated_at';

export type CategoryRepository = ReturnType<typeof createCategoryRepository>;

export function createCategoryRepository({ db, now, newId }: RepoContext) {
  const selectById = db.prepare(
    `SELECT ${COLUMNS} FROM task_categories WHERE id = ? AND deleted_at IS NULL`,
  );
  const selectAll = db.prepare(
    `SELECT ${COLUMNS} FROM task_categories WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE`,
  );
  const countChildren = db.prepare(
    'SELECT COUNT(*) AS n FROM task_categories WHERE parent_id = ? AND deleted_at IS NULL',
  );
  const insert = db.prepare(
    `INSERT INTO task_categories (${COLUMNS})
     VALUES (:id, :name, :parent_id, :color, :created_at, :updated_at)`,
  );
  const updateRow = db.prepare(
    `UPDATE task_categories
        SET name = :name, parent_id = :parent_id, color = :color, updated_at = :updated_at
      WHERE id = :id AND deleted_at IS NULL`,
  );
  const softDelete = db.prepare(
    'UPDATE task_categories SET deleted_at = :ts, updated_at = :ts WHERE id = :id',
  );
  const detachTasks = db.prepare(
    `UPDATE tasks SET category_id = NULL, updated_at = :ts
      WHERE category_id = :id AND deleted_at IS NULL`,
  );

  function get(id: string): Category | undefined {
    const row = selectById.get(id) as CategoryRow | undefined;
    return row && toCategory(row);
  }

  function all(): Category[] {
    return (selectAll.all() as unknown as CategoryRow[]).map(toCategory);
  }

  function insertOrUpdate(
    statement: typeof insert,
    params: Record<string, string | number | null>,
  ) {
    try {
      statement.run(params);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError(`A sibling category named "${String(params.name)}" already exists`);
      }
      throw error;
    }
  }

  function assertParentExists(parentId: string | null): void {
    if (parentId !== null && !get(parentId)) throw new NotFoundError('Category', parentId);
  }

  return {
    get,
    all,

    exists(id: string): boolean {
      return get(id) !== undefined;
    },

    create(data: CreateCategoryData): Category {
      return transaction(db, () => {
        assertParentExists(data.parentId);
        const ts = now();
        const category: Category = { id: newId(), ...data, createdAt: ts, updatedAt: ts };
        insertOrUpdate(insert, {
          id: category.id,
          name: category.name,
          parent_id: category.parentId,
          color: category.color,
          created_at: ts,
          updated_at: ts,
        });
        return category;
      });
    },

    update(id: string, patch: UpdateCategoryInput): Category {
      return transaction(db, () => {
        const existing = get(id);
        if (!existing) throw new NotFoundError('Category', id);

        const parentId = patch.parentId === undefined ? existing.parentId : patch.parentId;
        if (parentId !== existing.parentId) {
          assertParentExists(parentId);
          if (wouldCreateCategoryCycle(all(), id, parentId)) {
            throw new DomainValidationError(
              'A category cannot be moved under itself or its descendants',
            );
          }
        }

        const next: Category = {
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
        insertOrUpdate(updateRow, {
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
     * Refuses to delete a category that still has sub-categories (explicit is
     * better than a surprise cascade). Tasks in it become uncategorised.
     */
    remove(id: string): void {
      transaction(db, () => {
        if (!get(id)) throw new NotFoundError('Category', id);
        const { n } = countChildren.get(id) as { n: number };
        if (n > 0) throw new ConflictError('Delete or move the sub-categories first');
        const ts = now();
        softDelete.run({ id, ts });
        detachTasks.run({ id, ts });
      });
    },
  };
}
