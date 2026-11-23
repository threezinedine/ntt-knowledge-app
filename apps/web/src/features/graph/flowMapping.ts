import type { Edge, NodeSummary, Position } from '@km/core';
import { MarkerType, type Edge as FlowEdge, type Node as FlowNode } from '@xyflow/react';

export type KmFlowNode = FlowNode<{ label: string; nodeType: string }>;
export type KmFlowEdge = FlowEdge<{ name: string }>;

const GRID_COLUMNS = 6;
const GRID_GAP_X = 220;
const GRID_GAP_Y = 120;

/** Deterministic fallback for nodes that were never placed on the canvas. */
export function fallbackPosition(index: number): Position {
  return {
    x: (index % GRID_COLUMNS) * GRID_GAP_X,
    y: Math.floor(index / GRID_COLUMNS) * GRID_GAP_Y,
  };
}

/**
 * Maps server summaries to React Flow nodes, keeping client-only state
 * (selection) from the previous render so refetches don't drop it.
 */
export function toFlowNodes(
  nodes: readonly NodeSummary[],
  previous: readonly KmFlowNode[],
): KmFlowNode[] {
  const prevById = new Map(previous.map((n) => [n.id, n]));
  let unplaced = 0;
  return nodes.map((node) => ({
    id: node.id,
    position: node.position ?? fallbackPosition(unplaced++),
    data: { label: node.title, nodeType: node.type },
    selected: prevById.get(node.id)?.selected ?? false,
  }));
}

export function toFlowEdges(edges: readonly Edge[], previous: readonly KmFlowEdge[]): KmFlowEdge[] {
  const prevById = new Map(previous.map((e) => [e.id, e]));
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.fromId,
    target: edge.toId,
    label: edge.name,
    data: { name: edge.name },
    markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
    selected: prevById.get(edge.id)?.selected ?? false,
  }));
}
