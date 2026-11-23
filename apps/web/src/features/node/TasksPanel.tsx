import { taskTitleSchema, type Task, type TaskStatus } from '@km/core';
import { useRef, useState, type SubmitEvent } from 'react';
import {
  useCreateTask,
  useDeleteTask,
  useNodeTasks,
  useTagLink,
  useUpdateTask,
} from '../../api/queries';
import { useCommandHandler } from '../../commands/registry';
import { useCommandTooltip } from '../../commands/useCommandTooltip';
import { useI18n } from '../../i18n/context';
import { useTagDropTarget } from '../tags/dnd';
import { OwnerTags } from '../tags/OwnerTags';
import { useTagIndex, type TagIndex } from '../tags/useTagIndex';

export function TasksPanel({ nodeId }: { nodeId: string }) {
  const tasks = useNodeTasks(nodeId);
  const index = useTagIndex();
  const { t, errorText } = useI18n();

  const done = tasks.data?.filter((t) => t.status === 'done').length ?? 0;
  const total = tasks.data?.length ?? 0;

  return (
    <section className="panel" aria-label={t('tasks.heading')}>
      <h3>
        {t('tasks.heading')} <span className="muted">{total > 0 && `${done}/${total}`}</span>
      </h3>
      {tasks.isError && <p className="error">{errorText(tasks.error)}</p>}
      <ul className="task-list" data-testid="task-list">
        {tasks.data?.map((task) => (
          <TaskItem key={task.id} task={task} index={index} />
        ))}
      </ul>
      <AddTaskForm nodeId={nodeId} index={index} />
    </section>
  );
}

function TaskItem({ task, index }: { task: Task; index: TagIndex }) {
  const updateTask = useUpdateTask(task.nodeId);
  const deleteTask = useDeleteTask(task.nodeId);
  const link = useTagLink('tasks');
  const { t, errorText } = useI18n();
  // The whole row accepts dropped tags (bigger target than the chip strip).
  const { isOver, dropProps } = useTagDropTarget(
    (tagId) => {
      link.mutate({ ownerId: task.id, tagId, attached: true });
    },
    (tagId) => !task.tagIds.includes(tagId),
  );

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
    <li
      className={`task-item ${isDone ? 'done' : ''} ${status === 'doing' ? 'doing' : ''}${isOver ? ' is-drop-target' : ''}`}
      data-testid={`task-${task.title}`}
      {...dropProps}
    >
      <div className="task-row">
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
            aria-label={t(status === 'doing' ? 'tasks.pauseLabel' : 'tasks.startLabel', {
              title: task.title,
            })}
            onClick={() => {
              setStatus(status === 'doing' ? 'todo' : 'doing');
            }}
          >
            {t(status === 'doing' ? 'tasks.doing' : 'tasks.start')}
          </button>
        )}
        <button
          type="button"
          className="icon danger subtle"
          aria-label={t('tasks.delete', { title: task.title })}
          onClick={() => {
            deleteTask.mutate(task.id);
          }}
        >
          ×
        </button>
      </div>
      <OwnerTags
        kind="tasks"
        ownerId={task.id}
        ownerLabel={task.title}
        tagIds={task.tagIds}
        index={index}
        compact
        droppable={false}
      />
      {updateTask.isError && <span className="error">{errorText(updateTask.error)}</span>}
      {link.isError && <span className="error">{errorText(link.error)}</span>}
    </li>
  );
}

function AddTaskForm({ nodeId, index }: { nodeId: string; index: TagIndex }) {
  const [title, setTitle] = useState('');
  const [tagId, setTagId] = useState('');
  const createTask = useCreateTask(nodeId);
  const valid = taskTitleSchema.safeParse(title).success;
  const { t, errorText } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const addTip = useCommandTooltip('km.node.addTask');
  useCommandHandler('km.node.addTask', () => {
    inputRef.current?.focus();
  });

  const submit = (e: SubmitEvent) => {
    e.preventDefault();
    if (!valid) return;
    createTask.mutate(
      { nodeId, title, tagIds: tagId ? [tagId] : [] },
      {
        onSuccess: () => {
          setTitle('');
        },
      },
    );
  };

  return (
    <form className="add-task-form" onSubmit={submit} aria-label={t('tasks.addForm')}>
      <input
        ref={inputRef}
        aria-label={t('tasks.new')}
        placeholder={t('tasks.newPlaceholder')}
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
        }}
      />
      <select
        aria-label={t('tasks.initialTag')}
        value={tagId}
        onChange={(e) => {
          setTagId(e.target.value);
        }}
      >
        <option value="">{t('tasks.noTag')}</option>
        {index.flat.map((n) => (
          <option key={n.tag.id} value={n.tag.id}>
            {n.path.join(' / ')}
          </option>
        ))}
      </select>
      <button type="submit" disabled={!valid || createTask.isPending} {...addTip}>
        {t('common.add')}
      </button>
      {createTask.isError && <p className="error">{errorText(createTask.error)}</p>}
    </form>
  );
}
