import { z } from 'zod';
import { entityMetaShape, idSchema, propsSchema } from './common.js';
import type { NodeSummary } from './node.js';

/**
 * Relationship type, e.g. `DEPENDS_ON`, `thuộc về`. Free text on purpose:
 * this is a personal tool and relation names are user vocabulary.
 */
export const relationNameSchema = z.string().trim().min(1).max(64);

/** A directed, named edge: (fromId)-[name]->(toId). */
export const edgeSchema = z.object({
  ...entityMetaShape,
  fromId: idSchema,
  toId: idSchema,
  name: relationNameSchema,
  props: propsSchema,
});
export type Edge = z.infer<typeof edgeSchema>;

export const createEdgeInputSchema = z.strictObject({
  fromId: idSchema,
  toId: idSchema,
  name: relationNameSchema,
  props: propsSchema.default({}),
});
export type CreateEdgeInput = z.input<typeof createEdgeInputSchema>;
export type CreateEdgeData = z.output<typeof createEdgeInputSchema>;

/** Endpoints are immutable; to "move" an edge, delete it and create a new one. */
export const updateEdgeInputSchema = z.strictObject({
  name: relationNameSchema.optional(),
  props: propsSchema.optional(),
});
export type UpdateEdgeInput = z.infer<typeof updateEdgeInputSchema>;

/** An edge together with the node on its other end, as seen from one node. */
export interface EdgeWithNeighbor {
  edge: Edge;
  neighbor: NodeSummary;
}

export interface NodeEdges {
  outgoing: EdgeWithNeighbor[];
  incoming: EdgeWithNeighbor[];
}
