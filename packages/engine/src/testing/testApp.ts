import type { LevelConfig } from '@km/core';
import type { Database } from '../database.js';
import { createLocalApi } from '../localApi.js';
import { createRepositories } from '../repositories/index.js';
import type { FetchLike } from '../sync/hubClient.js';
import { createSyncService } from '../sync/syncService.js';
import { memoryDb } from './memoryDb.js';

export interface TestApp {
  /** The raw database, to arrange states the API can't produce. */
  db: Database;
  /** Advances the fake clock (ms). */
  tick: (ms?: number) => void;
  /** Like an HTTP call: `url` starts with /api. The caller names the answer's type. */
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
  request: <T = unknown>(
    method: string,
    url: string,
    payload?: unknown,
  ) => Promise<{ status: number; body: T }>;
  close: () => Promise<void>;
}

/**
 * A device with its own fresh database and a deterministic clock, answering
 * the app's API in-process (the engine, as the web app runs it in a Worker).
 */
export function createTestApp(
  options: {
    levelConfig?: LevelConfig;
    fetch?: FetchLike;
    readOnly?: boolean;
    /** Another SQLite underneath (the browser's WebAssembly one); default node:sqlite. */
    db?: Database;
    newId?: () => string;
  } = {},
): Promise<TestApp> {
  const db = options.db ?? memoryDb();
  let clock = 1_700_000_000_000;
  const repos = createRepositories({
    db,
    now: () => clock,
    newId: options.newId ?? (() => crypto.randomUUID()),
  });
  if (options.levelConfig) repos.settings.set('levelConfig', JSON.stringify(options.levelConfig));
  const sync = createSyncService({
    db,
    repos,
    fetch: options.fetch ?? (() => Promise.reject(new TypeError('no network in this test'))),
    suggestedName: 'Test device',
    pullOnly: options.readOnly ?? false,
  });
  const handle = createLocalApi({ repos, sync, readOnly: options.readOnly ?? false });
  return Promise.resolve({
    db,
    tick: (ms = 1) => {
      clock += ms;
    },
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
    request: async <T>(method: string, url: string, payload?: unknown) => {
      // Like JSON over HTTP: copies, never live objects. A string is raw JSON text.
      const body: unknown =
        payload === undefined
          ? undefined
          : JSON.parse(typeof payload === 'string' ? payload : JSON.stringify(payload));
      const res = await handle({ method, path: url.replace(/^\/api/, ''), body });
      let out: unknown;
      try {
        out = res.body === undefined ? undefined : JSON.parse(JSON.stringify(res.body));
      } catch {
        out = res.body; // too deep to stringify: hand it over as is
      }
      return { status: res.status, body: out as T };
    },
    close: () => {
      db.close();
      return Promise.resolve();
    },
  });
}
