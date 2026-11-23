import { z } from 'zod';
import { entityMetaShape, idSchema } from './common.js';

export const TASK_STATUSES = ['todo', 'doing', 'done'] as const;
export const taskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const taskTitleSchema = z.string().trim().min(1).max(300);

/** Max tags per node/task; generous, but bounds request sizes. */
export const MAX_TAGS_PER_ITEM = 50;
export const tagIdsSchema = z.array(idSchema).max(MAX_TAGS_PER_ITEM);

export const taskSchema = z.object({
  ...entityMetaShape,
  nodeId: idSchema,
  title: taskTitleSchema,
  status: taskStatusSchema,
  /** Set when status transitions to `done`; basis for future EXP calculation. */
  completedAt: z.number().int().nonnegative().nullable(),
  /** Attached tags (attach/detach via the tag endpoints). */
  tagIds: tagIdsSchema,
});
export type Task = z.infer<typeof taskSchema>;

export const createTaskInputSchema = z.strictObject({
  nodeId: idSchema,
  title: taskTitleSchema,
  status: taskStatusSchema.default('todo'),
  tagIds: tagIdsSchema.default([]),
});
export type CreateTaskInput = z.input<typeof createTaskInputSchema>;
export type CreateTaskData = z.output<typeof createTaskInputSchema>;

export const updateTaskInputSchema = z.strictObject({
  title: taskTitleSchema.optional(),
  status: taskStatusSchema.optional(),
});
export type UpdateTaskInput = z.infer<typeof updateTaskInputSchema>;
