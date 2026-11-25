import { NODE_CONTENT_MAX, type GraphNode, type WikilinkSyncResult } from '@km/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../testing/testApp.js';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.close();
});

const node = async (title: string, content = '') =>
  (await t.request<GraphNode>('POST', '/api/nodes', { title, content })).body;
const content = async (id: string) =>
  (await t.request<GraphNode>('GET', `/api/nodes/${id}`)).body.content;
const sync = (id: string, created = false) =>
  t.request<WikilinkSyncResult>('POST', `/api/nodes/${id}/wikilinks`, { created });
const rename = (id: string, title: string) => t.request('PATCH', `/api/nodes/${id}`, { title });

describe('POST /api/nodes/:id/wikilinks', () => {
  it('a new node links its mentions in other nodes', async () => {
    const b = await node('Cache notes', 'We put redis in front. Redis is fast.');
    const redis = await node('Redis');
    const res = await sync(redis.id, true);
    expect(res.status).toBe(200);
    expect(res.body.changedIds).toEqual([b.id]);
    expect(await content(b.id)).toBe('We put [[Redis|redis]] in front. [[Redis]] is fast.');
    expect(await content(redis.id)).toBe('');
  });

  it("links other nodes' titles in its own content", async () => {
    await node('Kafka');
    await node('Redis');
    const b = await node('Notes', 'Kafka feeds Redis; Notes stays plain.');
    expect((await sync(b.id)).body.changedIds).toEqual([b.id]);
    expect(await content(b.id)).toBe('[[Kafka]] feeds [[Redis]]; Notes stays plain.');
  });

  it('a rename rewrites links to the old title, and links the new one', async () => {
    const redis = await node('Redis');
    const a = await node('A', 'See [[Redis]] and [[redis|the cache]].');
    const b = await node('B', 'Valkey is a fork.');
    await rename(redis.id, 'Valkey');
    const res = await sync(redis.id);
    expect(res.body.changedIds.sort()).toEqual([a.id, b.id].sort());
    expect(await content(a.id)).toBe('See [[Valkey]] and [[Valkey|the cache]].');
    expect(await content(b.id)).toBe('[[Valkey]] is a fork.');
  });

  it('keeps links to the old title when another node still has it', async () => {
    const first = await node('Redis');
    await node('Redis'); // a second one
    const a = await node('A', 'See [[Redis]].');
    await rename(first.id, 'Valkey');
    await sync(first.id);
    expect(await content(a.id)).toBe('See [[Redis]].');
  });

  it('changes nothing when the title stayed and nothing is mentioned', async () => {
    const a = await node('Alpha', 'plain text');
    await node('Beta', 'Alpha is mentioned here');
    // Title unchanged: other nodes are not rescanned for it.
    expect((await sync(a.id)).body.changedIds).toEqual([]);
  });

  it('does not link a node to another with the same title', async () => {
    await node('Redis', 'Redis twin');
    const b = await node('Redis', 'Redis here');
    expect((await sync(b.id, true)).body.changedIds).toEqual([]);
  });

  it('a rewrite is an ordinary edit: newer updated_at', async () => {
    const b = await node('B', 'about Kafka');
    const before = (await t.request<GraphNode>('GET', `/api/nodes/${b.id}`)).body.updatedAt;
    t.tick(1000);
    const kafka = await node('Kafka');
    await sync(kafka.id, true);
    const after = (await t.request<GraphNode>('GET', `/api/nodes/${b.id}`)).body.updatedAt;
    expect(after).toBeGreaterThan(before);
  });

  it('a rename onto a title another node has keeps the links as they are', async () => {
    const foo = await node('Foo');
    await node('Bar'); // links to "Bar" mean this one
    const a = await node('A', 'See [[Foo]].');
    await rename(foo.id, 'Bar');
    await sync(foo.id);
    expect(await content(a.id)).toBe('See [[Foo]].');
  });

  it('remembers a rename until links follow, also across a closed tab', async () => {
    const redis = await node('Redis');
    const a = await node('A', 'See [[Redis]].');
    await rename(redis.id, 'Valkey');
    await rename(redis.id, 'Valkey 2'); // the first old title is the one links have
    // The page never settled (tab closed); the next start does it.
    const res = await t.request<WikilinkSyncResult>('POST', '/api/wikilinks/pending');
    expect(res.body.changedIds).toEqual([a.id]);
    expect(await content(a.id)).toBe('See [[Valkey 2]].');
    // Done: nothing left.
    expect((await t.request<WikilinkSyncResult>('POST', '/api/wikilinks/pending')).body).toEqual({
      changedIds: [],
    });
  });

  it('skips a rewrite that would make the content too long', async () => {
    const long = 'Kafka '.repeat(NODE_CONTENT_MAX / 6 - 1);
    const b = await node('B', long);
    const kafka = await node('Kafka');
    expect((await sync(kafka.id, true)).body.changedIds).toEqual([]);
    expect(await content(b.id)).toBe(long);
  });

  it('validates its input and the node', async () => {
    const a = await node('A');
    expect((await t.request('POST', `/api/nodes/${a.id}/wikilinks`, {})).status).toBe(400);
    expect((await sync(crypto.randomUUID())).status).toBe(404);
  });

  it('is refused on a read-only device', async () => {
    const ro = await createTestApp({ readOnly: true });
    const res = await ro.request('POST', `/api/nodes/${crypto.randomUUID()}/wikilinks`, {
      created: false,
    });
    expect(res.status).toBe(403);
    await ro.close();
  });
});
