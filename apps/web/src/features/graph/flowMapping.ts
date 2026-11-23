import type { Edge, NodeSummary, Position } from '@km/core';
import { MarkerType, type Edge as FlowEdge, type Node as FlowNode } from '@xyflow/react';
import { DEFAULT_NODE_COLOR, radiusForDegree, typeColors } from './graphGeometry';

export interface KmNodeData extends Record<string, unknown> {
  label: string;
  nodeType: string;
  radius: number;
  color: string;
}

export type KmFlowNode = FlowNode<KmNodeData, 'circle'>;
export type KmFlowEdge = FlowEdge<{ name: string }, 'floating'>;

const GRID_COLUMNS = 6;
const GRID_GAP_X = 160;
const GRID_GAP_Y = 120;
const EDGE_COLOR = '#5c5c66';

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
  return nodes.map((node) => ({
    id: node.id,
    type: 'circle',
    position: node.position ?? fallbackPosition(unplaced++),
    data: {
      label: node.title,
      nodeType: node.type,
      radius: radiusForDegree(degree.get(node.id) ?? 0),
      color: colors.get(node.type) ?? DEFAULT_NODE_COLOR,
    },
    selected: prevById.get(node.id)?.selected ?? false,
  }));
}

export function toFlowEdges(edges: readonly Edge[], previous: readonly KmFlowEdge[]): KmFlowEdge[] {
  const prevById = new Map(previous.map((e) => [e.id, e]));
  return edges.map((edge) => ({
    id: edge.id,
    type: 'floating',
    source: edge.fromId,
    target: edge.toId,
    label: edge.name,
    data: { name: edge.name },
    markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: EDGE_COLOR },
    selected: prevById.get(edge.id)?.selected ?? false,
  }));
}
