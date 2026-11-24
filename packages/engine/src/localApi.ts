import {
  createEdgeInputSchema,
  createNodeInputSchema,
  createTagInputSchema,
  createWhySessionInputSchema,
  DEFAULT_LEVEL_CONFIG,
  expSnapshot,
  idSchema,
  levelConfigSchema,
  localGraphQuerySchema,
  nodeListQuerySchema,
  nodePositionsInputSchema,
  syncActionInputSchema,
  syncConnectInputSchema,
  updateEdgeInputSchema,
  updateNodeInputSchema,
  updateTagInputSchema,
  updateWhySessionInputSchema,
  type ApiErrorBody,
  type AuthStatus,
  type GraphSnapshot,
  type LevelConfig,
} from '@km/core';
import { z, ZodError } from 'zod';
import { AppError, ForbiddenError } from './errors.js';
import type { Repositories } from './repositories/index.js';
import type { SyncService } from './sync/syncService.js';

/**
 * The app's API, answered on the device itself: the web app and the phone
 * app keep their own copy of the graph and work on it here (in a Worker),
 * offline too. Only sync talks to the server (the hub). Same paths, inputs
 * and answers as the server's REST API had, so the web app's client is
 * unchanged.
 */
export interface LocalRequest {
  method: string;
  /** After `/api`, with the query string, e.g. `/nodes?q=cpu`. */
  path: string;
  body?: unknown;
}

export interface LocalResponse {
  status: number;
  body: unknown;
}

const idParams = z.object({ id: idSchema });
const linkParams = z.object({ id: idSchema, tagId: idSchema });

type Handler = (ctx: {
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
}) => unknown;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  handler: Handler;
  /** 201 instead of 200 (creates). */
  created?: boolean;
}

/** `/nodes/:id/tags/:tagId` → a regexp and its parameter names. */
function compile(path: string): { pattern: RegExp; keys: string[] } {
  const keys: string[] = [];
  const source = path.replace(/:([a-zA-Z]+)/g, (_m, key: string) => {
    keys.push(key);
    return '([^/]+)';
  });
  return { pattern: new RegExp(`^${source}$`), keys };
}

export interface LocalApiOptions {
  repos: Repositories;
  sync: SyncService;
  /** The phone app: it only reads (and pulls). */
  readOnly: boolean;
}

/** Statuses that may change data on a read-only device anyway: sync's own. */
const SYNC_WRITES = new Set(['POST /sync/connect', 'POST /sync/pull', 'DELETE /sync']);

