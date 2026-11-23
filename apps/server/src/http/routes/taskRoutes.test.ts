import type { Category, GraphNode, Task } from '@km/core';
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

const createCategory = async (name: string, parentId: string | null = null) => {
  const res = await t.request<Category>('POST', '/api/categories', { name, parentId });
  expect(res.status).toBe(201);
  return res.body;
};

describe('categories API', () => {
  it('builds a hierarchy', async () => {
    const work = await createCategory('Work');
    const backend = await createCategory('Backend', work.id);
    expect(backend.parentId).toBe(work.id);

    const all = (await t.request<Category[]>('GET', '/api/categories')).body;
    expect(all.map((c) => c.name)).toEqual(['Backend', 'Work']);
  });

  it('404s for a missing parent', async () => {
    const res = await t.request('POST', '/api/categories', {
      name: 'x',
      parentId: '01900000-0000-7000-8000-000000000000',
    });
    expect(res.status).toBe(404);
  });

  it('prevents cycles when re-parenting', async () => {
    const a = await createCategory('A');
    const b = await createCategory('B', a.id);
    const c = await createCategory('C', b.id);

    expect((await t.request('PATCH', `/api/categories/${a.id}`, { parentId: c.id })).status).toBe(
      400,
    );
    expect((await t.request('PATCH', `/api/categories/${a.id}`, { parentId: a.id })).status).toBe(
      400,
    );
    expect((await t.request('PATCH', `/api/categories/${c.id}`, { parentId: null })).status).toBe(
      200,
    );
  });

  it('refuses to delete a category with children; uncategorises tasks on delete', async () => {
    const parent = await createCategory('Parent');
    const child = await createCategory('Child', parent.id);
    expect((await t.request('DELETE', `/api/categories/${parent.id}`)).status).toBe(409);

    const task = (
      await t.request<Task>('POST', '/api/tasks', {
        nodeId: node.id,
        title: 'x',
        categoryId: child.id,
      })
    ).body;
    expect((await t.request('DELETE', `/api/categories/${child.id}`)).status).toBe(204);

    const tasks = (await t.request<Task[]>('GET', `/api/nodes/${node.id}/tasks`)).body;
    expect(tasks.find((x) => x.id === task.id)?.categoryId).toBeNull();
    expect((await t.request('DELETE', `/api/categories/${parent.id}`)).status).toBe(204);
  });
});

describe('tasks API', () => {
  it('creates a task on a node', async () => {
    const res = await t.request<Task>('POST', '/api/tasks', {
      nodeId: node.id,
      title: 'Write spec',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'todo', categoryId: null, completedAt: null });
  });

  it('stamps completedAt on done, keeps it while done, clears it when reopened', async () => {
    const task = (await t.request<Task>('POST', '/api/tasks', { nodeId: node.id, title: 'x' }))
      .body;

    t.tick(500);
    const done = (await t.request<Task>('PATCH', `/api/tasks/${task.id}`, { status: 'done' })).body;
    expect(done.completedAt).toBe(task.createdAt + 500);

    t.tick(500);
    const renamed = (await t.request<Task>('PATCH', `/api/tasks/${task.id}`, { title: 'y' })).body;
    expect(renamed.completedAt).toBe(done.completedAt);

    const reopened = (await t.request<Task>('PATCH', `/api/tasks/${task.id}`, { status: 'doing' }))
      .body;
    expect(reopened.completedAt).toBeNull();
  });

  it('validates node and category references', async () => {
    const missing = '01900000-0000-7000-8000-000000000000';
    expect((await t.request('POST', '/api/tasks', { nodeId: missing, title: 'x' })).status).toBe(
      404,
    );
    expect(
      (await t.request('POST', '/api/tasks', { nodeId: node.id, title: 'x', categoryId: missing }))
        .status,
    ).toBe(404);
    expect(
      (await t.request('POST', '/api/tasks', { nodeId: node.id, title: 'x', status: 'nope' }))
        .status,
    ).toBe(400);
  });

  it('deletes a task', async () => {
    const task = (await t.request<Task>('POST', '/api/tasks', { nodeId: node.id, title: 'x' }))
      .body;
    expect((await t.request('DELETE', `/api/tasks/${task.id}`)).status).toBe(204);
    expect((await t.request<Task[]>('GET', `/api/nodes/${node.id}/tasks`)).body).toEqual([]);
  });
});
