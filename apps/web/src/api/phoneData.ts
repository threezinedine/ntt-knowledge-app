import {
  hubPairInputSchema,
  syncConnectInputSchema,
  type ApiErrorReason,
  type AuthStatus,
  type EdgeWithNeighbor,
  type GraphNode,
  type HubPairResult,
  type HubVersion,
  type NodeEdges,
  type NodeSummary,
  type PhoneView,
  type SyncStatus,
} from '@km/core';
import { ApiError, hubRequest, NetworkError } from './client';

/**
 * The phone app has no server of its own: it keeps the hub's newest version
 * (a PhoneView, already in API shapes) in IndexedDB and answers the read
 * requests the web app makes from it, offline too. It only reads: writes are
 * refused like a read-only session's. Sync is done straight with the hub:
 * pair once with the authenticator code (a read-only device), then pull.
 */

interface Link {
  hubUrl: string;
  token: string;
  deviceName: string;
}

const DB_NAME = 'km-phone';
const STORE = 'kv';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(req.error ?? new Error('IndexedDB failed'));
    };
  });
}

async function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => {
        resolve(req.result as T);
      };
      req.onerror = () => {
        reject(req.error ?? new Error('IndexedDB failed'));
      };
    });
  } finally {
    db.close();
  }
}

const getItem = <T>(key: string) => idb<T | undefined>('readonly', (s) => s.get(key));
const setItem = (key: string, value: unknown) => idb('readwrite', (s) => s.put(value, key));
const deleteItem = (key: string) => idb('readwrite', (s) => s.delete(key));

let viewCache: Promise<PhoneView | undefined> | null = null;
const loadView = (): Promise<PhoneView | undefined> => (viewCache ??= getItem<PhoneView>('view'));

const HEAD_TIMEOUT_MS = 5_000;
const PULL_TIMEOUT_MS = 120_000;

/** A hub failure as this app shows it: never a 401 (that means "your sign-in ended"). */
export function hubFailure(error: unknown): ApiError {
  let reason: ApiErrorReason = 'HUB_NOT_ENABLED';
  let details: unknown;
  if (error instanceof NetworkError) reason = 'HUB_UNREACHABLE';
  else if (error instanceof ApiError) {
    const body = error.body?.error;
    if (body?.reason !== undefined && body.reason !== 'HUB_DENIED') {
      reason = body.reason;
      details = body.details;
    } else if (error.status === 401) reason = 'HUB_DENIED';
    else if (body?.code === 'FORBIDDEN_HOST') reason = 'HUB_HOST_REFUSED';
    else if (body !== undefined && error.status >= 500) reason = 'HUB_ERROR';
  }
  return new ApiError(502, {
    error: { code: 'BAD_GATEWAY', reason, message: 'Hub request failed', details },
  });
}

/** Tells the hub to forget a token (best effort: offline, it stays valid; see hub:devices). */
async function revoke(link: Link): Promise<void> {
  try {
    await hubRequest(link.hubUrl, 'DELETE', '/api/hub/devices/self', {
      token: link.token,
      timeoutMs: HEAD_TIMEOUT_MS,
    });
  } catch {
    // Nothing more to do from here.
  }
}

async function status(): Promise<SyncStatus> {
  const link = await getItem<Link>('link');
  if (!link) return { connected: false, suggestedName: 'Phone' };
  const synced = (await loadView())?.head ?? null;
  const base = {
    connected: true as const,
    hubUrl: link.hubUrl,
    deviceName: link.deviceName,
    synced,
    localChanged: false, // the phone never edits
  };
  try {
    const { head } = await hubRequest<{ head: HubVersion | null }>(
      link.hubUrl,
      'GET',
      '/api/hub/head',
      {
        token: link.token,
        timeoutMs: HEAD_TIMEOUT_MS,
      },
    );
    return { ...base, hub: head, problem: null };
  } catch (error) {
    return {
      ...base,
      hub: null,
      problem: hubFailure(error).body?.error.reason ?? 'HUB_UNREACHABLE',
    };
  }
}

async function connect(body: unknown): Promise<SyncStatus> {
  const parsed = syncConnectInputSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, { error: { code: 'VALIDATION_ERROR', message: 'Invalid input' } });
  }
  const input = parsed.data;
  let result: HubPairResult;
  try {
    result = await hubRequest<HubPairResult>(input.hubUrl, 'POST', '/api/hub/pair', {
      body: hubPairInputSchema.parse({ code: input.code, name: input.deviceName, readOnly: true }),
      timeoutMs: HEAD_TIMEOUT_MS,
    });
  } catch (error) {
    throw hubFailure(error);
  }
  const previous = await getItem<Link>('link');
  await setItem('link', {
    hubUrl: input.hubUrl,
    token: result.token,
    deviceName: input.deviceName,
  });
  if (previous) await revoke(previous); // one live token per device
  return status();
}

