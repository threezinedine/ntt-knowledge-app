import { BaseEdge, useInternalNode, type EdgeProps } from '@xyflow/react';
import type { KmFlowEdge, KmFlowNode } from './flowMapping';
import { toCircle } from './FloatingEdge';
import { edgeGeometry } from './graphGeometry';
import { edgeHighlight, useGraphHighlight } from './highlight';

/** A [[wikilink]] between two dots: a faint dashed line, no arrow, no name, no clicks. */
export function WikilinkEdge({ id, source, target }: EdgeProps<KmFlowEdge>) {
  const sourceNode = useInternalNode<KmFlowNode>(source);
  const targetNode = useInternalNode<KmFlowNode>(target);
  // Hovering a dot lights its real links only: a wikilink's far end isn't a lit neighbour.
  const state = edgeHighlight(useGraphHighlight(), source, target) === 'normal' ? 'normal' : 'dim';
  if (!sourceNode || !targetNode) return null;
  const { path } = edgeGeometry(toCircle(sourceNode), toCircle(targetNode), false);
  return <BaseEdge id={id} path={path} className={`km-wikilink km-wikilink--${state}`} />;
}
