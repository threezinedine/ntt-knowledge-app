import { nodeTitleSchema, nodeTypeSchema, type GraphNode, type UpdateNodeInput } from '@km/core';

export type NodeDraft = Pick<GraphNode, 'title' | 'type' | 'content'>;

/**
 * Builds the PATCH for a draft, field by field: content is always saved, while
 * an invalid title/type (e.g. temporarily blank) is simply left out. An invalid
 * field must never block saving the others, or typed text gets lost.
 */
export function draftToPatch(draft: NodeDraft): UpdateNodeInput {
  const patch: UpdateNodeInput = { content: draft.content };
  const title = nodeTitleSchema.safeParse(draft.title);
  if (title.success) patch.title = title.data;
  const type = nodeTypeSchema.safeParse(draft.type);
  if (type.success) patch.type = type.data;
  return patch;
}
