import type {
  ApiErrorBody,
  AuthStatus,
  CreateEdgeInput,
  CreateNodeInput,
  CreateTagInput,
  CreateWhySessionInput,
  Edge,
  ExpSnapshot,
  GraphNode,
  GraphSnapshot,
  LocalGraph,
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
import { engineRequest } from '../local/engine';

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

/** The request never got an answer (the engine failed to start, ...). */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super(errorMessage(cause), { cause });
    this.name = 'NetworkError';
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * Every request is answered on this device, by the engine Worker holding its
 * copy of the graph (local/engine.ts). Only sync, inside the engine, talks to
 * the server.
 */
async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  let res: { status: number; body: unknown };
  try {
    res = await engineRequest(method, path, body);
  } catch (error) {
    throw new NetworkError(error);
  }
  if (res.status >= 400) {
    throw new ApiError(res.status, isErrorBody(res.body) ? res.body : undefined);
  }
  return res.body as T;
}

const isErrorBody = (value: unknown): value is ApiErrorBody =>
  typeof (value as Partial<ApiErrorBody> | null)?.error?.code === 'string';

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
  },
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
