import { z } from 'zod';
import { entityMetaShape, idSchema } from './common.js';

export const tagNameSchema = z.string().trim().min(1).max(64);
export const colorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected a #rrggbb colour');

/**
 * Tags form one shared tree (Work → Backend → API) and attach many-to-many
 * to both nodes and tasks.
 */
export const tagSchema = z.object({
  ...entityMetaShape,
  name: tagNameSchema,
  parentId: idSchema.nullable(),
  color: colorSchema.nullable(),
});
export type Tag = z.infer<typeof tagSchema>;

export const createTagInputSchema = z.strictObject({
  name: tagNameSchema,
  parentId: idSchema.nullable().default(null),
  color: colorSchema.nullable().default(null),
});
export type CreateTagInput = z.input<typeof createTagInputSchema>;
export type CreateTagData = z.output<typeof createTagInputSchema>;

export const updateTagInputSchema = z.strictObject({
  name: tagNameSchema.optional(),
  parentId: idSchema.nullable().optional(),
  color: colorSchema.nullable().optional(),
});
export type UpdateTagInput = z.infer<typeof updateTagInputSchema>;

/** Things a tag can be attached to. */
export const TAGGABLE_KINDS = ['nodes', 'tasks'] as const;
export type TaggableKind = (typeof TAGGABLE_KINDS)[number];
