import type {
  ApiErrorBody,
  Category,
  CreateCategoryInput,
  CreateEdgeInput,
  CreateNodeInput,
  CreateTaskInput,
  Edge,
  GraphNode,
  GraphSnapshot,
  NodeEdges,
  Task,
  UpdateCategoryInput,
  UpdateEdgeInput,
  UpdateNodeInput,
  UpdateTaskInput,
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

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** Browsers cap the total in-flight keepalive body at 64 KiB. */
const KEEPALIVE_MAX_BYTES = 60 * 1024;

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const payload = body === undefined ? null : JSON.stringify(body);
  if (payload !== null) headers['Content-Type'] = 'application/json';
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    body: payload,
    // Lets writes issued while the page is closing (autosave flush) complete.
    keepalive: method !== 'GET' && (payload?.length ?? 0) < KEEPALIVE_MAX_BYTES,
  });
  if (res.status === 204) return undefined as T;

  const text = await res.text();
  const json: unknown = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiError(res.status, json as ApiErrorBody | undefined);
  return json as T;
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
    tasks: (id: string) => request<Task[]>('GET', `/nodes/${id}/tasks`),
  },
  edges: {
    create: (input: CreateEdgeInput) => request<Edge>('POST', '/edges', input),
    update: (id: string, patch: UpdateEdgeInput) => request<Edge>('PATCH', `/edges/${id}`, patch),
    remove: (id: string) => request<undefined>('DELETE', `/edges/${id}`),
  },
  graph: () => request<GraphSnapshot>('GET', '/graph'),
  relations: () => request<string[]>('GET', '/relations'),
  categories: {
    list: () => request<Category[]>('GET', '/categories'),
    create: (input: CreateCategoryInput) => request<Category>('POST', '/categories', input),
    update: (id: string, patch: UpdateCategoryInput) =>
      request<Category>('PATCH', `/categories/${id}`, patch),
    remove: (id: string) => request<undefined>('DELETE', `/categories/${id}`),
  },
  tasks: {
    create: (input: CreateTaskInput) => request<Task>('POST', '/tasks', input),
    update: (id: string, patch: UpdateTaskInput) => request<Task>('PATCH', `/tasks/${id}`, patch),
    remove: (id: string) => request<undefined>('DELETE', `/tasks/${id}`),
  },
};

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
