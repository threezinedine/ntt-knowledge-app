import { z } from 'zod';
import { entityMetaShape, idSchema, positionSchema, propsSchema } from './common.js';
import { tagIdsSchema } from './tag.js';

export const NODE_TITLE_MAX = 200;
export const NODE_CONTENT_MAX = 1_000_000;
export const DEFAULT_NODE_TYPE = 'note';

/** A node "label" in graph-database terms, e.g. `note`, `project`, `person`. */
export const nodeTypeSchema = z.string().trim().min(1).max(32);
export const nodeTitleSchema = z.string().trim().min(1).max(NODE_TITLE_MAX);
export const nodeContentSchema = z.string().max(NODE_CONTENT_MAX);

export const nodeSchema = z.object({
  ...entityMetaShape,
  type: nodeTypeSchema,
  title: nodeTitleSchema,
  /** Markdown body. */
  content: nodeContentSchema,
  props: propsSchema,
  /** Position on the graph canvas; `null` until the user places it. */
  position: positionSchema.nullable(),
  /** Attached tags (attach/detach via the tag endpoints). */
  tagIds: tagIdsSchema,
});
/** Named `GraphNode` to avoid clashing with the DOM `Node` type. */
export type GraphNode = z.infer<typeof nodeSchema>;

/** Lightweight projection used by the graph canvas and pickers. */
export type NodeSummary = Pick<GraphNode, 'id' | 'type' | 'title' | 'position'>;

export const createNodeInputSchema = z.strictObject({
  type: nodeTypeSchema.default(DEFAULT_NODE_TYPE),
  title: nodeTitleSchema,
  content: nodeContentSchema.default(''),
  props: propsSchema.default({}),
  position: positionSchema.nullable().default(null),
  tagIds: tagIdsSchema.default([]),
});
export type CreateNodeInput = z.input<typeof createNodeInputSchema>;
export type CreateNodeData = z.output<typeof createNodeInputSchema>;

export const updateNodeInputSchema = z.strictObject({
  type: nodeTypeSchema.optional(),
  title: nodeTitleSchema.optional(),
  content: nodeContentSchema.optional(),
  props: propsSchema.optional(),
  position: positionSchema.nullable().optional(),
});
export type UpdateNodeInput = z.infer<typeof updateNodeInputSchema>;

/** Most dots one drag can move (the dragged ones plus those it pushed aside). */
export const MAX_POSITIONS_PER_BATCH = 500;

/** PATCH /api/nodes/positions: canvas moves of several nodes, all or nothing. */
export const nodePositionsInputSchema = z.strictObject({
  items: z
    .array(z.strictObject({ id: idSchema, position: positionSchema }))
    .min(1)
    .max(MAX_POSITIONS_PER_BATCH),
});
export type NodePositionsInput = z.infer<typeof nodePositionsInputSchema>;

export const nodeListQuerySchema = z.strictObject({
  q: z.string().trim().max(NODE_TITLE_MAX).optional(),
  type: nodeTypeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});
export type NodeListQuery = z.output<typeof nodeListQuerySchema>;
