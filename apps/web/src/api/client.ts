import type {
  ApiErrorBody,
  CreateEdgeInput,
  CreateNodeInput,
  CreateTagInput,
  Edge,
  ExpSnapshot,
  GraphNode,
  GraphSnapshot,
  NodeEdges,
  Tag,
  TaggableKind,
  UpdateEdgeInput,
  UpdateNodeInput,
  UpdateTagInput,
} from '@km/core';

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

export type TaggedOwner<K extends TaggableKind> = K extends 'nodes' ? GraphNode : never;

/** Browsers cap the total in-flight keepalive body at 64 KiB. */
const KEEPALIVE_MAX_BYTES = 60 * 1024;

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
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
    attach: <K extends TaggableKind>(kind: K, ownerId: string, tagId: string) =>
      request<TaggedOwner<K>>('PUT', `/${kind}/${ownerId}/tags/${tagId}`),
    detach: <K extends TaggableKind>(kind: K, ownerId: string, tagId: string) =>
      request<TaggedOwner<K>>('DELETE', `/${kind}/${ownerId}/tags/${tagId}`),
  },
  /** EXP and level per tag (field); read-only. */
  exp: () => request<ExpSnapshot>('GET', '/exp'),
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