export function createLocalApi({ repos, sync, readOnly }: LocalApiOptions) {
  const routes: Route[] = [];
  const add = (method: string, path: string, handler: Handler, created = false) => {
    routes.push({ method, ...compile(path), handler, created });
  };
  const levelConfig = (): LevelConfig => {
    const raw = repos.settings.get('levelConfig');
    if (raw === undefined) return DEFAULT_LEVEL_CONFIG;
    const parsed = levelConfigSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_LEVEL_CONFIG;
  };

  // Nodes
  add('GET', '/nodes', ({ query }) => repos.nodes.list(nodeListQuerySchema.parse(query)));
  add('POST', '/nodes', ({ body }) => repos.nodes.create(createNodeInputSchema.parse(body)), true);
  add('PATCH', '/nodes/positions', ({ body }) => {
    repos.nodes.movePositions(nodePositionsInputSchema.parse(body).items);
    return undefined;
  });
  add('GET', '/nodes/:id', ({ params }) => repos.nodes.getOrThrow(idParams.parse(params).id));
  add('PATCH', '/nodes/:id', ({ params, body }) =>
    repos.nodes.update(idParams.parse(params).id, updateNodeInputSchema.parse(body)),
  );
  add('DELETE', '/nodes/:id', ({ params }) => {
    repos.nodes.remove(idParams.parse(params).id);
    return undefined;
  });
  add('GET', '/nodes/:id/edges', ({ params }) => {
    const { id } = idParams.parse(params);
    repos.nodes.getOrThrow(id);
    return repos.edges.forNode(id);
  });
  add('GET', '/nodes/:id/local-graph', ({ params, query }) =>
    repos.localGraph.of(idParams.parse(params).id, localGraphQuerySchema.parse(query).depth),
  );

  // Links and the graph
  add('GET', '/graph', (): GraphSnapshot => ({
    nodes: repos.nodes.summaries(),
    edges: repos.edges.all(),
  }));
  add('GET', '/relations', () => repos.edges.relationNames());
  add('POST', '/edges', ({ body }) => repos.edges.create(createEdgeInputSchema.parse(body)), true);
  add('PATCH', '/edges/:id', ({ params, body }) =>
    repos.edges.update(idParams.parse(params).id, updateEdgeInputSchema.parse(body)),
  );
  add('DELETE', '/edges/:id', ({ params }) => {
    repos.edges.remove(idParams.parse(params).id);
    return undefined;
  });

  // Tags
  add('GET', '/tags', () => repos.tags.all());
  add('POST', '/tags', ({ body }) => repos.tags.create(createTagInputSchema.parse(body)), true);
  add('PATCH', '/tags/:id', ({ params, body }) =>
    repos.tags.update(idParams.parse(params).id, updateTagInputSchema.parse(body)),
  );
  add('DELETE', '/tags/:id', ({ params }) => {
    repos.tags.remove(idParams.parse(params).id);
    return undefined;
  });
  add('PUT', '/nodes/:id/tags/:tagId', ({ params }) => {
    const { id, tagId } = linkParams.parse(params);
    return repos.nodes.attachTag(id, tagId);
  });
  add('DELETE', '/nodes/:id/tags/:tagId', ({ params }) => {
    const { id, tagId } = linkParams.parse(params);
    return repos.nodes.detachTag(id, tagId);
  });

  // 5 Whys
  add('GET', '/nodes/:id/whys', ({ params }) => repos.whys.forNode(idParams.parse(params).id));
  add(
    'POST',
    '/nodes/:id/whys',
    ({ params, body }) =>
      repos.whys.create(idParams.parse(params).id, createWhySessionInputSchema.parse(body)),
    true,
  );
  add('PATCH', '/whys/:id', ({ params, body }) =>
    repos.whys.update(idParams.parse(params).id, updateWhySessionInputSchema.parse(body)),
  );
  add('DELETE', '/whys/:id', ({ params }) => {
    repos.whys.remove(idParams.parse(params).id);
    return undefined;
  });

  // Fields: the level table comes from the hub (saved at connect and pull).
  add('GET', '/exp', () => {
    const { tags, nodes } = repos.exp.inputs();
    return expSnapshot(tags, nodes, levelConfig());
  });

  // Sync with the hub
  add('GET', '/sync/status', () => sync.status());
  add('POST', '/sync/connect', ({ body }) => sync.connect(syncConnectInputSchema.parse(body)));
  add('POST', '/sync/push', ({ body }) => sync.push(syncActionInputSchema.parse(body ?? {}).force));
  add('POST', '/sync/pull', ({ body }) => sync.pull(syncActionInputSchema.parse(body ?? {}).force));
  add('DELETE', '/sync', async () => {
    await sync.disconnect();
    return undefined;
  });

  // Nothing to sign in to: the data is on this device. (Sync pairs with the hub.)
  add('GET', '/auth/status', (): AuthStatus => ({
    enabled: false,
    signedIn: false,
    expiresAt: null,
    readOnly,
  }));

  return async function handle(request: LocalRequest): Promise<LocalResponse> {
    const [pathname = '', search = ''] = request.path.split('?');
    const query = Object.fromEntries(new URLSearchParams(search));
    try {
      for (const route of routes) {
        if (route.method !== request.method) continue;
        const match = route.pattern.exec(pathname);
        if (!match) continue;
        if (
          readOnly &&
          request.method !== 'GET' &&
          !SYNC_WRITES.has(`${request.method} ${pathname}`)
        ) {
          throw new ForbiddenError('READ_ONLY', 'This device can only read');
        }
        let params: Record<string, string>;
        try {
          params = Object.fromEntries(
            route.keys.map((k, i) => [k, decodeURIComponent(match[i + 1] ?? '')]),
          );
        } catch {
          return errorResponse(400, 'BAD_REQUEST', 'Malformed path');
        }
        const body = await route.handler({ params, query, body: request.body });
        if (body === undefined) return { status: 204, body: undefined };
        return { status: route.created ? 201 : 200, body };
      }
      return errorResponse(404, 'NOT_FOUND', `Route ${request.method} ${pathname} not found`);
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

export type LocalApi = ReturnType<typeof createLocalApi>;

function errorResponse(
  status: number,
  code: ApiErrorBody['error']['code'],
  message: string,
  details?: unknown,
  reason?: ApiErrorBody['error']['reason'],
): LocalResponse {
  const error: ApiErrorBody['error'] = { code, message };
  if (reason !== undefined) error.reason = reason;
  if (details !== undefined) error.details = details;
  return { status, body: { error } satisfies ApiErrorBody };
}

/** Like the server's error handler: AppErrors as they are, zod as 400, anything else a 500. */
export function toErrorResponse(error: unknown): LocalResponse {
  if (error instanceof ZodError) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Invalid request', z.flattenError(error));
  }
  if (error instanceof AppError) {
    return errorResponse(error.statusCode, error.code, error.message, error.details, error.reason);
  }
  console.error(error);
  return errorResponse(500, 'INTERNAL_ERROR', 'Internal error');
}
