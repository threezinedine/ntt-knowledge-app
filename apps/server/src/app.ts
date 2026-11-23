import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import { newId } from '@km/core';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Database } from './db/database.js';
import { registerErrorHandler } from './http/errorHandler.js';
import { registerHostGuard } from './http/hostGuard.js';
import { registerEdgeRoutes } from './http/routes/edgeRoutes.js';
import { registerNodeRoutes } from './http/routes/nodeRoutes.js';
import { registerTagRoutes } from './http/routes/tagRoutes.js';
import { registerTaskRoutes } from './http/routes/taskRoutes.js';
import { createRepositories } from './repositories/index.js';

export interface AppOptions {
  db: Database;
  /** Built web app to serve (SPA). Omit in dev, where Vite serves the UI. */
  staticDir?: string | undefined;
  logger?: FastifyServerOptions['logger'];
  /** Hostnames accepted in `Host` besides loopback (e.g. the PC's LAN IP). */
  allowedHosts?: readonly string[];
  now?: () => number;
  newId?: () => string;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 5 * 1024 * 1024 });
  const repos = createRepositories({
    db: options.db,
    now: options.now ?? Date.now,
    newId: options.newId ?? newId,
  });

  registerErrorHandler(app);
  registerHostGuard(app, options.allowedHosts ?? []);
  app.get('/api/health', () => ({ ok: true }));
  registerNodeRoutes(app, repos);
  registerEdgeRoutes(app, repos);
  registerTagRoutes(app, repos);
  registerTaskRoutes(app, repos);

  if (options.staticDir !== undefined && existsSync(options.staticDir)) {
    await registerSpa(app, options.staticDir);
  }

  return app;
}

async function registerSpa(app: FastifyInstance, root: string): Promise<void> {
  await app.register(fastifyStatic, { root, wildcard: false });
  // Client-side routes (e.g. /nodes/:id) fall back to index.html. API paths and
  // missing files (anything with an extension, e.g. a stale /assets/x.js after a
  // rebuild) get a real 404 instead of HTML served with the wrong MIME type.
  app.get('/*', (request, reply) => {
    const path = request.url.split('?')[0] ?? '';
    if (path === '/api' || path.startsWith('/api/') || /\.[a-z0-9]+$/i.test(path)) {
      reply.callNotFound();
      return reply;
    }
    return reply.sendFile('index.html');
  });
}
