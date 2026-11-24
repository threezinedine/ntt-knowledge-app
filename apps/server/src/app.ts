import { existsSync } from 'node:fs';
import fastifyStatic from '@fastify/static';
import { DEFAULT_LEVEL_CONFIG, newId, type LevelConfig } from '@km/core';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Database } from './db/database.js';
import { registerAuth, type AuthOptions } from './http/auth.js';
import { registerErrorHandler } from './http/errorHandler.js';
import { registerHostGuard } from './http/hostGuard.js';
import { registerEdgeRoutes } from './http/routes/edgeRoutes.js';
import { registerExpRoutes } from './http/routes/expRoutes.js';
import { registerNodeRoutes } from './http/routes/nodeRoutes.js';
import { registerTagRoutes } from './http/routes/tagRoutes.js';
import { registerWhyRoutes } from './http/routes/whyRoutes.js';
import { registerBackupRoutes } from './http/routes/backupRoutes.js';
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
  /** EXP/level table (from the operator's config file). */
  levelConfig?: LevelConfig;
  /** Backups and markdown exports go here; omitted = no backup routes. */
  backupDir?: string | undefined;
  /** Authenticator-code sign-in. Omitted = no sign-in (KM_AUTH=off, and the API tests). */
  auth?: AuthOptions | undefined;
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
  await registerAuth(app, repos.sessions, options.auth, options.now ?? Date.now);
  app.get('/api/health', () => ({ ok: true })); // public: see PUBLIC_API in http/auth.ts
  registerNodeRoutes(app, repos);
  registerEdgeRoutes(app, repos);
  registerTagRoutes(app, repos);
  registerWhyRoutes(app, repos);
  if (options.backupDir !== undefined) {
    registerBackupRoutes(app, options.db, repos, options.backupDir, options.now ?? Date.now);
  }
  registerExpRoutes(app, repos, options.levelConfig ?? DEFAULT_LEVEL_CONFIG);

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
