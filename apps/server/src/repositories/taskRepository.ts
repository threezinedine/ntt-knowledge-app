import type { CreateTaskData, Task, TaskStatus, UpdateTaskInput } from '@km/core';
import { transaction } from '../db/database.js';
import { NotFoundError } from '../errors.js';
import { nextTimestamp, type RepoContext } from './context.js';
import type { NodeRepository } from './nodeRepository.js';
import { parseTagIds, tagIdsSubquery, type TagLinkRepository } from './tagLinkRepository.js';

interface TaskRow {
  id: string;
  node_id: string;
  title: string;
  status: TaskStatus;
  completed_at: number | null;
  created_at: number;
  updated_at: number;
  tag_ids: string;
}

const toTask = (row: TaskRow): Task => ({
  id: row.id,
  nodeId: row.node_id,
  title: row.title,
  status: row.status,
  completedAt: row.completed_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  tagIds: parseTagIds(row.tag_ids),
});

const SELECT_TASK = `
  SELECT t.id, t.node_id, t.title, t.status, t.completed_at, t.created_at, t.updated_at,
         ${tagIdsSubquery('tasks', 't.id')} AS tag_ids
    FROM tasks t`;

/** `completedAt` is stamped on entering `done` and cleared on leaving it. */
function nextCompletedAt(prev: Task | undefined, status: TaskStatus, ts: number): number | null {
  if (status !== 'done') return null;
  return prev?.status === 'done' ? prev.completedAt : ts;
}

export type TaskRepository = ReturnType<typeof createTaskRepository>;

export function createTaskRepository(
  { db, now, newId }: RepoContext,
  nodes: Pick<NodeRepository, 'exists'>,
  links: TagLinkRepository,
) {
  const selectById = db.prepare(`${SELECT_TASK} WHERE t.id = ? AND t.deleted_at IS NULL`);
  const selectForNode = db.prepare(
    `${SELECT_TASK} WHERE t.node_id = ? AND t.deleted_at IS NULL ORDER BY t.created_at, t.id`,
  );
  const insert = db.prepare(
    `INSERT INTO tasks (id, node_id, title, status, completed_at, created_at, updated_at)
     VALUES (:id, :node_id, :title, :status, :completed_at, :ts, :ts)`,
  );
  const updateRow = db.prepare(
    `UPDATE tasks SET title = :title, status = :status, completed_at = :completed_at,
                      updated_at = :updated_at
      WHERE id = :id AND deleted_at IS NULL`,
  );
  const softDelete = db.prepare(
    'UPDATE tasks SET deleted_at = :ts, updated_at = :ts WHERE id = :id AND deleted_at IS NULL',
  );

  function get(id: string): Task | undefined {
    const row = selectById.get(id) as TaskRow | undefined;
    return row && toTask(row);
  }

  function getOrThrow(id: string): Task {
    const task = get(id);
    if (!task) throw new NotFoundError('Task', id);
    return task;
  }

  return {
    get,
    getOrThrow,

    forNode(nodeId: string): Task[] {
      return (selectForNode.all(nodeId) as unknown as TaskRow[]).map(toTask);
    },

    create(data: CreateTaskData): Task {
      return transaction(db, () => {
        if (!nodes.exists(data.nodeId)) throw new NotFoundError('Node', data.nodeId);
        const ts = now();
        const id = newId();
        insert.run({
          id,
          node_id: data.nodeId,
          title: data.title,
          status: data.status,
          completed_at: nextCompletedAt(undefined, data.status, ts),
          ts,
        });
        links.attachAll('tasks', id, data.tagIds);
        return getOrThrow(id);
      });
    },

    update(id: string, patch: UpdateTaskInput): Task {
      return transaction(db, () => {
        const existing = getOrThrow(id);
        const status = patch.status ?? existing.status;
        const title = patch.title ?? existing.title;
        if (title === existing.title && status === existing.status) return existing;

        const ts = nextTimestamp(now, existing.updatedAt);
        const next: Task = {
          ...existing,
          title,
          status,
          completedAt: nextCompletedAt(existing, status, ts),
          updatedAt: ts,
        };
        updateRow.run({
          id,
          title: next.title,
          status: next.status,
          completed_at: next.completedAt,
          updated_at: ts,
        });
        return next;
      });
    },

    attachTag(id: string, tagId: string): Task {
      return transaction(db, () => {
        getOrThrow(id);
        links.attach('tasks', id, tagId);
        return getOrThrow(id);
      });
    },

    detachTag(id: string, tagId: string): Task {
      return transaction(db, () => {
        getOrThrow(id);
        links.detach('tasks', id, tagId);
        return getOrThrow(id);
      });
    },

    remove(id: string): void {
      transaction(db, () => {
        const ts = now();
        const { changes } = softDelete.run({ id, ts });
        if (changes === 0) throw new NotFoundError('Task', id);
        links.detachAllForOwner('tasks', id, ts);
      });
    },
  };
}
