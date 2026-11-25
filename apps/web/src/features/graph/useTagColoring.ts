import type { GraphSnapshot } from '@km/core';
import { useMemo } from 'react';
import { useNodeExp } from '../../api/queries';
import { useTagIndex } from '../tags/useTagIndex';
import { degrees } from './flowMapping';
import type { GraphSettings } from './graphSettings';
import { tagColoring, type TagColoringResult } from './tagColoring';

/**
 * The tag colours (graph settings, experimental), or undefined while it's off
 * or still loading (the dots keep their usual colours).
 */
export function useTagColoring(
  graph: GraphSnapshot | undefined,
  settings: GraphSettings,
): TagColoringResult | undefined {
  const { tagColors: on, colorRank, colorHubs, colorFade, colorReach } = settings;
  // Node tags and EXP: the graph snapshot carries neither.
  const nodeExp = useNodeExp(on);
  const tagIndex = useTagIndex();
  return useMemo(() => {
    if (!on || !graph || !nodeExp.data) return undefined;
    const tagColors = new Map(
      nodeExp.data.map((n) => [
        n.id,
        n.tagIds
          .map((id) => tagIndex.colors.get(id) ?? null)
          .filter((c): c is string => c !== null),
      ]),
    );
    const score =
      colorRank === 'exp' ? new Map(nodeExp.data.map((n) => [n.id, n.exp])) : degrees(graph.edges);
    return tagColoring({
      nodeIds: graph.nodes.map((n) => n.id),
      edges: graph.edges,
      tagColors,
      score,
      hubs: colorHubs,
      fade: colorFade,
      reach: colorReach,
    });
  }, [on, graph, nodeExp.data, tagIndex.colors, colorRank, colorHubs, colorFade, colorReach]);
}
