import type { LevelConfig } from '@km/core';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp, type AppOptions } from '../app.js';
import type { FetchLike } from '@km/engine';
import { IN_MEMORY, openDatabase, type Database } from '../db/database.js';

export interface TestApp {
  app: FastifyInstance;
  /** The raw database, to arrange states the API can't produce. */
  db: Database;
  /** Advances the fake clock (ms). */
  tick: (ms?: number) => void;
  request: <T = unknown>(
    method: NonNullable<InjectOptions['method']>,
    url: string,
    payload?: unknown,
  ) => Promise<{ status: number; body: T }>;
  close: () => Promise<void>;
}

/** A fresh in-memory hub (the server) with a deterministic clock. */
export async function createTestApp(
  options: {
    levelConfig?: LevelConfig;
    auth?: AppOptions['auth'];
    hub?: AppOptions['hub'];
  } = {},
): Promise<TestApp> {
  const db = openDatabase(IN_MEMORY);
  let clock = 1_700_000_000_000;
  const app = await buildApp({ db, now: () => clock, ...options });

  return {
    app,
    db,
    tick: (ms = 1) => {
      clock += ms;
    },
    request: async <T>(
      method: NonNullable<InjectOptions['method']>,
      url: string,
      payload?: unknown,
    ) => {
      const res = await app.inject(
        payload === undefined ? { method, url } : { method, url, payload: payload as object },
      );
      return { status: res.statusCode, body: (res.body ? res.json() : undefined) as T };
    },
    close: async () => {
      await app.close();
      db.close();
    },
  };
}

/**
 * A `fetch` that sends requests to `target` in-process (`app.inject`), so one
 * test app can sync with another as its hub. A URL starting with
 * `http://unreachable` fails like a network error.
 */
export function injectFetch(target: () => FastifyInstance): FetchLike {
  return async (url, init) => {
    if (url.startsWith('http://unreachable')) throw new TypeError('fetch failed');
    const { pathname, search } = new URL(url);
    const res = await target().inject({
      method: (init.method ?? 'GET') as 'GET' | 'POST' | 'DELETE',
      url: pathname + search,
      headers: init.headers as Record<string, string>,
      ...(typeof init.body === 'string' ? { payload: init.body } : {}),
    });
    return new Response(res.statusCode === 204 ? null : res.rawPayload, {
      status: res.statusCode,
      headers: { 'content-type': res.headers['content-type'] ?? 'application/json' },
    });
  };
}
