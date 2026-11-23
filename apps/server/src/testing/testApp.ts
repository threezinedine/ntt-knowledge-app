import type { LevelConfig } from '@km/core';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp, type AppOptions } from '../app.js';
import { IN_MEMORY, openDatabase } from '../db/database.js';

export interface TestApp {
  app: FastifyInstance;
  /** Advances the fake clock (ms). */
  tick: (ms?: number) => void;
  request: <T = unknown>(
    method: NonNullable<InjectOptions['method']>,
    url: string,
    payload?: unknown,
  ) => Promise<{ status: number; body: T }>;
  close: () => Promise<void>;
}

/** A fresh in-memory app with a deterministic clock. */
export async function createTestApp(
  options: { levelConfig?: LevelConfig; auth?: AppOptions['auth'] } = {},
): Promise<TestApp> {
  const db = openDatabase(IN_MEMORY);
  let clock = 1_700_000_000_000;
  const app = await buildApp({ db, now: () => clock, ...options });

  return {
    app,
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
