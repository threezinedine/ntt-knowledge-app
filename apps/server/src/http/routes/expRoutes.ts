import { expSnapshot, type LevelConfig } from '@km/core';
import type { FastifyInstance } from 'fastify';
import type { Repositories } from '../../repositories/index.js';

/**
 * EXP and level per tag (field), derived on read from the nodes. Read-only:
 * the level table comes from the server's config file, not from clients.
 */
export function registerExpRoutes(
  app: FastifyInstance,
  repos: Repositories,
  config: LevelConfig,
): void {
  app.get('/api/exp', () => {
    const { tags, nodes } = repos.exp.inputs();
    return expSnapshot(tags, nodes, config);
  });
}
