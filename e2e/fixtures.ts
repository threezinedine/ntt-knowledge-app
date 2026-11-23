import type { Category, CreateNodeInput, Edge, GraphNode } from '@km/core';
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

  /** Deletes every node (cascading edges/tasks) and every category, leaves first. */
  async reset(): Promise<void> {
    const nodes = (await (await this.request.get('/api/nodes?limit=500')).json()) as GraphNode[];
    for (const node of nodes) await this.request.delete(`/api/nodes/${node.id}`);

    for (;;) {
      const cats = (await (await this.request.get('/api/categories')).json()) as Category[];
      if (cats.length === 0) break;
      const parents = new Set(cats.map((c) => c.parentId));
      for (const leaf of cats.filter((c) => !parents.has(c.id))) {
        await this.request.delete(`/api/categories/${leaf.id}`);
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
