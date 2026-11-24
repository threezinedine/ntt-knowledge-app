import { syncActionInputSchema, syncConnectInputSchema } from '@km/core';
import type { FastifyInstance } from 'fastify';
import type { SyncService } from '../../sync/syncService.js';
import { parse } from '../validation.js';

/**
 * This device's sync with a hub (see sync/syncService.ts). Every server has
 * these; KM_HUB=on adds the hub's own routes (hubRoutes.ts) on top. Writes
 * need a full session: a read-only one gets 403 like any other write.
 */
export function registerSyncRoutes(app: FastifyInstance, sync: SyncService): void {
  app.get('/api/sync/status', () => sync.status());

  app.post('/api/sync/connect', (request) =>
    sync.connect(parse(syncConnectInputSchema, request.body)),
  );

  app.post('/api/sync/push', (request) =>
    sync.push(parse(syncActionInputSchema, request.body ?? {}).force),
  );

  app.post('/api/sync/pull', (request) =>
    sync.pull(parse(syncActionInputSchema, request.body ?? {}).force),
  );

  app.delete('/api/sync', async (_request, reply) => {
    await sync.disconnect();
    return reply.status(204).send();
  });
}
