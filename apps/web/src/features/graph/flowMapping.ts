import type { Edge, NodeSummary, Position } from '@km/core';
import { MarkerType, type Edge as FlowEdge, type Node as FlowNode } from '@xyflow/react';
import {
  DEFAULT_NODE_COLOR,
  PARALLEL_EDGE_SPACING,
  radiusForDegree,
  typeColors,
  type EdgeLane,
} from './graphGeometry';

export interface KmNodeData extends Record<string, unknown> {
  label: string;
  nodeType: string;
  radius: number;
  color: string;
}

export type KmFlowNode = FlowNode<KmNodeData, 'circle'>;
export type KmFlowEdge = FlowEdge<{ name: string; lane: EdgeLane }, 'floating'>;

const GRID_COLUMNS = 6;
const GRID_GAP_X = 160;
const GRID_GAP_Y = 120;
/** Must match `--graph-line` in styles.css (markers can't read CSS variables). */
const EDGE_COLOR = '#4a4a52';

/** Deterministic fallback for nodes that were never placed on the canvas. */
export function fallbackPosition(index: number): Position {
  return {
    x: (index % GRID_COLUMNS) * GRID_GAP_X,
    y: Math.floor(index / GRID_COLUMNS) * GRID_GAP_Y,
  };
}

/** Number of edge endpoints per node; a self-loop counts twice, like in graph theory. */
export function degrees(edges: readonly Edge[]): Map<string, number> {
  const degree = new Map<string, number>();
  for (const { fromId, toId } of edges) {
    degree.set(fromId, (degree.get(fromId) ?? 0) + 1);
    degree.set(toId, (degree.get(toId) ?? 0) + 1);
  }
  return degree;
}

/**
 * Maps server summaries to React Flow nodes, keeping client-only state
 * (selection) from the previous render so refetches don't drop it.
 */
export function toFlowNodes(
  nodes: readonly NodeSummary[],
  edges: readonly Edge[],
  previous: readonly KmFlowNode[],
): KmFlowNode[] {
  const prevById = new Map(previous.map((n) => [n.id, n]));
  const degree = degrees(edges);
  const colors = typeColors(nodes.map((n) => n.type));
  let unplaced = 0;
  return nodes.map((node) => {
    const prev = prevById.get(node.id);
    // A refetch landing mid-drag must not yank the node back to its old spot.
    const dragging = prev?.dragging === true;
    return {
      id: node.id,
      type: 'circle' as const,
      position: dragging ? prev.position : (node.position ?? fallbackPosition(unplaced++)),
      dragging,
      data: {
        label: node.title,
        nodeType: node.type,
        radius: radiusForDegree(degree.get(node.id) ?? 0),
        color: colors.get(node.type) ?? DEFAULT_NODE_COLOR,
      },
      selected: prev?.selected ?? false,
    };
  });
}

/**
 * Spreads edges that share the same pair of nodes into lanes so labels and
 * hit areas don't stack. Offsets are expressed in the pair's canonical
 * direction (lower id → higher id) so A→B and B→A bend to opposite sides.
 */
export function edgeLanes(edges: readonly Edge[]): Map<string, EdgeLane> {
  const groups = new Map<string, Edge[]>();
  for (const edge of edges) {
    const key =
      edge.fromId === edge.toId ? `loop:${edge.fromId}` : [edge.fromId, edge.toId].sort().join('|');
    const group = groups.get(key) ?? [];
    group.push(edge);
    groups.set(key, group);
  }

  const lanes = new Map<string, EdgeLane>();
  for (const group of groups.values()) {
    group.sort((a, b) => (a.id < b.id ? -1 : 1));
    group.forEach((edge, i) => {
      if (edge.fromId === edge.toId) {
        lanes.set(edge.id, { offset: 0, loopIndex: i });
        return;
      }
      const centred = (i - (group.length - 1) / 2) * PARALLEL_EDGE_SPACING;
      const canonical = edge.fromId < edge.toId;
      lanes.set(edge.id, { offset: canonical ? centred : -centred, loopIndex: 0 });
    });
  }
  return lanes;
}

export function toFlowEdges(edges: readonly Edge[], previous: readonly KmFlowEdge[]): KmFlowEdge[] {
  const prevById = new Map(previous.map((e) => [e.id, e]));
  const lanes = edgeLanes(edges);
  return edges.map((edge) => ({
    id: edge.id,
    type: 'floating',
    source: edge.fromId,
    target: edge.toId,
    label: edge.name,
    data: { name: edge.name, lane: lanes.get(edge.id) ?? { offset: 0, loopIndex: 0 } },
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: EDGE_COLOR },
    selected: prevById.get(edge.id)?.selected ?? false,
  }));
}
