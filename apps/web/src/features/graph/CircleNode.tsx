import {
  Handle,
  Position as HandlePosition,
  useViewportStore,
  type NodeProps,
} from '@xyflow/react';
import type { CSSProperties } from 'react';
import type { KmFlowNode } from './flowMapping';
import { nodeHighlight, useGraphHighlight } from './highlight';

/** Below this zoom, labels are hidden like in Obsidian to keep the graph readable. */
const LABEL_MIN_ZOOM = 0.45;

/**
 * Obsidian-style node: a coloured dot sized by link count, label underneath.
 * The target handle sits at the centre (with a generous `connectionRadius`,
 * dropping anywhere on the dot connects); the source handle is a small grip on
 * the rim that appears on hover.
 */
export function CircleNode({ id, data, selected }: NodeProps<KmFlowNode>) {
  const state = nodeHighlight(useGraphHighlight(), id);
  const showLabel = useViewportStore((s) => s.transform[2] >= LABEL_MIN_ZOOM);
  const size = data.radius * 2;
  const style = { width: size, height: size, '--node-color': data.color } as CSSProperties;

  return (
    <div
      className={`km-node km-node--${state}${selected ? ' is-selected' : ''}`}
      style={style}
      title={`${data.label} (${data.nodeType})`}
    >
      <Handle
        type="target"
        position={HandlePosition.Top}
        isConnectableStart={false}
        className="km-handle km-handle--target"
      />
      <Handle
        type="source"
        position={HandlePosition.Bottom}
        className="km-handle km-handle--source"
      />
      {(showLabel || state === 'active') && <span className="km-node-label">{data.label}</span>}
    </div>
  );
}
