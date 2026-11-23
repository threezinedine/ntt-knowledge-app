import { BaseEdge, useInternalNode, type EdgeProps, type InternalNode } from '@xyflow/react';
import type { KmFlowEdge, KmFlowNode } from './flowMapping';
import { edgeGeometry, type Circle } from './graphGeometry';
import { edgeHighlight, useGraphHighlight } from './highlight';

/** Marker defined once by <GraphMarkers/>; React Flow's markers can't change colour per state. */
export const ACTIVE_ARROW_ID = 'km-arrow-active';

export function GraphMarkers() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <marker
          id={ACTIVE_ARROW_ID}
          viewBox="-10 -10 20 20"
          markerWidth="14"
          markerHeight="14"
          orient="auto-start-reverse"
          refX="0"
          refY="0"
          markerUnits="strokeWidth"
        >
          <polyline
            points="-5,-4 0,0 -5,4 -5,-4"
            fill="var(--graph-accent)"
            stroke="var(--graph-accent)"
            strokeLinejoin="round"
          />
        </marker>
      </defs>
    </svg>
  );
}

function toCircle(node: InternalNode<KmFlowNode>): Circle {
  const r = node.data.radius;
  const { x, y } = node.internals.positionAbsolute;
  return {
    cx: x + (node.measured.width ?? r * 2) / 2,
    cy: y + (node.measured.height ?? r * 2) / 2,
    r,
  };
}

/** Straight, center-to-center edge (Obsidian look) that keeps its arrow and relation label. */
export function FloatingEdge({
  id,
  source,
  target,
  label,
  markerEnd,
  selected,
}: EdgeProps<KmFlowEdge>) {
  const sourceNode = useInternalNode<KmFlowNode>(source);
  const targetNode = useInternalNode<KmFlowNode>(target);
  const state = edgeHighlight(useGraphHighlight(), source, target);
  if (!sourceNode || !targetNode) return null;

  const { path, labelX, labelY } = edgeGeometry(
    toCircle(sourceNode),
    toCircle(targetNode),
    source === target,
  );

  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={state === 'active' || selected ? `url(#${ACTIVE_ARROW_ID})` : markerEnd}
      label={label}
      labelX={labelX}
      labelY={labelY}
      className={`km-edge km-edge--${state}${selected ? ' is-selected' : ''}`}
      labelShowBg={false}
      labelStyle={{ opacity: state === 'dim' ? 0.15 : state === 'active' ? 1 : 0.6 }}
    />
  );
}
