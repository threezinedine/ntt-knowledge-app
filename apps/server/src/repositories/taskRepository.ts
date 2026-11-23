import type { CreateTaskData, Task, TaskStatus, UpdateTaskInput } from '@km/core';
import { transaction } from '../db/database.js';
import { NotFoundError } from '../errors.js';
import type { CategoryRepository } from './categoryRepository.js';
import { nextTimestamp, type RepoContext } from './context.js';
import type { NodeRepository } from './nodeRepository.js';

interface TaskRow {
  id: string;
  node_id: string;
  category_id: string | null;
  title: string;
  status: TaskStatus;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
}

const toTask = (row: TaskRow): Task => ({
  id: row.id,
  nodeId: row.node_id,
  categoryId: row.category_id,
  title: row.title,
  status: row.status,
  completedAt: row.completed_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const COLUMNS = 'id, node_id, category_id, title, status, completed_at, created_at, updated_at';

/** `completedAt` is stamped on entering `done` and cleared on leaving it. */
function nextCompletedAt(prev: Task | undefined, status: TaskStatus, ts: number): number | null {
  if (status !== 'done') return null;
  return prev?.status === 'done' ? prev.completedAt : ts;
}

export type TaskRepository = ReturnType<typeof createTaskRepository>;

export function createTaskRepository(
  { db, now, newId }: RepoContext,
  nodes: Pick<NodeRepository, 'exists'>,
  categories: Pick<CategoryRepository, 'exists'>,
) {
  const selectById = db.prepare(`SELECT ${COLUMNS} FROM tasks WHERE id = ? AND deleted_at IS NULL`);
  const selectForNode = db.prepare(
    `SELECT ${COLUMNS} FROM tasks WHERE node_id = ? AND deleted_at IS NULL ORDER BY created_at, id`,
  );
  const insert = db.prepare(
    `INSERT INTO tasks (${COLUMNS})
     VALUES (:id, :node_id, :category_id, :title, :status, :completed_at, :created_at, :updated_at)`,
  );
  const updateRow = db.prepare(
    `UPDATE tasks
        SET category_id = :category_id, title = :title, status = :status,
            completed_at = :completed_at, updated_at = :updated_at
      WHERE id = :id AND deleted_at IS NULL`,
  );
  const softDelete = db.prepare(
    'UPDATE tasks SET deleted_at = :ts, updated_at = :ts WHERE id = :id AND deleted_at IS NULL',
  );

  function get(id: string): Task | undefined {
    const row = selectById.get(id) as TaskRow | undefined;
    return row && toTask(row);
  }

  function assertCategory(categoryId: string | null): void {
    if (categoryId !== null && !categories.exists(categoryId)) {
      throw new NotFoundError('Category', categoryId);
    }
  }

  return {
    get,

    forNode(nodeId: string): Task[] {
      return (selectForNode.all(nodeId) as unknown as TaskRow[]).map(toTask);
    },

    create(data: CreateTaskData): Task {
      return transaction(db, () => {
        if (!nodes.exists(data.nodeId)) throw new NotFoundError('Node', data.nodeId);
        assertCategory(data.categoryId);
        const ts = now();
        const task: Task = {
          id: newId(),
          ...data,
          completedAt: nextCompletedAt(undefined, data.status, ts),
          createdAt: ts,
          updatedAt: ts,
        };
        insert.run({
          id: task.id,
          node_id: task.nodeId,
          category_id: task.categoryId,
          title: task.title,
          status: task.status,
          completed_at: task.completedAt,
          created_at: ts,
          updated_at: ts,
        });
        return task;
      });
    },

    update(id: string, patch: UpdateTaskInput): Task {
      return transaction(db, () => {
        const existing = get(id);
        if (!existing) throw new NotFoundError('Task', id);
        const categoryId = patch.categoryId === undefined ? existing.categoryId : patch.categoryId;
        if (categoryId !== existing.categoryId) assertCategory(categoryId);

        const status = patch.status ?? existing.status;
        const title = patch.title ?? existing.title;
        if (
          categoryId === existing.categoryId &&
          title === existing.title &&
          status === existing.status
        ) {
          return existing;
        }
        const ts = nextTimestamp(now, existing.updatedAt);
        const next: Task = {
          ...existing,
          categoryId,
          title,
          status,
          completedAt: nextCompletedAt(existing, status, ts),
          updatedAt: ts,
        };
        updateRow.run({
          id,
          category_id: next.categoryId,
          title: next.title,
          status: next.status,
          completed_at: next.completedAt,
          updated_at: ts,
        });
        return next;
      });
    },

    remove(id: string): void {
      const { changes } = softDelete.run({ id, ts: now() });
      if (changes === 0) throw new NotFoundError('Task', id);
    },
  };
}
