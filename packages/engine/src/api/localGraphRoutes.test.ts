import type { ApiErrorBody, Edge, GraphNode, LocalGraph } from '@km/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../testing/testApp.js';

let t: TestApp;
const n: Record<string, GraphNode> = {};

const node = async (title: string, content = '') =>
  (await t.request<GraphNode>('POST', '/api/nodes', { title, content })).body;
const link = async (from: GraphNode, to: GraphNode, name: string) =>
  (await t.request<Edge>('POST', '/api/edges', { fromId: from.id, toId: to.id, name })).body;
const local = (id: string, query = '') =>
  t.request<LocalGraph & ApiErrorBody>('GET', `/api/nodes/${id}/local-graph${query}`);

// CPU -USES-> Cache -PART_OF-> Memory -STORES-> Data; Compiler -TARGETS-> CPU; Alone
beforeEach(async () => {
  t = await createTestApp();
  for (const title of ['CPU', 'Cache', 'Memory', 'Data', 'Compiler', 'Alone']) {
    n[title] = await node(title, `About ${title}`);
  }
  const at = (k: string) => n[k] as GraphNode;
  await link(at('CPU'), at('Cache'), 'USES');
  await link(at('Cache'), at('Memory'), 'PART_OF');
  await link(at('Memory'), at('Data'), 'STORES');
  await link(at('Compiler'), at('CPU'), 'TARGETS');
});
afterEach(async () => {
  await t.close();
});

const id = (k: string) => (n[k] as GraphNode).id;
const titles = (g: LocalGraph) => g.nodes.map((x) => [x.title, x.distance]);
const names = (edges: readonly Edge[]) => edges.map((e) => e.name).sort();

describe('local graph API', () => {
  it('level 1: the node and its direct neighbours both ways, with full data', async () => {
    const res = await local(id('CPU'));
    expect(res.status).toBe(200);
    expect(res.body.depth).toBe(1);
    expect(titles(res.body)).toEqual([
      ['CPU', 0],
      ['Cache', 1],
      ['Compiler', 1],
    ]);
    expect(res.body.nodes[0]).toMatchObject({ content: 'About CPU', tagIds: [] });
    expect(names(res.body.edges)).toEqual(['TARGETS', 'USES']);
    // Cache -PART_OF-> Memory leaves the scope: context only, with Memory's title.
    expect(res.body.boundary.map((b) => [b.edge.name, b.outside])).toEqual([
      ['PART_OF', { id: id('Memory'), title: 'Memory' }],
    ]);
  });

  it('level 2 and 3 reach further; at full reach nothing is left at the boundary', async () => {
    const two = (await local(id('CPU'), '?depth=2')).body;
    expect(titles(two)).toEqual([
      ['CPU', 0],
      ['Cache', 1],
      ['Compiler', 1],
      ['Memory', 2],
    ]);
    expect(two.boundary.map((b) => b.outside.title)).toEqual(['Data']);
    const three = (await local(id('CPU'), '?depth=3')).body;
    expect(three.nodes).toHaveLength(5);
    expect(names(three.edges)).toEqual(['PART_OF', 'STORES', 'TARGETS', 'USES']);
    expect(three.boundary).toEqual([]);
  });

  it('a node without links is its own local graph', async () => {
    const res = (await local(id('Alone'), '?depth=3')).body;
    expect(titles(res)).toEqual([['Alone', 0]]);
    expect(res.edges).toEqual([]);
  });

  it('leaves out deleted nodes and links', async () => {
    await t.request('DELETE', `/api/nodes/${id('Compiler')}`);
    const res = (await local(id('CPU'))).body;
    expect(titles(res)).toEqual([
      ['CPU', 0],
      ['Cache', 1],
    ]);
    expect(names(res.edges)).toEqual(['USES']);
  });

  it('does not walk through a deleted node whose links were not tombstoned (sync)', async () => {
    // Memory deleted, but its links left live, as a sync could leave them.
    t.db.prepare('UPDATE nodes SET deleted_at = 1 WHERE id = ?').run(id('Memory'));
    const res = (await local(id('CPU'), '?depth=3')).body;
    expect(titles(res).map(([title]) => title)).toEqual(['CPU', 'Cache', 'Compiler']);
    expect(names(res.edges)).toEqual(['TARGETS', 'USES']);
    expect(res.boundary).toEqual([]);
  });

  it('validates depth and 404s for an unknown node', async () => {
    for (const q of ['?depth=0', '?depth=4', '?depth=x', '?depth=1&extra=1']) {
      const res = await local(id('CPU'), q);
      expect(res.status, q).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect((await local('0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b')).status).toBe(404);
  });
});
