import { isNativeApp } from '../features/readOnly';
import type { FetchResult, FromWorker, Storage, ToWorker } from './protocol';

/**
 * The page's side of the engine Worker (worker.ts): starts it once, sends it
 * the app's API requests, and runs its requests to the hub (so the phone
 * app's native HTTP is used). Everything else in the app talks to the
 * engine through api/client.ts.
 */

let worker: Worker | null = null;
let readyPromise: Promise<Storage> | null = null;
let seq = 0;
const pending = new Map<number, (m: FromWorker) => void>();
const changeListeners = new Set<() => void>();

function suggestedName(): string {
  if (isNativeApp()) return 'Phone';
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Safari\//.test(ua)
          ? 'Safari'
          : 'Browser';
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X|iPhone|iPad/.test(ua)
        ? 'Apple'
        : /Linux/.test(ua)
          ? 'Linux'
          : '';
  return os ? `${browser} on ${os}` : browser;
}

async function runFetch(url: string, init: RequestInit): Promise<FetchResult> {
  try {
    const res = await fetch(url, { ...init, credentials: 'omit' });
    return { ok: res.ok, status: res.status, text: await res.text() };
  } catch (error) {
    return { ok: false, status: 0, text: '', error: String(error) };
  }
}

function start(): Promise<Storage> {
  if (readyPromise) return readyPromise;
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  const w = worker;
  readyPromise = new Promise<Storage>((resolve) => {
    w.onmessage = (event: MessageEvent<FromWorker>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'ready':
          resolve(msg.storage);
          return;
        case 'fetch':
          void runFetch(msg.url, msg.init).then((result) => {
            send({ type: 'fetchResult', id: msg.id, result });
          });
          return;
        case 'changed':
          for (const l of changeListeners) l();
          return;
        default:
          pending.get(msg.id)?.(msg);
          pending.delete(msg.id);
      }
    };
  });
  send({ type: 'init', readOnly: isNativeApp(), suggestedName: suggestedName() });
  // Ask the browser to keep this site's storage (no eviction under pressure).
  void navigator.storage.persist().catch(() => false);
  return readyPromise;
}

function send(message: ToWorker, transfer: Transferable[] = []): void {
  worker?.postMessage(message, transfer);
}

function call<T extends FromWorker>(
  make: (id: number) => ToWorker,
  transfer: Transferable[] = [],
): Promise<T> {
  return start().then(
    () =>
      new Promise<T>((resolve) => {
        const id = ++seq;
        pending.set(id, (m) => {
          resolve(m as T);
        });
        send(make(id), transfer);
      }),
  );
}

/** Where this device's copy lives (see Storage). */
export const engineStorage = (): Promise<Storage> => start();

export async function engineRequest(
  method: string,
  path: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const res = await call<Extract<FromWorker, { type: 'response' }>>((id) => ({
    type: 'request',
    id,
    method,
    path,
    body,
  }));
  return { status: res.status, body: res.body };
}

/** The whole database file, e.g. to save it to a file on disk. */
export async function exportDatabase(): Promise<Uint8Array> {
  const res = await call<Extract<FromWorker, { type: 'exported' }>>((id) => ({
    type: 'export',
    id,
  }));
  if (!res.bytes) throw new Error(res.error ?? 'Export failed');
  return res.bytes;
}

/** Replaces this device's copy with a database file. */
export async function importDatabase(bytes: Uint8Array): Promise<void> {
  const res = await call<Extract<FromWorker, { type: 'imported' }>>(
    (id) => ({ type: 'import', id, bytes }),
    [bytes.buffer],
  );
  if (res.error !== undefined) throw new Error(res.error);
}

export async function markdownFiles(): Promise<{ name: string; content: string }[]> {
  const res = await call<Extract<FromWorker, { type: 'markdownFiles' }>>((id) => ({
    type: 'markdown',
    id,
  }));
  return res.files;
}

/** Called after every write that went through. */
export function onDataChanged(listener: () => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

// End-to-end tests arrange data through the same API the app uses.
(window as unknown as { __kmEngine?: unknown }).__kmEngine = { request: engineRequest };
