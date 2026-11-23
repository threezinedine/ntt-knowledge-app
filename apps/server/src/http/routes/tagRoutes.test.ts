import { MAX_TAGS_PER_ITEM, type ApiErrorBody, type GraphNode, type Tag } from '@km/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../testing/testApp.js';

let t: TestApp;
let node: GraphNode;

beforeEach(async () => {
  t = await createTestApp();
  node = (await t.request<GraphNode>('POST', '/api/nodes', { title: 'Project' })).body;
});
afterEach(async () => {
  await t.close();
});

const createTag = async (name: string, parentId: string | null = null) => {
  const res = await t.request<Tag>('POST', '/api/tags', { name, parentId });
  expect(res.status).toBe(201);
  return res.body;
};

const MISSING = '01900000-0000-7000-8000-000000000000';

describe('tags API (tree)', () => {
  it('builds a hierarchy', async () => {
    const work = await createTag('Work');
    const backend = await createTag('Backend', work.id);
    expect(backend.parentId).toBe(work.id);

    const all = (await t.request<Tag[]>('GET', '/api/tags')).body;
    expect(all.map((c) => c.name)).toEqual(['Backend', 'Work']);
  });

  it('404s for a missing parent', async () => {
    expect((await t.request('POST', '/api/tags', { name: 'x', parentId: MISSING })).status).toBe(
      404,
    );
  });

  it('prevents cycles when re-parenting', async () => {
    const a = await createTag('A');
    const b = await createTag('B', a.id);
    const c = await createTag('C', b.id);

    const cycle = await t.request<ApiErrorBody>('PATCH', `/api/tags/${a.id}`, { parentId: c.id });
    expect(cycle.status).toBe(400);
    expect(cycle.body.error.reason).toBe('TAG_CYCLE');
    expect((await t.request('PATCH', `/api/tags/${a.id}`, { parentId: a.id })).status).toBe(400);
    expect((await t.request('PATCH', `/api/tags/${c.id}`, { parentId: null })).status).toBe(200);
  });

  it('refuses to delete a tag with children; detaches it everywhere on delete', async () => {
    const parent = await createTag('Parent');
    const child = await createTag('Child', parent.id);
    const refused = await t.request<ApiErrorBody>('DELETE', `/api/tags/${parent.id}`);
    expect(refused.status).toBe(409);
    expect(refused.body.error.reason).toBe('TAG_HAS_CHILDREN');

    await t.request('PUT', `/api/nodes/${node.id}/tags/${child.id}`);
    expect((await t.request('DELETE', `/api/tags/${child.id}`)).status).toBe(204);

    expect((await t.request<GraphNode>('GET', `/api/nodes/${node.id}`)).body.tagIds).toEqual([]);
  });

  it('409s on sibling name clashes (any case), on create, rename and move', async () => {
    const work = await createTag('Work');
    expect((await t.request('POST', '/api/tags', { name: 'work ' })).status).toBe(409);

    await createTag('backend', work.id);
    const stray = await createTag('Backend');
    const moved = await t.request<ApiErrorBody>('PATCH', `/api/tags/${stray.id}`, {
      parentId: work.id,
    });
    expect(moved.status).toBe(409);
    expect(moved.body.error).toMatchObject({ code: 'CONFLICT', reason: 'TAG_NAME_TAKEN' });

    const other = await createTag('Other');
    expect((await t.request('PATCH', `/api/tags/${other.id}`, { name: 'WORK' })).status).toBe(409);
  });

  it('clears the colour with explicit null and keeps it when omitted', async () => {
    const c = (await t.request<Tag>('POST', '/api/tags', { name: 'C', color: '#112233' })).body;
    const renamed = await t.request<Tag>('PATCH', `/api/tags/${c.id}`, { name: 'D' });
    expect(renamed.body.color).toBe('#112233');
    const cleared = await t.request<Tag>('PATCH', `/api/tags/${c.id}`, { color: null });
    expect(cleared.body.color).toBeNull();
  });

  it('the old /api/categories endpoint is gone', async () => {
    expect((await t.request('GET', '/api/categories')).status).toBe(404);
  });
});

describe('attaching tags', () => {
  it('a node can carry many tags; attach and detach are idempotent', async () => {
    const a = await createTag('A');
    const b = await createTag('B');

    const once = await t.request<GraphNode>('PUT', `/api/nodes/${node.id}/tags/${a.id}`);
    expect(once.status).toBe(200);
    await t.request('PUT', `/api/nodes/${node.id}/tags/${a.id}`); // again: no-op
    const both = await t.request<GraphNode>('PUT', `/api/nodes/${node.id}/tags/${b.id}`);
    expect(both.body.tagIds).toEqual([a.id, b.id].sort());

    const detached = await t.request<GraphNode>('DELETE', `/api/nodes/${node.id}/tags/${a.id}`);
    expect(detached.body.tagIds).toEqual([b.id]);
    const again = await t.request<GraphNode>('DELETE', `/api/nodes/${node.id}/tags/${a.id}`);
    expect(again.status).toBe(200);
    expect(again.body.tagIds).toEqual([b.id]);
  });

  it('lists nodes with their tags', async () => {
    const tag = await createTag('T');
    await t.request('PUT', `/api/nodes/${node.id}/tags/${tag.id}`);
    const list = (await t.request<GraphNode[]>('GET', '/api/nodes')).body;
    expect(list[0]?.tagIds).toEqual([tag.id]);
  });

  it('404s for a missing owner or tag, 400 for malformed ids', async () => {
    const tag = await createTag('T');
    expect((await t.request('PUT', `/api/nodes/${MISSING}/tags/${tag.id}`)).status).toBe(404);
    expect((await t.request('PUT', `/api/nodes/${node.id}/tags/${MISSING}`)).status).toBe(404);
    expect((await t.request('PUT', `/api/nodes/${node.id}/tags/nope`)).status).toBe(400);
  });

  it(`caps tags per item at ${MAX_TAGS_PER_ITEM}`, async () => {
    for (let i = 0; i < MAX_TAGS_PER_ITEM; i++) {
      const tag = await createTag(`tag-${i}`);
      await t.request('PUT', `/api/nodes/${node.id}/tags/${tag.id}`);
    }
    const extra = await createTag('one-too-many');
    const over = await t.request<ApiErrorBody>('PUT', `/api/nodes/${node.id}/tags/${extra.id}`);
    expect(over.status).toBe(400);
    expect(over.body.error.reason).toBe('TAG_LIMIT_REACHED');
  });
});
