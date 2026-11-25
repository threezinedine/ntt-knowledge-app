import type { CreateNodeInput, Edge, GraphNode, Tag } from '@km/core';
import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * The app keeps its data on the device (the engine Worker, in the browser's
 * private file system), and each test gets a fresh browser context: so every
 * test starts empty. Test data is arranged through that same engine, in the
 * test's page (`window.__kmEngine`); only the hub's own routes go to the
 * e2e server, which is the hub.
 */

/** What a Playwright APIResponse offers that the specs use. */
interface Answer {
  status: () => number;
  ok: () => boolean;
  json: () => Promise<unknown>;
}

const isHubPath = (url: string) => /^\/api\/(hub\/|health)/.test(url);

/** Loads the app in `page` if it isn't yet, so its engine can take requests. */
async function ensureEngine(page: Page): Promise<void> {
  if (!/^https?:/.test(page.url())) await page.goto('/');
  await page.waitForFunction(() => '__kmEngine' in window, null, { timeout: 15_000 });
}

/** One request to the page's engine, as `/api/...` used to go to the server. */
export async function engineCall(
  page: Page,
  method: string,
  url: string,
  data?: unknown,
): Promise<Answer> {
  await ensureEngine(page);
  const res = await page.evaluate(
    async ([m, path, body]) => {
      const engine = (
        window as unknown as {
          __kmEngine: {
            request: (
              m: string,
              p: string,
              b: unknown,
            ) => Promise<{ status: number; body: unknown }>;
          };
        }
      ).__kmEngine;
      return engine.request(m, path, body);
    },
    [method, url.replace(/^\/api/, ''), data] as const,
  );
  return {
    status: () => res.status,
    ok: () => res.status < 400,
    json: () => Promise.resolve(res.body),
  };
}

/**
 * `page.request` for the specs: app paths go to the page's engine (where the
 * data is), hub paths to the server.
 */
function requestShim(page: Page, real: APIRequestContext) {
  const send =
    (method: string) =>
    (url: string, options: { data?: unknown; headers?: Record<string, string> } = {}) =>
      isHubPath(url)
        ? real.fetch(url, { method, data: options.data, headers: options.headers })
        : engineCall(page, method, url, options.data);
  return {
    get: send('GET'),
    post: send('POST'),
    put: send('PUT'),
    patch: send('PATCH'),
    delete: send('DELETE'),
  };
}

/** Typed helpers for arranging test data in the page's engine. */
export class Api {
  constructor(private readonly page: Page) {}

  private async call<T>(method: string, url: string, data: unknown, expected: number): Promise<T> {
    const res = await engineCall(this.page, method, url, data);
    expect(res.status(), `${method} ${url}`).toBe(expected);
    return (await res.json()) as T;
  }

  createNode(input: CreateNodeInput): Promise<GraphNode> {
    return this.call('POST', '/api/nodes', input, 201);
  }

  getNode(id: string): Promise<GraphNode> {
    return this.call('GET', `/api/nodes/${id}`, undefined, 200);
  }

  createEdge(fromId: string, toId: string, name: string): Promise<Edge> {
    return this.call('POST', '/api/edges', { fromId, toId, name }, 201);
  }

  createTag(
    name: string,
    parentId: string | null = null,
    color: string | null = null,
  ): Promise<Tag> {
    return this.call('POST', '/api/tags', { name, parentId, color }, 201);
  }

  /**
   * Pushes this page's data as the hub's newest version (the e2e server is
   * the hub), as another device would.
   */
  async publishToHub(): Promise<void> {
    await this.call(
      'POST',
      '/api/sync/connect',
      { hubUrl: hubUrl(), code: '', deviceName: 'E2E PC' },
      200,
    );
    await this.call('POST', '/api/sync/push', { force: true }, 200);
  }
}

/** The e2e server's own address: it is also the sync hub. */
export const hubUrl = (): string => `http://127.0.0.1:${process.env.KM_E2E_PORT ?? '4399'}`;

export const test = base.extend<{ api: Api }>({
  page: async ({ page }, use) => {
    // Most specs place dots by hand and click them: no auto layout moving them
    // underneath, unless a spec turns it on (forces.spec.ts).
    await page.addInitScript(() => {
      const stored = JSON.parse(localStorage.getItem('km.graph.settings') ?? '{}') as object;
      if (!('autoLayout' in stored)) {
        localStorage.setItem('km.graph.settings', JSON.stringify({ ...stored, autoLayout: false }));
      }
    });
    // The specs' `page.request` reaches the data where it now lives.
    const real = page.request;
    Object.defineProperty(page, 'request', { value: requestShim(page, real), configurable: true });
    await use(page);
  },
  api: async ({ page }, use) => {
    await use(new Api(page));
  },
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
