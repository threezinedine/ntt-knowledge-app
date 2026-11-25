import type { Edge, NodeSummary } from '@km/core';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SIZES } from './graphGeometry';
import {
  edgeLanes,
  fallbackPosition,
  toFlowEdges,
  toFlowNodes,
  toWikilinkEdges,
  type KmFlowNode,
} from './flowMapping';

const summary = (id: string, position: NodeSummary['position'] = null): NodeSummary => ({
  id,
  type: 'note',
  title: id.toUpperCase(),
  position,
});

describe('toFlowNodes', () => {
  it('uses stored positions and lays out unplaced nodes on a grid', () => {
    const nodes = toFlowNodes([summary('a', { x: 5, y: 5 }), summary('b'), summary('c')], [], []);
    expect(nodes.map((n) => n.position)).toEqual([
      { x: 5, y: 5 },
      fallbackPosition(0),
      fallbackPosition(1),
    ]);
    expect(nodes[0]?.data).toMatchObject({
      label: 'A',
      nodeType: 'note',
      radius: DEFAULT_SIZES.unlinkedRadius,
    });
  });

  it('sizes dots with the given sizes', () => {
    const sizes = { unlinkedRadius: 3, linkedMinRadius: 10, maxRadius: 50 };
    const nodes = toFlowNodes([summary('a'), summary('b')], [], [], sizes);
    expect(nodes.map((n) => n.data.radius)).toEqual([3, 3]);
  });

  it('keeps selection across refetches', () => {
    const prev = toFlowNodes([summary('a'), summary('b')], [], []).map((n): KmFlowNode =>
      n.id === 'b' ? { ...n, selected: true } : n,
    );
    const next = toFlowNodes([summary('a'), summary('b')], [], prev);
    expect(next.map((n) => n.selected)).toEqual([false, true]);
  });
});

describe('toFlowEdges', () => {
  it('maps direction and relation name to a labelled arrow', () => {
    const edge: Edge = {
      id: 'e',
      fromId: 'a',
      toId: 'b',
      name: 'R',
      props: {},
      createdAt: 0,
      updatedAt: 0,
    };
    const [flow] = toFlowEdges([edge], []);
    expect(flow).toMatchObject({ source: 'a', target: 'b', label: 'R', selected: false });
    expect(flow?.markerEnd).toBeDefined();
  });
});

const mkEdge = (id: string, fromId: string, toId: string): Edge => ({
  id,
  fromId,
  toId,
  name: id,
  props: {},
  createdAt: 0,
  updatedAt: 0,
});

describe('edgeLanes', () => {
  it('keeps a lone edge straight', () => {
    expect(edgeLanes([mkEdge('e1', 'a', 'b')]).get('e1')).toEqual({ offset: 0, loopIndex: 0 });
  });

  it('fans out parallel edges symmetrically', () => {
    const lanes = edgeLanes([mkEdge('e1', 'a', 'b'), mkEdge('e2', 'a', 'b')]);
    const o1 = lanes.get('e1')?.offset ?? 0;
    const o2 = lanes.get('e2')?.offset ?? 0;
    expect(o1).toBe(-o2);
    expect(o1).not.toBe(0);
  });

  it('puts reciprocal edges on different sides in screen space', () => {
    // A→B and B→A: same canonical lane magnitude, sign flipped for the reversed
    // edge, which (with its flipped normal) lands it on the other side.
    const lanes = edgeLanes([mkEdge('e1', 'a', 'b'), mkEdge('e2', 'b', 'a')]);
    expect(lanes.get('e1')?.offset).toBe(lanes.get('e2')?.offset);
  });

  it('numbers self-loops per node', () => {
    const lanes = edgeLanes([mkEdge('l1', 'a', 'a'), mkEdge('l2', 'a', 'a')]);
    expect([lanes.get('l1')?.loopIndex, lanes.get('l2')?.loopIndex]).toEqual([0, 1]);
  });
});

describe('toFlowNodes while dragging', () => {
  it('keeps the dragged position when a snapshot arrives mid-drag', () => {
    const [prev] = toFlowNodes([summary('a', { x: 0, y: 0 })], [], []);
    if (!prev) throw new Error('expected a node');
    const dragged: KmFlowNode = { ...prev, position: { x: 50, y: 60 }, dragging: true };
    const [next] = toFlowNodes([summary('a', { x: 0, y: 0 })], [], [dragged]);
    expect(next?.position).toEqual({ x: 50, y: 60 });
  });
});

describe('toFlowNodes with auto layout (keepPositions)', () => {
  it('leaves dots already on the canvas where the forces put them', () => {
    const prev = toFlowNodes([summary('a', { x: 0, y: 0 })], [], []).map((n) => ({
      ...n,
      position: { x: 300, y: -40 },
    }));
    const next = toFlowNodes(
      [summary('a', { x: 0, y: 0 }), summary('b', { x: 7, y: 8 }), summary('c')],
      [],
      prev,
      DEFAULT_SIZES,
      true,
    );
    expect(next.map((n) => n.position)).toEqual([
      { x: 300, y: -40 }, // kept, not the stored one
      { x: 7, y: 8 }, // new: where it was saved
      fallbackPosition(0), // new, never placed
    ]);
  });
});

describe('toWikilinkEdges', () => {
  const realEdge = (fromId: string, toId: string): Edge => ({
    id: `e-${fromId}-${toId}`,
    fromId,
    toId,
    name: 'REL',
    props: {},
    createdAt: 0,
    updatedAt: 0,
  });
  const on = new Set(['a', 'b', 'c']);

  it('draws one line per pair, whatever the direction', () => {
    const lines = toWikilinkEdges(
      [
        { fromId: 'a', toId: 'b' },
        { fromId: 'b', toId: 'a' },
      ],
      [],
      on,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ type: 'wikilink', selectable: false, deletable: false });
  });

  it('draws none over a real link (either way) or to a dot not on the canvas', () => {
    const lines = toWikilinkEdges(
      [
        { fromId: 'a', toId: 'b' },
        { fromId: 'c', toId: 'x' },
        { fromId: 'b', toId: 'c' },
      ],
      [realEdge('b', 'a')],
      on,
    );
    expect(lines.map((l) => [l.source, l.target])).toEqual([['b', 'c']]);
  });
});
