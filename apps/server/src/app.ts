import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import { DEFAULT_LEVEL_CONFIG, newId, type LevelConfig } from '@km/core';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Database } from './db/database.js';
import { createLoginGuard, type AuthOptions } from './http/auth.js';
import { registerErrorHandler } from './http/errorHandler.js';
import { registerHostGuard } from './http/hostGuard.js';
import { registerHubRoutes, type HubOptions } from './http/routes/hubRoutes.js';
import { createHubRepository } from './repositories/hubRepository.js';

export interface AppOptions {
  db: Database;
  /** Built web app to serve (SPA). Omit in dev, where Vite serves the UI. */
  staticDir?: string | undefined;
  logger?: FastifyServerOptions['logger'];
  /** Hostnames accepted in `Host` besides loopback (e.g. the PC's LAN IP). */
  allowedHosts?: readonly string[];
  now?: () => number;
  newId?: () => string;
  /** EXP/level table (from the operator's config file), handed to every device. */
  levelConfig?: LevelConfig;
  /** Pairing needs the authenticator code. Omitted = KM_AUTH=off (and most tests). */
  auth?: AuthOptions | undefined;
  hub?: HubOptions;
}

/**
 * The server: the one hub every device syncs with, and the host of the web
 * app's files. It keeps versions of the graph; the devices do the rest.
 */
export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 5 * 1024 * 1024 });
  const now = options.now ?? Date.now;
  const hub = createHubRepository({ db: options.db, now, newId: options.newId ?? newId });

  registerErrorHandler(app);
  registerHostGuard(app, options.allowedHosts ?? []);
  app.get('/api/health', () => ({ ok: true }));
  registerHubRoutes(app, hub, {
    keepVersions: options.hub?.keepVersions ?? 100,
    guard: createLoginGuard(options.auth, now),
    levelConfig: options.levelConfig ?? DEFAULT_LEVEL_CONFIG,
  });

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
