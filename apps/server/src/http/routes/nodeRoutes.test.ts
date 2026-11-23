import type { ApiErrorBody, Edge, GraphNode, NodeEdges, Task } from '@km/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../testing/testApp.js';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.close();
});

const createNode = async (title: string, extra: Record<string, unknown> = {}) => {
  const res = await t.request<GraphNode>('POST', '/api/nodes', { title, ...extra });
  expect(res.status).toBe(201);
  return res.body;
};

describe('nodes API', () => {
  it('creates a node with defaults and reads it back', async () => {
    const node = await createNode('First');
    expect(node).toMatchObject({
      title: 'First',
      type: 'note',
      content: '',
      props: {},
      position: null,
    });

    const fetched = await t.request<GraphNode>('GET', `/api/nodes/${node.id}`);
    expect(fetched.body).toEqual(node);
  });

  it('round-trips nested JSON props and positions', async () => {
    const props = { tags: ['x'], score: 3.5, nested: { ok: true } };
    const node = await createNode('Props', { props, position: { x: 10, y: -20 } });
    const fetched = await t.request<GraphNode>('GET', `/api/nodes/${node.id}`);
    expect(fetched.body.props).toEqual(props);
    expect(fetched.body.position).toEqual({ x: 10, y: -20 });
  });

  it('patches only provided fields and bumps updatedAt', async () => {
    const node = await createNode('Old', { content: 'body' });
    t.tick(1000);
    const res = await t.request<GraphNode>('PATCH', `/api/nodes/${node.id}`, { title: 'New' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ title: 'New', content: 'body', createdAt: node.createdAt });
    expect(res.body.updatedAt).toBe(node.updatedAt + 1000);
  });

  it('clears position with explicit null', async () => {
    const node = await createNode('Pos', { position: { x: 1, y: 2 } });
    const res = await t.request<GraphNode>('PATCH', `/api/nodes/${node.id}`, { position: null });
    expect(res.body.position).toBeNull();
  });

  it('searches titles case-insensitively and treats LIKE wildcards literally', async () => {
    await createNode('Graph theory');
    await createNode('100% done');
    await createNode('Cooking');

    const graph = await t.request<GraphNode[]>('GET', '/api/nodes?q=GRAPH');
    expect(graph.body.map((n) => n.title)).toEqual(['Graph theory']);

    const percent = await t.request<GraphNode[]>('GET', '/api/nodes?q=%25');
    expect(percent.body.map((n) => n.title)).toEqual(['100% done']);
  });

  it('lists most recently updated first', async () => {
    const a = await createNode('A');
    t.tick();
    await createNode('B');
    t.tick();
    await t.request('PATCH', `/api/nodes/${a.id}`, { content: 'touched' });

    const res = await t.request<GraphNode[]>('GET', '/api/nodes');
    expect(res.body.map((n) => n.title)).toEqual(['A', 'B']);
  });

  it('rejects invalid input with a structured 400', async () => {
    const res = await t.request<ApiErrorBody>('POST', '/api/nodes', { title: '' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');

    const unknownKey = await t.request<ApiErrorBody>('POST', '/api/nodes', {
      title: 'x',
      bogus: 1,
    });
    expect(unknownKey.status).toBe(400);
  });

  it('returns 400 for a malformed id and 404 for a missing one', async () => {
    expect((await t.request('GET', '/api/nodes/not-a-uuid')).status).toBe(400);
    const missing = await t.request<ApiErrorBody>(
      'GET',
      '/api/nodes/01900000-0000-7000-8000-000000000000',
    );
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });

  it('soft-deletes a node and cascades to its edges and tasks', async () => {
    const a = await createNode('A');
    const b = await createNode('B');
    await t.request<Edge>('POST', '/api/edges', { fromId: a.id, toId: b.id, name: 'LINKS' });
    await t.request<Task>('POST', '/api/tasks', { nodeId: a.id, title: 'Do it' });

    expect((await t.request('DELETE', `/api/nodes/${a.id}`)).status).toBe(204);
    expect((await t.request('GET', `/api/nodes/${a.id}`)).status).toBe(404);
    expect((await t.request('DELETE', `/api/nodes/${a.id}`)).status).toBe(404);

    const bEdges = await t.request<NodeEdges>('GET', `/api/nodes/${b.id}/edges`);
    expect(bEdges.body.incoming).toEqual([]);
    const graph = await t.request<{ nodes: unknown[]; edges: unknown[] }>('GET', '/api/graph');
    expect(graph.body.nodes).toHaveLength(1);
    expect(graph.body.edges).toHaveLength(0);
  });

  it('returns JSON 404 for unknown API routes', async () => {
    const res = await t.request<ApiErrorBody>('GET', '/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
