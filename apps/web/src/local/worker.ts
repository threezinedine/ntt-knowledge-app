/// <reference lib="webworker" />
import { newId } from '@km/core';
import {
  configure,
  createLocalApi,
  createRepositories,
  createSyncService,
  markdownExport,
  migrate,
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
      if (r.error !== undefined) reject(new TypeError(r.error));
      else resolve(new Response(r.status === 204 ? null : r.text, { status: r.status }));
    });
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((v, k) => {
      headers[k] = v;
    });
    const message: FetchInit = {
      method: init.method ?? 'GET',
      headers,
      body: typeof init.body === 'string' ? init.body : null,
    };
    post({ type: 'fetch', id, url, init: message });
  });

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
    } catch {
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
    ready = init();
    post({ type: 'ready', storage: await ready });
    return;
  }
  if (msg.type === 'fetchResult') {
    pendingFetches.get(msg.id)?.(msg.result);
    pendingFetches.delete(msg.id);
    return;
  }
  await ready;
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
      try {
        if (!pool) throw new Error('No file storage here');
        db.close();
        await pool.importDb(FILE, msg.bytes);
        open();
        post({ type: 'imported', id: msg.id });
        post({ type: 'changed' });
      } catch (error) {
        try {
          open();
        } catch {
          // Leave it; the page reports the error.
        }
        post({ type: 'imported', id: msg.id, error: String(error) });
      }
      return;
    }
    case 'markdown': {
      post({ type: 'markdownFiles', id: msg.id, files: markdownExport(repos) });
      return;
    }
  }
};
