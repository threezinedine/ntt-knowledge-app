import type { Edge, NodeSummary } from '@km/core';
import { describe, expect, it } from 'vitest';
import { endId, graph3dFailure, toGraph3D } from './graph3dData';

const node = (id: string, position: NodeSummary['position'] = null): NodeSummary => ({
  id,
  type: 'note',
  title: id.toUpperCase(),
  position,
});
const edge = (id: string, fromId: string, toId: string, name = 'R'): Edge => ({
  id,
  fromId,
  toId,
  name,
  props: {},
  createdAt: 0,
  updatedAt: 0,
});

describe('toGraph3D', () => {
  it('maps nodes and links, sizing spheres by link count', () => {
    const g = toGraph3D(
      [node('a'), node('b'), node('c')],
      [edge('e1', 'a', 'b'), edge('e2', 'a', 'c')],
    );
    expect(g.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    const [a, b] = g.nodes;
    expect(a?.radius).toBeGreaterThan(b?.radius ?? Infinity);
    expect(g.links.map((l) => [l.id, endId(l.source), endId(l.target), l.curvature])).toEqual([
      ['e1', 'a', 'b', 0],
      ['e2', 'a', 'c', 0],
    ]);
  });

  it('seeds new nodes from their 2D position, flipping y (screen y points down)', () => {
    const [n] = toGraph3D([node('a', { x: 400, y: 200 })], []).nodes;
    expect(n).toMatchObject({ x: 100, y: -50 });
    expect(n?.z).toBeTypeOf('number');
  });

  it('keeps the engine coordinates of known nodes across refetches', () => {
    const first = toGraph3D([node('a', { x: 0, y: 0 })], []);
    const placed = first.nodes.map((n) => ({ ...n, x: 7, y: 8, z: 9, fx: 7 }));
    const [n] = toGraph3D([{ ...node('a', { x: 0, y: 0 }), title: 'Renamed' }], [], placed).nodes;
    expect(n).toMatchObject({ title: 'Renamed', x: 7, y: 8, z: 9, fx: 7 });
  });

  it('bends parallel and reverse links apart, and always bends self-loops', () => {
    const g = toGraph3D(
      [node('a'), node('b')],
      [
        edge('e1', 'a', 'b'),
        edge('e2', 'a', 'b'),
        edge('e3', 'b', 'a'),
        edge('l1', 'a', 'a'),
        edge('l2', 'a', 'a'),
      ],
    );
    const curve = new Map(g.links.map((l) => [l.id, l.curvature]));
    // Three links on one pair: −0.3, 0, +0.3 in the a→b direction; b→a is flipped.
    expect(curve.get('e1')).toBeCloseTo(-0.3);
    expect(curve.get('e2')).toBeCloseTo(0);
    expect(curve.get('e3')).toBeCloseTo(-0.3); // +0.3 seen from a→b
    expect(curve.get('l1')).toBeCloseTo(0.5);
    expect(curve.get('l2')).toBeCloseTo(0.8);
  });

  it('drops links to nodes that are not in the snapshot', () => {
    expect(toGraph3D([node('a')], [edge('e', 'a', 'gone')]).links).toEqual([]);
  });
});

describe('graph3dFailure', () => {
  it('tells a missing WebGL context from other failures', () => {
    expect(graph3dFailure(new Error('Error creating WebGL context.'))).toBe('webgl');
    expect(
      graph3dFailure(new TypeError('Failed to fetch dynamically imported module: /a.js')),
    ).toBe('other');
    expect(graph3dFailure('boom')).toBe('other');
  });
});
