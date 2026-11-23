import type { CreateNodeInput, Edge, GraphNode, Tag } from '@km/core';
import { test as base, expect, type APIRequestContext } from '@playwright/test';

/** Thin typed wrapper over the public REST API for arranging test data. */
export class Api {
  constructor(private readonly request: APIRequestContext) {}

  async createNode(input: CreateNodeInput): Promise<GraphNode> {
    const res = await this.request.post('/api/nodes', { data: input });
    expect(res.status()).toBe(201);
    return (await res.json()) as GraphNode;
  }

  async createEdge(fromId: string, toId: string, name: string): Promise<Edge> {
    const res = await this.request.post('/api/edges', { data: { fromId, toId, name } });
    expect(res.status()).toBe(201);
    return (await res.json()) as Edge;
  }

  async createTag(name: string, parentId: string | null = null): Promise<Tag> {
    const res = await this.request.post('/api/tags', { data: { name, parentId } });
    expect(res.status()).toBe(201);
    return (await res.json()) as Tag;
  }

  async createTask(nodeId: string, title: string): Promise<void> {
    const res = await this.request.post('/api/tasks', { data: { nodeId, title } });
    expect(res.status()).toBe(201);
  }

  /** Deletes every node (cascading edges/tasks) and every tag, leaves first. */
  async reset(): Promise<void> {
    const nodes = (await (await this.request.get('/api/nodes?limit=500')).json()) as GraphNode[];
    for (const node of nodes) await this.request.delete(`/api/nodes/${node.id}`);

    for (;;) {
      const tags = (await (await this.request.get('/api/tags')).json()) as Tag[];
      if (tags.length === 0) break;
      const parents = new Set(tags.map((c) => c.parentId));
      for (const leaf of tags.filter((c) => !parents.has(c.id))) {
        await this.request.delete(`/api/tags/${leaf.id}`);
      }
    }
  }
}

export const test = base.extend<{ api: Api; resetDatabase: undefined }>({
  api: async ({ request }, use) => {
    await use(new Api(request));
  },
  // Every test starts from an empty database, whether or not it asks for `api`.
  resetDatabase: [
    async ({ api }, use) => {
      await api.reset();
      await use(undefined);
    },
    { auto: true },
  ],
});

export { expect };
