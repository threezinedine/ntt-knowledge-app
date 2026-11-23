import { createContext, useContext } from 'react';

/**
 * Hover focus, shared via context so hovering doesn't rebuild the node/edge
 * arrays React Flow diffs. `activeId === null` means nothing is hovered.
 */
export interface GraphHighlight {
  activeId: string | null;
  neighborIds: ReadonlySet<string>;
}

export const NO_HIGHLIGHT: GraphHighlight = { activeId: null, neighborIds: new Set() };

export const GraphHighlightContext = createContext<GraphHighlight>(NO_HIGHLIGHT);

export const useGraphHighlight = () => useContext(GraphHighlightContext);

export type HighlightState = 'normal' | 'active' | 'neighbor' | 'dim';

export function nodeHighlight(h: GraphHighlight, id: string): HighlightState {
  if (h.activeId === null) return 'normal';
  if (h.activeId === id) return 'active';
  return h.neighborIds.has(id) ? 'neighbor' : 'dim';
}

export function edgeHighlight(h: GraphHighlight, source: string, target: string): HighlightState {
  if (h.activeId === null) return 'normal';
  return source === h.activeId || target === h.activeId ? 'active' : 'dim';
}

/** Undirected adjacency, for "light up my neighbours" on hover. */
export function buildAdjacency(
  edges: readonly { source: string; target: string }[],
): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    const set = adjacency.get(a) ?? new Set<string>();
    set.add(b);
    adjacency.set(a, set);
  };
  for (const { source, target } of edges) {
    link(source, target);
    link(target, source);
  }
  return adjacency;
}
