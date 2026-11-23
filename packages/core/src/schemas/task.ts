import { z } from 'zod';
import { entityMetaShape, idSchema } from './common.js';

export const categoryNameSchema = z.string().trim().min(1).max(64);
export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a #rrggbb colour');

/** Task categories form a tree (category → sub-category → ...). */
export const categorySchema = z.object({
  ...entityMetaShape,
  name: categoryNameSchema,
  parentId: idSchema.nullable(),
  color: colorSchema.nullable(),
});
export type Category = z.infer<typeof categorySchema>;

export const createCategoryInputSchema = z.strictObject({
  name: categoryNameSchema,
  parentId: idSchema.nullable().default(null),
  color: colorSchema.nullable().default(null),
});
export type CreateCategoryInput = z.input<typeof createCategoryInputSchema>;
export type CreateCategoryData = z.output<typeof createCategoryInputSchema>;

export const updateCategoryInputSchema = z.strictObject({
  name: categoryNameSchema.optional(),
  parentId: idSchema.nullable().optional(),
  color: colorSchema.nullable().optional(),
});
export type UpdateCategoryInput = z.infer<typeof updateCategoryInputSchema>;

export const TASK_STATUSES = ['todo', 'doing', 'done'] as const;
export const taskStatusSchema = z.enum(TASK_STATUSES);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const taskTitleSchema = z.string().trim().min(1).max(300);

export const taskSchema = z.object({
  ...entityMetaShape,
  nodeId: idSchema,
  categoryId: idSchema.nullable(),
  title: taskTitleSchema,
  status: taskStatusSchema,
  /** Set when status transitions to `done`; basis for future EXP calculation. */
  completedAt: z.number().int().nonnegative().nullable(),
});
export type Task = z.infer<typeof taskSchema>;

export const createTaskInputSchema = z.strictObject({
  nodeId: idSchema,
  categoryId: idSchema.nullable().default(null),
  title: taskTitleSchema,
  status: taskStatusSchema.default('todo'),
});
export type CreateTaskInput = z.input<typeof createTaskInputSchema>;
export type CreateTaskData = z.output<typeof createTaskInputSchema>;

export const updateTaskInputSchema = z.strictObject({
  categoryId: idSchema.nullable().optional(),
  title: taskTitleSchema.optional(),
  status: taskStatusSchema.optional(),
});
export type UpdateTaskInput = z.infer<typeof updateTaskInputSchema>;
