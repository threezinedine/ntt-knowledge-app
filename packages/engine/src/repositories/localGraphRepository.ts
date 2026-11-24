import { localDistances, splitLocalEdges, type LocalGraph, type LocalGraphNode } from '@km/core';
import type { EdgeRepository } from './edgeRepository.js';
import type { NodeRepository } from './nodeRepository.js';

export type LocalGraphRepository = ReturnType<typeof createLocalGraphRepository>;

/** Read-only view over nodes and edges: a node's neighbourhood, for the link check. */
export function createLocalGraphRepository(
  nodes: Pick<NodeRepository, 'getOrThrow' | 'get' | 'summaries'>,
  edges: Pick<EdgeRepository, 'all'>,
) {
  return {
    of(rootId: string, depth: number): LocalGraph {
      // node:sqlite is synchronous: these reads see one consistent state.
      nodes.getOrThrow(rootId);
      // Only links between live nodes: after a sync a node's tombstone may
      // arrive before its links' ones, and the search must not walk through it.
      const live = new Set(nodes.summaries().map((n) => n.id));
      const all = edges.all().filter((e) => live.has(e.fromId) && live.has(e.toId));
      const distance = localDistances(rootId, all, depth);
      const { inner, boundary } = splitLocalEdges(distance, all);

      const local: LocalGraphNode[] = [];
      for (const [id, d] of distance) {
        const node = nodes.get(id);
        if (node) local.push({ ...node, distance: d });
      }
      local.sort(
        (a, b) =>
          a.distance - b.distance || a.title.localeCompare(b.title) || (a.id < b.id ? -1 : 1),
      );

      return {
        rootId,
        depth,
        nodes: local,
        edges: inner,
        boundary: boundary.flatMap((edge) => {
          const outsideId = distance.has(edge.fromId) ? edge.toId : edge.fromId;
          const outside = nodes.get(outsideId);
          return outside ? [{ edge, outside: { id: outside.id, title: outside.title } }] : [];
        }),
      };
    },
  };
}
