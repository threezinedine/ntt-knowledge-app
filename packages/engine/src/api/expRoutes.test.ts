import {
  levelConfigSchema,
  type ExpSnapshot,
  type GraphNode,
  type NodeExp,
  type Tag,
} from '@km/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../testing/testApp.js';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp({
    levelConfig: levelConfigSchema.parse({
      expPerNode: 10,
      wordsPerExp: 2,
      maxContentExpPerNode: 3,
      expPerWhy: 1,
      maxWhysExpPerNode: 10,
      levelThresholds: [20, 40],
    }),
  });
});
afterEach(async () => {
  await t.close();
});

const tag = async (name: string, parentId: string | null = null) =>
  (await t.request<Tag>('POST', '/api/tags', { name, parentId })).body;
const node = async (title: string, tagIds: string[], content = '') =>
  (await t.request<GraphNode>('POST', '/api/nodes', { title, tagIds, content })).body;
const exp = async () => (await t.request<ExpSnapshot>('GET', '/api/exp')).body;
const of = (snapshot: ExpSnapshot, tagId: string) => snapshot.tags.find((x) => x.tagId === tagId);

describe('GET /api/exp', () => {
  it('gives each tag EXP from its nodes and rolls it up to the parents', async () => {
    const computer = await tag('Computer');
    const cpu = await tag('CPU', computer.id);
    const gpu = await tag('GPU', computer.id);
    await node('Pipelines', [cpu.id], 'one two three four'); // 10 + 2
    await node('Shaders', [gpu.id]); // 10

    const snapshot = await exp();
    expect(snapshot.maxLevel).toBe(3);
    expect(of(snapshot, cpu.id)).toMatchObject({ exp: 12, nodeCount: 1, level: 1 });
    expect(of(snapshot, gpu.id)).toMatchObject({ exp: 10, level: 1, nextLevelExp: 20 });
    expect(of(snapshot, computer.id)).toEqual({
      tagId: computer.id,
      exp: 22,
      nodeCount: 2,
      level: 2,
      levelStartExp: 20,
      nextLevelExp: 40,
    });
  });

  it('follows edits, untagging and deletes', async () => {
    const cpu = await tag('CPU');
    const n = await node('N', [cpu.id]);
    await t.request('PATCH', `/api/nodes/${n.id}`, { content: 'a b c d e f g h' }); // bonus capped at 3
    expect(of(await exp(), cpu.id)?.exp).toBe(13);

    await t.request('DELETE', `/api/nodes/${n.id}/tags/${cpu.id}`);
    expect(of(await exp(), cpu.id)?.exp).toBe(0);

    await t.request('PUT', `/api/nodes/${n.id}/tags/${cpu.id}`);
    await t.request('DELETE', `/api/nodes/${n.id}`);
    expect(of(await exp(), cpu.id)).toMatchObject({ exp: 0, nodeCount: 0 });
  });

  it('adds answered 5 Whys, doubling per level and capped per node', async () => {
    const cpu = await tag('CPU');
    const n = await node('N', [cpu.id]);
    const q = (question: string, answer: string, children: unknown[] = []) => ({
      question,
      answer,
      children,
    });
    // expPerWhy 1: depth 1 → 1, 2 → 2, 3 → 4; the unanswered one earns 0.
    const created = await t.request<{ id: string }>('POST', `/api/nodes/${n.id}/whys`, {
      whys: [q('a', 'yes', [q('b', 'yes', [q('c', 'yes')]), q('d', '')])],
    });
    expect(created.status).toBe(201);
    expect(of(await exp(), cpu.id)?.exp).toBe(10 + 1 + 2 + 4);

    // A second session adds up, to the cap of 10.
    await t.request('POST', `/api/nodes/${n.id}/whys`, { whys: [q('e', 'yes', [q('f', 'yes')])] });
    expect(of(await exp(), cpu.id)?.exp).toBe(10 + 10);

    await t.request('DELETE', `/api/whys/${created.body.id}`);
    expect(of(await exp(), cpu.id)?.exp).toBe(10 + 1 + 2);

    await t.request('DELETE', `/api/nodes/${n.id}`);
    expect(of(await exp(), cpu.id)?.exp).toBe(0);
  });

  it('follows answers filled in and cleared by PATCH', async () => {
    const cpu = await tag('CPU');
    const n = await node('N', [cpu.id]);
    const q = (question: string, answer: string, children: unknown[] = []) => ({
      question,
      answer,
      children,
    });
    const session = await t.request<{ id: string }>('POST', `/api/nodes/${n.id}/whys`, {
      whys: [q('a', 'yes', [q('b', '')])],
    });
    expect(of(await exp(), cpu.id)?.exp).toBe(10 + 1);

    await t.request('PATCH', `/api/whys/${session.body.id}`, {
      whys: [q('a', 'yes', [q('b', 'now answered')])],
    });
    expect(of(await exp(), cpu.id)?.exp).toBe(10 + 1 + 2);

    await t.request('PATCH', `/api/whys/${session.body.id}`, {
      whys: [q('a', '   ', [q('b', 'now answered')])],
    });
    expect(of(await exp(), cpu.id)?.exp).toBe(10 + 2);
  });

  it('has no way to change the level table', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      expect((await t.request(method, '/api/exp', {})).status).toBe(404);
    }
  });
});

describe('GET /api/exp/nodes', () => {
  it('gives every live node its own EXP and tags, whether tagged or not', async () => {
    const cpu = await tag('CPU');
    const tagged = await node('Tagged', [cpu.id], 'one two three four'); // 10 + 2
    const plain = await node('Plain', []); // 10
    const gone = await node('Gone', []);
    await t.request('DELETE', `/api/nodes/${gone.id}`);

    const res = await t.request<NodeExp[]>('GET', '/api/exp/nodes');
    expect(res.status).toBe(200);
    const byId = new Map(res.body.map((n) => [n.id, n]));
    expect(byId.get(tagged.id)).toEqual({ id: tagged.id, exp: 12, tagIds: [cpu.id] });
    expect(byId.get(plain.id)).toEqual({ id: plain.id, exp: 10, tagIds: [] });
    expect(byId.has(gone.id)).toBe(false);
  });
});
