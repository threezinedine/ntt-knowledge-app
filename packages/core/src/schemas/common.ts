import { z } from 'zod';

/**
 * All entity ids are UUIDv7: globally unique (safe for future multi-device sync)
 * and time-ordered (good B-tree locality, sortable by creation time).
 */
export const idSchema = z.uuid();
export type Id = z.infer<typeof idSchema>;

/** Unix epoch milliseconds. */
export const timestampSchema = z.number().int().nonnegative();

/** Free-form, JSON-serialisable key/value properties (property-graph style). */
export const propsSchema = z.record(z.string().min(1).max(64), z.json());
export type Props = z.infer<typeof propsSchema>;

export const positionSchema = z.object({
  x: z.number(),
  y: z.number(),
});
export type Position = z.infer<typeof positionSchema>;

/** Fields every persisted entity carries. Deletion is soft (tombstones) for future sync. */
export const entityMetaShape = {
  id: idSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
};
