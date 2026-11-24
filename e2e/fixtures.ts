import type { CreateNodeInput, Edge, GraphNode, Tag } from '@km/core';
import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';

/** Thin typed wrapper over the public REST API for arranging test data. */
export class Api {
  constructor(private readonly request: APIRequestContext) {}

  async createNode(input: CreateNodeInput): Promise<GraphNode> {
    const res = await this.request.post('/api/nodes', { data: input });
    expect(res.status()).toBe(201);
    return (await res.json()) as GraphNode;
  }

  async getNode(id: string): Promise<GraphNode> {
    const res = await this.request.get(`/api/nodes/${id}`);
    expect(res.status()).toBe(200);
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

  /**
   * Makes the server's current data the hub's newest version (the e2e server
   * is its own hub), as another PC would by pushing.
   */
  async publishToHub(): Promise<void> {
    const connect = await this.request.post('/api/sync/connect', {
      data: { hubUrl: hubUrl(), code: '', deviceName: 'E2E PC' },
    });
    expect(connect.status()).toBe(200);
    expect((await this.request.post('/api/sync/push', { data: { force: true } })).status()).toBe(
      200,
    );
  }

  /** Deletes every node (cascading edges) and every tag, leaves first; forgets the hub. */
  async reset(): Promise<void> {
    await this.request.delete('/api/sync');
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

/** The e2e server's own address: it is also the sync hub. */
export const hubUrl = (): string => `http://127.0.0.1:${process.env.KM_E2E_PORT ?? '4399'}`;

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

/** What the Android app's WebView looks like to the page (Capacitor's bridge). */
export const asPhoneApp = (page: Page) =>
  page.addInitScript({
    content: 'window.Capacitor = { isNativePlatform: () => true, getPlatform: () => "android" };',
  });

/** Opens the Sync dialog from the title bar (whatever state it shows). */
export const openSync = (page: Page) =>
  page
    .getByRole('banner')
    .getByRole('button', {
      name: /^(Sync|Up to date|A newer version|Changes|Changed here|Offline)/,
    })
    .click();

/**
 * The phone app as it is used: the PC pushed its data to the hub (the e2e
 * server is its own hub), and the phone connected and pulled a copy.
 */
export async function phoneWithCopy(page: Page, api: Api): Promise<void> {
  await api.publishToHub();
  await asPhoneApp(page);
  await page.goto('/');
  await openSync(page);
  const dialog = page.getByRole('dialog', { name: 'Sync' });
  await dialog.getByLabel('Hub address').fill(hubUrl());
  await dialog.getByRole('button', { name: 'Connect' }).click();
  await dialog.getByRole('button', { name: 'Pull', exact: true }).click();
  await expect(page.locator('.toast', { hasText: 'Pulled version' })).toBeVisible();
}