async function pull(): Promise<SyncStatus> {
  const link = await getItem<Link>('link');
  if (!link) throw readOnlyError('SYNC_NOT_CONNECTED', 409);
  let view: PhoneView;
  try {
    view = await hubRequest<PhoneView>(link.hubUrl, 'GET', '/api/hub/latest/view', {
      token: link.token,
      timeoutMs: PULL_TIMEOUT_MS,
    });
  } catch (error) {
    throw hubFailure(error);
  }
  await setItem('view', view);
  viewCache = Promise.resolve(view);
  return status();
}

function readOnlyError(reason: ApiErrorReason = 'READ_ONLY', status = 403): ApiError {
  return new ApiError(status, {
    error: { code: status === 403 ? 'FORBIDDEN' : 'CONFLICT', reason, message: reason },
  });
}

const notFound = () =>
  new ApiError(404, { error: { code: 'NOT_FOUND', message: 'Not on this phone' } });

const summary = (n: GraphNode): NodeSummary => ({
  id: n.id,
  type: n.type,
  title: n.title,
  position: n.position,
});

/** Like the server: by relation name, then the other node's title. */
export function edgesOf(view: PhoneView, id: string): NodeEdges {
  const byId = new Map(view.nodes.map((n) => [n.id, n]));
  const side = (mine: 'fromId' | 'toId', other: 'fromId' | 'toId'): EdgeWithNeighbor[] =>
    view.graph.edges
      .filter((e) => e[mine] === id && byId.has(e[other]))
      .map((edge) => ({ edge, neighbor: summary(byId.get(edge[other]) as GraphNode) }))
      .sort(
        (a, b) =>
          a.edge.name.localeCompare(b.edge.name) ||
          a.neighbor.title.localeCompare(b.neighbor.title),
      );
  return { outgoing: side('fromId', 'toId'), incoming: side('toId', 'fromId') };
}

/** Most recently edited first, `q` in the title, like GET /api/nodes. */
export function listNodes(view: PhoneView, params: URLSearchParams): GraphNode[] {
  const q = params.get('q')?.trim().toLocaleLowerCase() ?? '';
  const type = params.get('type') ?? '';
  const limit = Number(params.get('limit') ?? 200);
  return view.nodes
    .filter(
      (n) =>
        (q === '' || n.title.toLocaleLowerCase().includes(q)) && (type === '' || n.type === type),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt || (a.id < b.id ? 1 : -1))
    .slice(0, limit);
}

const NO_AUTH: AuthStatus = { enabled: false, signedIn: false, expiresAt: null, readOnly: true };

/** Answers an API request (path after /api) from the phone's copy. */
export async function phoneRequest(method: string, path: string, body: unknown): Promise<unknown> {
  const [pathname = '', search = ''] = path.split('?');
  const params = new URLSearchParams(search);

  if (pathname === '/sync/status' && method === 'GET') return status();
  if (pathname === '/sync/connect' && method === 'POST') return connect(body);
  if (pathname === '/sync/pull' && method === 'POST') return pull();
  if (pathname === '/sync' && method === 'DELETE') {
    const link = await getItem<Link>('link');
    await deleteItem('link'); // the copy stays readable
    if (link) await revoke(link);
    return undefined;
  }
  if (pathname === '/auth/status') return NO_AUTH;
  if (method !== 'GET') throw readOnlyError();

  const view = await loadView();
  const empty: PhoneView = view ?? {
    head: { version: 0, hash: '', createdAt: 0, deviceName: '' },
    graph: { nodes: [], edges: [] },
    nodes: [],
    tags: [],
    exp: { maxLevel: 1, tags: [] },
  };
  if (pathname === '/graph') return empty.graph;
  if (pathname === '/tags') return empty.tags;
  if (pathname === '/exp') return empty.exp;
  if (pathname === '/relations') {
    return [...new Set(empty.graph.edges.map((e) => e.name))].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    );
  }
  if (pathname === '/nodes') return listNodes(empty, params);
  const node = /^\/nodes\/([^/]+)(\/edges|\/whys)?$/.exec(pathname);
  if (node) {
    const [, id = '', sub] = node;
    if (sub === '/whys') return []; // not part of the phone's copy
    const found = empty.nodes.find((n) => n.id === id);
    if (!found) throw notFound();
    return sub === '/edges' ? edgesOf(empty, id) : found;
  }
  throw notFound();
}
