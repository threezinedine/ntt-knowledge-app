import type {
  ApiErrorBody,
  AuthStatus,
  BackupResult,
  CreateEdgeInput,
  CreateNodeInput,
  CreateTagInput,
  CreateWhySessionInput,
  Edge,
  ExpSnapshot,
  GraphNode,
  GraphSnapshot,
  LocalGraph,
  MarkdownExportResult,
  NodePositionsInput,
  NodeEdges,
  SyncConnectInput,
  SyncStatus,
  Tag,
  TaggableKind,
  UpdateEdgeInput,
  UpdateNodeInput,
  UpdateTagInput,
  UpdateWhySessionInput,
  WhySession,
} from '@km/core';
import { isNativeApp } from '../features/readOnly';

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorBody | undefined;

  constructor(status: number, body: ApiErrorBody | undefined) {
    super(body?.error.message ?? `Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/** The request never got an HTTP response (server down, offline, CORS, ...). */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super(errorMessage(cause), { cause });
    this.name = 'NetworkError';
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Browsers cap the total in-flight keepalive body at 64 KiB. */
const KEEPALIVE_MAX_BYTES = 60 * 1024;

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  // The phone app answers from its own copy of the hub's data (phoneData.ts).
  if (isNativeApp()) {
    const { phoneRequest } = await import('./phoneData');
    return (await phoneRequest(method, path, body)) as T;
  }
  const headers: Record<string, string> = { Accept: 'application/json' };
  const payload = body === undefined ? null : JSON.stringify(body);
  if (payload !== null) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: payload,
      // Lets writes issued while the page is closing (autosave flush) complete.
      keepalive: method !== 'GET' && (payload?.length ?? 0) < KEEPALIVE_MAX_BYTES,
    });
  } catch (error) {
    throw new NetworkError(error);
  }
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  if (!res.ok) throw new ApiError(res.status, parseErrorBody(text));
  return (text ? JSON.parse(text) : undefined) as T;
}

/**
 * A request to a sync hub from the page itself (the phone app, which has no
 * server of its own), with a device token instead of the session cookie.
 * The time limit is enforced here: the native HTTP layer may ignore signals.
 */
export async function hubRequest<T>(
  hubUrl: string,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  options: { token?: string; body?: unknown; timeoutMs: number },
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  let text: string;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error('Timed out'));
      }, options.timeoutMs);
    });
    res = await Promise.race([
      fetch(`${hubUrl}${path}`, {
        method,
        headers,
        body: options.body === undefined ? null : JSON.stringify(options.body),
        credentials: 'omit',
      }),
      timeout,
    ]);
    text = await Promise.race([res.text(), timeout]);
  } catch (error) {
    throw new NetworkError(error);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new ApiError(res.status, parseErrorBody(text));
  if (res.status === 204) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(res.status, undefined);
  }
}

/** Our server always sends ApiErrorBody JSON; a proxy's HTML 502 does not. */
function parseErrorBody(text: string): ApiErrorBody | undefined {
  try {
    const json = JSON.parse(text) as Partial<ApiErrorBody> | null;
    return typeof json?.error?.code === 'string' ? (json as ApiErrorBody) : undefined;
  } catch {
    return undefined;
  }
}

const qs = (params: Record<string, string | undefined>): string => {
  const entries = Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]));
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : '';
};

export const api = {
  nodes: {
    list: (params: { q?: string; type?: string } = {}) =>
      request<GraphNode[]>('GET', `/nodes${qs(params)}`),
    get: (id: string) => request<GraphNode>('GET', `/nodes/${id}`),
    create: (input: CreateNodeInput) => request<GraphNode>('POST', '/nodes', input),
    update: (id: string, patch: UpdateNodeInput) =>
      request<GraphNode>('PATCH', `/nodes/${id}`, patch),
    remove: (id: string) => request<undefined>('DELETE', `/nodes/${id}`),
    edges: (id: string) => request<NodeEdges>('GET', `/nodes/${id}/edges`),
    /** The node's neighbourhood within `depth` links, both ways (link check). */
    localGraph: (id: string, depth: number) =>
      request<LocalGraph>('GET', `/nodes/${id}/local-graph${qs({ depth: String(depth) })}`),
    /** Several canvas moves in one transaction (a drag and what it pushed). */
    movePositions: (input: NodePositionsInput) =>
      request<undefined>('PATCH', '/nodes/positions', input),
  },
  edges: {
    create: (input: CreateEdgeInput) => request<Edge>('POST', '/edges', input),
    update: (id: string, patch: UpdateEdgeInput) => request<Edge>('PATCH', `/edges/${id}`, patch),
    remove: (id: string) => request<undefined>('DELETE', `/edges/${id}`),
  },
  graph: () => request<GraphSnapshot>('GET', '/graph'),
  relations: () => request<string[]>('GET', '/relations'),
  tags: {
    list: () => request<Tag[]>('GET', '/tags'),
    create: (input: CreateTagInput) => request<Tag>('POST', '/tags', input),
    update: (id: string, patch: UpdateTagInput) => request<Tag>('PATCH', `/tags/${id}`, patch),
    remove: (id: string) => request<undefined>('DELETE', `/tags/${id}`),
    /** Idempotent; resolves to the updated node. */
    attach: (kind: TaggableKind, ownerId: string, tagId: string) =>
      request<GraphNode>('PUT', `/${kind}/${ownerId}/tags/${tagId}`),
    detach: (kind: TaggableKind, ownerId: string, tagId: string) =>
      request<GraphNode>('DELETE', `/${kind}/${ownerId}/tags/${tagId}`),
  },
  /** 5 Whys critique sessions of a node, newest first. */
  whys: {
    list: (nodeId: string) => request<WhySession[]>('GET', `/nodes/${nodeId}/whys`),
    create: (nodeId: string, input: CreateWhySessionInput) =>
      request<WhySession>('POST', `/nodes/${nodeId}/whys`, input),
    update: (id: string, patch: UpdateWhySessionInput) =>
      request<WhySession>('PATCH', `/whys/${id}`, patch),
    remove: (id: string) => request<undefined>('DELETE', `/whys/${id}`),
  },
  /** On the server's machine, into KM_BACKUP_DIR. */
  backup: () => request<BackupResult>('POST', '/backups'),
  exportMarkdown: () => request<MarkdownExportResult>('POST', '/exports/markdown'),
  /** EXP and level per tag (field); read-only. */
  exp: () => request<ExpSnapshot>('GET', '/exp'),
  /** This device's sync with a hub (the hub itself is another server). */
  sync: {
    status: () => request<SyncStatus>('GET', '/sync/status'),
    connect: (input: SyncConnectInput) => request<SyncStatus>('POST', '/sync/connect', input),
    push: (force: boolean) => request<SyncStatus>('POST', '/sync/push', { force }),
    pull: (force: boolean) => request<SyncStatus>('POST', '/sync/pull', { force }),
    disconnect: () => request<undefined>('DELETE', '/sync'),
  },
  auth: {
    status: () => request<AuthStatus>('GET', '/auth/status'),
    /** The 6-digit authenticator code; sets the session cookie. */
    login: (code: string, readOnly = false) =>
      request<AuthStatus>('POST', '/auth/login', readOnly ? { code, readOnly } : { code }),
    signOut: () => request<undefined>('POST', '/auth/logout'),
  },
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
