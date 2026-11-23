import {
  buildCategoryTree,
  flattenCategoryTree,
  taskTitleSchema,
  type CategoryTreeNode,
  type Task,
  type TaskStatus,
} from '@km/core';
import { useMemo, useState, type SubmitEvent } from 'react';
import { errorMessage } from '../../api/client';
import {
  useCategories,
  useCreateTask,
  useDeleteTask,
  useNodeTasks,
  useUpdateTask,
} from '../../api/queries';

export function TasksPanel({ nodeId }: { nodeId: string }) {
  const tasks = useNodeTasks(nodeId);
  const categories = useCategories();
  const flat = useMemo(
    () => flattenCategoryTree(buildCategoryTree(categories.data ?? [])),
    [categories.data],
  );
  const pathById = useMemo(
    () => new Map(flat.map((n) => [n.category.id, n.path.join(' / ')])),
    [flat],
  );

  const done = tasks.data?.filter((t) => t.status === 'done').length ?? 0;
  const total = tasks.data?.length ?? 0;

  return (
    <section className="panel" aria-label="Tasks">
      <h3>
        Tasks <span className="muted">{total > 0 && `${done}/${total}`}</span>
      </h3>
      {tasks.isError && <p className="error">{errorMessage(tasks.error)}</p>}
      <ul className="task-list" data-testid="task-list">
        {tasks.data?.map((task) => (
          <TaskItem
            key={task.id}
            task={task}
            categoryPath={task.categoryId ? pathById.get(task.categoryId) : undefined}
          />
        ))}
      </ul>
      <AddTaskForm nodeId={nodeId} categories={flat} />
    </section>
  );
}

function TaskItem({ task, categoryPath }: { task: Task; categoryPath: string | undefined }) {
  const updateTask = useUpdateTask(task.nodeId);
  const deleteTask = useDeleteTask(task.nodeId);
  // Optimistic status, set synchronously so the checkbox reacts instantly
  // (query-cache updates are batched to a later tick). Cleared once the
  // server answers; on failure the server value shows again.
  const [optimisticStatus, setOptimisticStatus] = useState<TaskStatus | null>(null);
  const status = optimisticStatus ?? task.status;
  const isDone = status === 'done';
  const busy = optimisticStatus !== null;

  const setStatus = (next: TaskStatus) => {
    setOptimisticStatus(next);
    updateTask.mutate(
      { id: task.id, patch: { status: next } },
      {
        onSettled: () => {
          setOptimisticStatus(null);
        },
      },
    );
  };

  return (
    <li className={`task-item ${isDone ? 'done' : ''} ${status === 'doing' ? 'doing' : ''}`}>
      <label>
        <input
          type="checkbox"
          checked={isDone}
          disabled={busy}
          onChange={() => {
            setStatus(isDone ? 'todo' : 'done');
          }}
        />
        <span className="task-title">{task.title}</span>
      </label>
      {!isDone && (
        <button
          type="button"
          className="subtle small"
          disabled={busy}
          aria-pressed={status === 'doing'}
          aria-label={`${status === 'doing' ? 'Pause' : 'Start'} task ${task.title}`}
          onClick={() => {
            setStatus(status === 'doing' ? 'todo' : 'doing');
          }}
        >
          {status === 'doing' ? 'Doing' : 'Start'}
        </button>
      )}
      {categoryPath && <span className="chip">{categoryPath}</span>}
      {updateTask.isError && <span className="error">{errorMessage(updateTask.error)}</span>}
      <button
        type="button"
        className="icon danger subtle"
        aria-label={`Delete task ${task.title}`}
        onClick={() => {
          deleteTask.mutate(task.id);
        }}
      >
        ×
      </button>
    </li>
  );
}

function AddTaskForm({ nodeId, categories }: { nodeId: string; categories: CategoryTreeNode[] }) {
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const createTask = useCreateTask(nodeId);
  const valid = taskTitleSchema.safeParse(title).success;

  const submit = (e: SubmitEvent) => {
    e.preventDefault();
    if (!valid) return;
    createTask.mutate(
      { nodeId, title, categoryId: categoryId || null },
      {
        onSuccess: () => {
          setTitle('');
        },
      },
    );
  };

  return (
    <form className="add-task-form" onSubmit={submit} aria-label="Add task">
      <input
        aria-label="New task"
        placeholder="New task…"
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
        }}
      />
      <select
        aria-label="Task category"
        value={categoryId}
        onChange={(e) => {
          setCategoryId(e.target.value);
        }}
      >
        <option value="">No category</option>
        {categories.map((n) => (
          <option key={n.category.id} value={n.category.id}>
            {n.path.join(' / ')}
          </option>
        ))}
      </select>
      <button type="submit" disabled={!valid || createTask.isPending}>
        Add
      </button>
      {createTask.isError && <p className="error">{errorMessage(createTask.error)}</p>}
    </form>
  );
}
