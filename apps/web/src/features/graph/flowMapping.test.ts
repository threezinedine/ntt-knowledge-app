import type { Edge, NodeSummary } from '@km/core';
import { describe, expect, it } from 'vitest';
import { fallbackPosition, toFlowEdges, toFlowNodes, type KmFlowNode } from './flowMapping';

const summary = (id: string, position: NodeSummary['position'] = null): NodeSummary => ({
  id,
  type: 'note',
  title: id.toUpperCase(),
  position,
});

describe('toFlowNodes', () => {
  it('uses stored positions and lays out unplaced nodes on a grid', () => {
    const nodes = toFlowNodes([summary('a', { x: 5, y: 5 }), summary('b'), summary('c')], []);
    expect(nodes.map((n) => n.position)).toEqual([
      { x: 5, y: 5 },
      fallbackPosition(0),
      fallbackPosition(1),
    ]);
    expect(nodes[0]?.data).toEqual({ label: 'A', nodeType: 'note' });
  });

  it('keeps selection across refetches', () => {
    const prev = toFlowNodes([summary('a'), summary('b')], []).map((n): KmFlowNode =>
      n.id === 'b' ? { ...n, selected: true } : n,
    );
    const next = toFlowNodes([summary('a'), summary('b')], prev);
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
