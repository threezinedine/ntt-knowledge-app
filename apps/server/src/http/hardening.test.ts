import type { ApiErrorBody, Tag, Edge, GraphNode } from '@km/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../testing/testApp.js';
import { hostnameOf } from './hostGuard.js';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.close();
});

describe('host guard (DNS rebinding)', () => {
  it('rejects foreign Host headers and allows loopback', async () => {
    const evil = await t.app.inject({ url: '/api/graph', headers: { host: 'evil.example:4317' } });
    expect(evil.statusCode).toBe(403);
    expect(evil.json<ApiErrorBody>().error.code).toBe('FORBIDDEN_HOST');

    for (const host of ['localhost:4317', '127.0.0.1:4317', '[::1]:4317']) {
      const ok = await t.app.inject({ url: '/api/graph', headers: { host } });
      expect(ok.statusCode, host).toBe(200);
    }
  });

  it('parses hostnames including IPv6 literals', () => {
    expect(hostnameOf('Example.COM:80')).toBe('example.com');
    expect(hostnameOf('[::1]:4317')).toBe('[::1]');
    expect(hostnameOf('127.0.0.1')).toBe('127.0.0.1');
  });
});

describe('error codes', () => {
  it('distinguishes oversized bodies from validation errors', async () => {
    const res = await t.request<ApiErrorBody>('POST', '/api/nodes', {
      title: 'x',
      content: 'a'.repeat(6 * 1024 * 1024),
    });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('rejects null for non-nullable fields', async () => {
    const node = (await t.request<GraphNode>('POST', '/api/nodes', { title: 'x' })).body;
    expect((await t.request('PATCH', `/api/nodes/${node.id}`, { title: null })).status).toBe(400);
  });
});

describe('writes against deleted rows', () => {
  it('404s for PATCH on tombstoned node and edge', async () => {
    const a = (await t.request<GraphNode>('POST', '/api/nodes', { title: 'A' })).body;
    const b = (await t.request<GraphNode>('POST', '/api/nodes', { title: 'B' })).body;
    const edge = (
      await t.request<Edge>('POST', '/api/edges', { fromId: a.id, toId: b.id, name: 'R' })
    ).body;
    await t.request('DELETE', `/api/nodes/${a.id}`);

    expect((await t.request('PATCH', `/api/nodes/${a.id}`, { title: 'z' })).status).toBe(404);
    expect((await t.request('PATCH', `/api/edges/${edge.id}`, { name: 'Z' })).status).toBe(404);
    const list = (await t.request<GraphNode[]>('GET', '/api/nodes')).body;
    expect(list.map((n) => n.title)).toEqual(['B']);
  });
});

describe('ordering and patches', () => {
  it('dragging a node does not move it up the recently-edited list', async () => {
    const a = (await t.request<GraphNode>('POST', '/api/nodes', { title: 'A' })).body;
    t.tick();
    await t.request('POST', '/api/nodes', { title: 'B' });
    t.tick();
    await t.request('PATCH', `/api/nodes/${a.id}`, { position: { x: 1, y: 1 } });

    const list = (await t.request<GraphNode[]>('GET', '/api/nodes')).body;
    expect(list.map((n) => n.title)).toEqual(['B', 'A']);
    expect(list[1]?.position).toEqual({ x: 1, y: 1 });
  });

  it('updates edge props', async () => {
    const a = (await t.request<GraphNode>('POST', '/api/nodes', { title: 'A' })).body;
    const edge = (
      await t.request<Edge>('POST', '/api/edges', { fromId: a.id, toId: a.id, name: 'R' })
    ).body;
    const res = await t.request<Edge>('PATCH', `/api/edges/${edge.id}`, { props: { w: 3 } });
    expect(res.body.props).toEqual({ w: 3 });
  });

  it('renames and recolours a tag; sibling names are unique case-insensitively', async () => {
    const work = (await t.request<Tag>('POST', '/api/tags', { name: 'Work' })).body;
    const dup = await t.request<ApiErrorBody>('POST', '/api/tags', { name: 'work ' });
    expect(dup.status).toBe(409);

    // Same name under a different parent is fine.
    expect((await t.request('POST', '/api/tags', { name: 'Work', parentId: work.id })).status).toBe(
      201,
    );

    const renamed = await t.request<Tag>('PATCH', `/api/tags/${work.id}`, {
      name: 'Job',
      color: '#ff0000',
    });
    expect(renamed.body).toMatchObject({ name: 'Job', color: '#ff0000' });
  });
});
