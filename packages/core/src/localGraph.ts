import { z } from 'zod';
import type { Edge } from './schemas/edge.js';
import type { GraphNode } from './schemas/node.js';

/**
 * The local graph of a node: every node at most `depth` links away from it,
 * following links both ways (like Obsidian's local graph). Used to build the
 * link-check prompt, where an AI fact-checks the links among these nodes.
 */

export const LOCAL_GRAPH_MAX_DEPTH = 3;

/** GET /api/nodes/:id/local-graph?depth=1..3 */
export const localGraphQuerySchema = z.strictObject({
  depth: z.coerce.number().int().min(1).max(LOCAL_GRAPH_MAX_DEPTH).default(1),
});
export type LocalGraphQuery = z.output<typeof localGraphQuerySchema>;

export type LocalGraphNode = GraphNode & {
  /** Links away from the root (0 = the root). */
  distance: number;
};

/** A link from a node in the local graph to one outside it: context only. */
export interface BoundaryLink {
  edge: Edge;
  outside: { id: string; title: string };
}

export interface LocalGraph {
  rootId: string;
  depth: number;
  /** Root first, then by distance and title. */
  nodes: LocalGraphNode[];
  /** Links with both ends inside: the ones to check. */
  edges: Edge[];
  boundary: BoundaryLink[];
}

/**
 * Distance of every node within `depth` links of `rootId`, either direction
 * (breadth-first; a self-loop or a parallel link changes nothing).
 */
export function localDistances(
  rootId: string,
  edges: readonly Pick<Edge, 'fromId' | 'toId'>[],
  depth: number,
): Map<string, number> {
  const neighbors = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const list = neighbors.get(a);
    if (list) list.push(b);
    else neighbors.set(a, [b]);
  };
  for (const e of edges) {
    link(e.fromId, e.toId);
    link(e.toId, e.fromId);
  }
  const distance = new Map([[rootId, 0]]);
  let frontier = [rootId];
  for (let d = 1; d <= depth && frontier.length > 0; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const n of neighbors.get(id) ?? []) {
        if (distance.has(n)) continue;
        distance.set(n, d);
        next.push(n);
      }
    }
    frontier = next;
  }
  return distance;
}

/** Splits the links touching the local graph into inside ones and boundary ones. */
export function splitLocalEdges<E extends Pick<Edge, 'fromId' | 'toId'>>(
  inside: ReadonlySet<string> | ReadonlyMap<string, unknown>,
  edges: readonly E[],
): { inner: E[]; boundary: E[] } {
  const inner: E[] = [];
  const boundary: E[] = [];
  for (const e of edges) {
    const a = inside.has(e.fromId);
    const b = inside.has(e.toId);
    if (a && b) inner.push(e);
    else if (a || b) boundary.push(e);
  }
  return { inner, boundary };
}
