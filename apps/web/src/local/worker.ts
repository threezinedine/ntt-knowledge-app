/// <reference lib="webworker" />
import { newId } from '@km/core';
import {
  configure,
  createLocalApi,
  createRepositories,
  createSyncService,
  markdownExport,
  migrate,
  migrations,
  type Database,
  type FetchLike,
  type LocalApi,
  type Repositories,
} from '@km/engine';
import sqlite3InitModule, { type SAHPoolUtil, type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import type { FetchInit, FetchResult, FromWorker, Storage, ToWorker } from './protocol';
import { wasmDatabase } from './wasmDatabase';

/**
 * This device's copy of the graph and everything done with it: SQLite
 * (WebAssembly) with its file in the site's private file system (OPFS), the
 * same schema and repositories as the hub, and the app's API answered right
 * here (@km/engine localApi). Only sync goes out, through the page.
 */
declare const self: DedicatedWorkerGlobalScope;

const FILE = '/km.sqlite';
const post = (message: FromWorker, transfer: Transferable[] = []) => {
  self.postMessage(message, transfer);
};

let sqlite3: Sqlite3Static;
let pool: SAHPoolUtil | null = null;
let db: Database;
let repos: Repositories;
let handle: LocalApi;
let options: { readOnly: boolean; suggestedName: string };

// Requests to the hub go through the page (on the phone, its fetch is native).
let fetchSeq = 0;
const pendingFetches = new Map<number, (r: FetchResult) => void>();
const fetchViaPage: FetchLike = (url, init) =>
  new Promise<Response>((resolve, reject) => {
    const id = ++fetchSeq;
    pendingFetches.set(id, (r) => {
      // A native HTTP layer can report odd statuses (-1): treat them as no answer.
      if (r.error !== undefined || r.status < 200 || r.status > 599) {
        reject(new TypeError(r.error ?? `No HTTP answer (${String(r.status)})`));
        return;
      }
      resolve(new Response(r.status === 204 ? null : r.text, { status: r.status }));
    });
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const message: FetchInit = {
      method: init.method ?? 'GET',
      headers,
      body: typeof init.body === 'string' ? init.body : null,
      // The engine's time limit, enforced by the page (a signal can't cross over).
      timeoutMs: timeoutOf(init.signal),
    };
    post({ type: 'fetch', id, url, init: message });
  });

/** HubClient passes AbortSignal.timeout(ms); the page needs the number. */
const timeouts = new WeakMap<AbortSignal, number>();
const realTimeout = AbortSignal.timeout.bind(AbortSignal);
AbortSignal.timeout = (ms: number) => {
  const signal = realTimeout(ms);
  timeouts.set(signal, ms);
  return signal;
};
const timeoutOf = (signal: AbortSignal | null | undefined): number =>
  (signal ? timeouts.get(signal) : undefined) ?? 30_000;

/**
 * A database file the user picked, checked and cleaned in memory before it
 * replaces anything: it must be a Knowledge Manager database this version can
 * open (migrated here, on the copy), and it loses the device-local secrets of
 * wherever it came from (its hub link and token, a hub's devices and versions).
 */
function prepareImport(bytes: Uint8Array): Uint8Array {
  const mem = new sqlite3.oo1.DB(':memory:');
  try {
    const p = sqlite3.wasm.allocFromTypedArray(bytes);
    const capi = sqlite3.capi;
    const rc = capi.sqlite3_deserialize(
      mem.pointer as never,
      'main',
      p,
      bytes.byteLength,
      bytes.byteLength,
      capi.SQLITE_DESERIALIZE_FREEONCLOSE | capi.SQLITE_DESERIALIZE_RESIZEABLE,
    );
    if (rc !== 0) throw new Error('Not an SQLite database');
    const copy = wasmDatabase(sqlite3, mem);
    const check = copy.prepare('PRAGMA quick_check').get() as Record<string, unknown> | undefined;
    if (Object.values(check ?? {})[0] !== 'ok') throw new Error('The database file is damaged');
    const version = (copy.prepare('PRAGMA user_version').get() as { user_version: number })
      .user_version;
    if (version === 0) throw new Error('Not a Knowledge Manager database');
    if (version > migrations.length) throw new Error('Made by a newer version of the app');
    configure(copy);
    migrate(copy);
    copy.exec(
      'DELETE FROM sync_state; DELETE FROM hub_devices; DELETE FROM hub_versions; DELETE FROM sessions; VACUUM;',
    );
    return capi.sqlite3_js_db_export(mem.pointer as never);
  } finally {
    mem.close();
  }
}

function open(): void {
  const raw = pool ? new pool.OpfsSAHPoolDb(FILE) : new sqlite3.oo1.DB(':memory:');
  db = wasmDatabase(sqlite3, raw);
  configure(db);
  migrate(db);
  repos = createRepositories({ db, now: Date.now, newId });
  const sync = createSyncService({
    db,
    repos,
    fetch: fetchViaPage,
    suggestedName: options.suggestedName,
    pullOnly: options.readOnly,
  });
  handle = createLocalApi({ repos, sync, readOnly: options.readOnly });
}

async function init(): Promise<Storage> {
  sqlite3 = await sqlite3InitModule();
  if (typeof navigator.storage.getDirectory !== 'function') {
    // No OPFS at all (an old browser, some private windows): memory only.
    open();
    return 'memory';
  }
  // The phone app keeps its copy apart (a browser on the same device never shares it).
  const name = options.readOnly ? 'km-phone' : 'km';
  // A page that just closed (a reload, a navigation) can hold the file for a
  // moment longer: wait for it. Still held after that: another tab has it.
  for (let attempt = 0; ; attempt++) {
    try {
      pool = await sqlite3.installOpfsSAHPoolVfs({
        name,
        forceReinitIfPreviouslyFailed: attempt > 0,
        preserveOnInitFailure: true,
      } as Parameters<Sqlite3Static['installOpfsSAHPoolVfs']>[0]);
      break;
    } catch (error) {
      // Only a lock is worth waiting for; anything else (no sync access
      // handles, a private window refusing OPFS) means memory only.
      if (!/NoModificationAllowed|InvalidState|lock|access handle/i.test(String(error))) {
        pool = null;
        open();
        return 'memory';
      }
      if (attempt >= 20) return 'busy';
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  open();
  return 'file';
}

let ready: Promise<Storage> | null = null;

self.onmessage = async (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  if (msg.type === 'init') {
    options = { readOnly: msg.readOnly, suggestedName: msg.suggestedName };
    ready = init().catch((error: unknown) => {
      console.error(error);
      return 'failed' as const;
    });
    const storage = await ready;
    post({
      type: 'ready',
      storage,
      ...(storage === 'failed' ? { error: 'The local database could not be opened' } : {}),
    });
    return;
  }
  if (msg.type === 'fetchResult') {
    pendingFetches.get(msg.id)?.(msg.result);
    pendingFetches.delete(msg.id);
    return;
  }
  if ((await ready) === 'failed' || (await ready) === 'busy') {
    if (msg.type === 'request') {
      post({
        type: 'response',
        id: msg.id,
        status: 503,
        body: { error: { code: 'INTERNAL_ERROR', message: 'The local database is not open' } },
      });
    }
    return;
  }
  switch (msg.type) {
    case 'request': {
      const res = await handle({ method: msg.method, path: msg.path, body: msg.body });
      post({ type: 'response', id: msg.id, status: res.status, body: res.body });
      if (msg.method !== 'GET' && res.status < 300) post({ type: 'changed' });
      return;
    }
    case 'export': {
      // The whole file, read while nothing else runs in this Worker (consistent).
      if (!pool) {
        post({ type: 'exported', id: msg.id, error: 'No file storage here' });
        return;
      }
      const bytes = pool.exportFile(FILE);
      post({ type: 'exported', id: msg.id, bytes }, [bytes.buffer]);
      return;
    }
    case 'import': {
      if (!pool) {
        post({ type: 'imported', id: msg.id, error: 'No file storage here' });
        return;
      }
      let clean: Uint8Array;
      try {
        clean = prepareImport(msg.bytes);
      } catch (error) {
        // Nothing was touched.
        post({ type: 'imported', id: msg.id, error: String(error) });
        return;
      }
      const previous = pool.exportFile(FILE); // to put back if anything fails
      try {
        db.close();
        await pool.importDb(FILE, clean);
        open();
        post({ type: 'imported', id: msg.id });
        post({ type: 'changed' });
      } catch (error) {
        await pool.importDb(FILE, previous);
        open();
        post({ type: 'imported', id: msg.id, error: String(error) });
      }
      return;
    }
    case 'close': {
      // Before the page reloads: let the next page open the file at once.
      db.close();
      pool?.pauseVfs();
      post({ type: 'closed', id: msg.id });
      return;
    }
    case 'markdown': {
      post({ type: 'markdownFiles', id: msg.id, files: markdownExport(repos) });
      return;
    }
  }
};
