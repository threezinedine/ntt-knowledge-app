import type { ApiErrorBody, Edge, GraphNode, GraphSnapshot, NodeEdges } from '@km/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../testing/testApp.js';

let t: TestApp;
let a: GraphNode;
let b: GraphNode;

beforeEach(async () => {
  t = await createTestApp();
  a = (await t.request<GraphNode>('POST', '/api/nodes', { title: 'Alpha' })).body;
  b = (await t.request<GraphNode>('POST', '/api/nodes', { title: 'Beta' })).body;
});
afterEach(async () => {
  await t.close();
});

const link = (fromId: string, toId: string, name: string, props?: object) =>
  t.request<Edge & ApiErrorBody>('POST', '/api/edges', { fromId, toId, name, props });

describe('edges API', () => {
  it('creates a directed, named edge visible from both ends', async () => {
    const res = await link(a.id, b.id, 'DEPENDS_ON', { weight: 2 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      fromId: a.id,
      toId: b.id,
      name: 'DEPENDS_ON',
      props: { weight: 2 },
    });

    const fromA = (await t.request<NodeEdges>('GET', `/api/nodes/${a.id}/edges`)).body;
    expect(fromA.outgoing.map((e) => [e.edge.name, e.neighbor.title])).toEqual([
      ['DEPENDS_ON', 'Beta'],
    ]);
    expect(fromA.incoming).toEqual([]);

    const fromB = (await t.request<NodeEdges>('GET', `/api/nodes/${b.id}/edges`)).body;
    expect(fromB.incoming.map((e) => [e.edge.name, e.neighbor.title])).toEqual([
      ['DEPENDS_ON', 'Alpha'],
    ]);
  });

  it('allows opposite directions and different names, but not exact duplicates', async () => {
    expect((await link(a.id, b.id, 'R')).status).toBe(201);
    expect((await link(b.id, a.id, 'R')).status).toBe(201);
    expect((await link(a.id, b.id, 'OTHER')).status).toBe(201);

    const dup = await link(a.id, b.id, 'R');
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatchObject({ code: 'CONFLICT', reason: 'EDGE_EXISTS' });
  });

  it('allows recreating an edge after it was deleted', async () => {
    const first = await link(a.id, b.id, 'R');
    expect((await t.request('DELETE', `/api/edges/${first.body.id}`)).status).toBe(204);
    expect((await link(a.id, b.id, 'R')).status).toBe(201);
  });

  it('allows self-loops', async () => {
    expect((await link(a.id, a.id, 'SELF')).status).toBe(201);
  });

  it('404s when an endpoint does not exist', async () => {
    const res = await link(a.id, '01900000-0000-7000-8000-000000000000', 'R');
    expect(res.status).toBe(404);
  });

  it('renames an edge and rejects renaming into a duplicate', async () => {
    const r1 = (await link(a.id, b.id, 'R1')).body;
    await link(a.id, b.id, 'R2');

    const renamed = await t.request<Edge>('PATCH', `/api/edges/${r1.id}`, { name: 'R3' });
    expect(renamed.body.name).toBe('R3');

    const clash = await t.request('PATCH', `/api/edges/${r1.id}`, { name: 'R2' });
    expect(clash.status).toBe(409);
  });

  it('rejects changing endpoints via PATCH', async () => {
    const edge = (await link(a.id, b.id, 'R')).body;
    const res = await t.request('PATCH', `/api/edges/${edge.id}`, { toId: a.id });
    expect(res.status).toBe(400);
  });

  it('exposes the graph snapshot and distinct relation names', async () => {
    await link(a.id, b.id, 'beta');
    await link(b.id, a.id, 'Alpha');
    await link(a.id, a.id, 'beta');

    const graph = (await t.request<GraphSnapshot>('GET', '/api/graph')).body;
    expect(graph.nodes.map((n) => n.title).sort()).toEqual(['Alpha', 'Beta']);
    expect(graph.edges).toHaveLength(3);

    const names = (await t.request<string[]>('GET', '/api/relations')).body;
    expect(names).toEqual(['Alpha', 'beta']);
  });
});
