import {
  BaseEdge,
  EdgeLabelRenderer,
  useInternalNode,
  type EdgeProps,
  type InternalNode,
} from '@xyflow/react';
import { createContext, useContext } from 'react';
import { EdgeNameEditor } from './EdgeNameEditor';
import { ARROW_SIZE, type KmFlowEdge, type KmFlowNode } from './flowMapping';
import { edgeGeometry, type Circle } from './graphGeometry';
import { useGraphSettings } from './graphSettings';
import { edgeHighlight, useGraphHighlight } from './highlight';

/** Which link is being renamed on the canvas, and what to do with the result. */
export interface EdgeRename {
  editingId: string | null;
  commit: (id: string, name: string) => void;
  cancel: () => void;
}
export const EdgeRenameContext = createContext<EdgeRename>({
  editingId: null,
  commit: () => undefined,
  cancel: () => undefined,
});

/** Marker defined once by <GraphMarkers/>; React Flow's markers can't change colour per state. */
export const ACTIVE_ARROW_ID = 'km-arrow-active';

export function GraphMarkers() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <marker
          id={ACTIVE_ARROW_ID}
          viewBox="-10 -10 20 20"
          markerWidth={ARROW_SIZE}
          markerHeight={ARROW_SIZE}
          orient="auto-start-reverse"
          refX="0"
          refY="0"
          markerUnits="userSpaceOnUse"
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

/** A dot on the canvas as a circle (centre, radius), for drawing lines between dots. */
export function toCircle(node: InternalNode<KmFlowNode>): Circle {
  const r = node.data.radius;
  const { x, y } = node.internals.positionAbsolute;
  return {
    cx: x + (node.measured.width ?? r * 2) / 2,
    cy: y + (node.measured.height ?? r * 2) / 2,
    r,
  };
}

/**
 * Straight, center-to-center edge (Obsidian look) that keeps its arrow and
 * relation label. The label runs along the edge, lifted just off the line.
 */
export function FloatingEdge({
  id,
  source,
  target,
  label,
  markerEnd,
  selected,
  data,
}: EdgeProps<KmFlowEdge>) {
  const sourceNode = useInternalNode<KmFlowNode>(source);
  const targetNode = useInternalNode<KmFlowNode>(target);
  const state = edgeHighlight(useGraphHighlight(), source, target);
  const rename = useContext(EdgeRenameContext);
  const { showArrows, showLinkLabels, linkLabelOpacity } = useGraphSettings();
  if (!sourceNode || !targetNode) return null;

  const { path, labelX, labelY, labelAngle } = edgeGeometry(
    toCircle(sourceNode),
    toCircle(targetNode),
    source === target,
    data?.lane,
  );

  const editing = rename.editingId === id;
  const name = data?.name ?? (typeof label === 'string' ? label : '');

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={
          !showArrows
            ? undefined
            : state === 'active' || selected
              ? `url(#${ACTIVE_ARROW_ID})`
              : markerEnd
        }
        className={`km-edge km-edge--${state}${selected ? ' is-selected' : ''}`}
      />
      {/* Hidden labels still show on the hovered or selected link. */}
      {!editing && name && (showLinkLabels || state === 'active' || selected) && (
        <text
          className="react-flow__edge-text"
          x={labelX}
          y={labelY}
          dy={-5}
          textAnchor="middle"
          transform={`rotate(${String(labelAngle)} ${String(labelX)} ${String(labelY)})`}
          style={{
            opacity:
              state === 'dim'
                ? Math.min(0.15, linkLabelOpacity)
                : state === 'active' || selected
                  ? 1
                  : linkLabelOpacity,
          }}
        >
          {name}
        </text>
      )}
      {editing && (
        <EdgeLabelRenderer>
          <div
            className="edge-rename nodrag nopan"
            style={{
              transform: `translate(-50%, -50%) translate(${String(labelX)}px, ${String(labelY)}px)`,
            }}
          >
            <EdgeNameEditor
              initial={name}
              onCommit={(next) => {
                rename.commit(id, next);
              }}
              onCancel={rename.cancel}
            />
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
