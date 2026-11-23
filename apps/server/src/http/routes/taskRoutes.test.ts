import type { GraphNode, Tag, Task } from '@km/core';
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

describe('tasks API', () => {
  it('creates a task on a node', async () => {
    const res = await t.request<Task>('POST', '/api/tasks', {
      nodeId: node.id,
      title: 'Write spec',
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: 'todo', tagIds: [], completedAt: null });
  });

  it('creates a task with several tags at once', async () => {
    const a = (await t.request<Tag>('POST', '/api/tags', { name: 'A' })).body;
    const b = (await t.request<Tag>('POST', '/api/tags', { name: 'B' })).body;
    const res = await t.request<Task>('POST', '/api/tasks', {
      nodeId: node.id,
      title: 'x',
      tagIds: [a.id, b.id, a.id],
    });
    expect(res.status).toBe(201);
    expect(res.body.tagIds).toEqual([a.id, b.id].sort());
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

  it('validates node and tag references', async () => {
    const missing = '01900000-0000-7000-8000-000000000000';
    expect((await t.request('POST', '/api/tasks', { nodeId: missing, title: 'x' })).status).toBe(
      404,
    );
    expect(
      (await t.request('POST', '/api/tasks', { nodeId: node.id, title: 'x', tagIds: [missing] }))
        .status,
    ).toBe(404);
    expect(
      (await t.request('POST', '/api/tasks', { nodeId: node.id, title: 'x', status: 'nope' }))
        .status,
    ).toBe(400);
    // The old single-category field is gone.
    expect(
      (await t.request('POST', '/api/tasks', { nodeId: node.id, title: 'x', categoryId: null }))
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
