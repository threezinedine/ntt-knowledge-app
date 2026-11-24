import { createWhySessionInputSchema, updateWhySessionInputSchema } from '@km/core';
import type { FastifyInstance } from 'fastify';
import type { Repositories } from '../../repositories/index.js';
import { idParamsSchema, parse } from '../validation.js';

/** "5 Whys" critique sessions of a node. */
export function registerWhyRoutes(app: FastifyInstance, repos: Repositories): void {
  app.get('/api/nodes/:id/whys', (request) => {
    const { id } = parse(idParamsSchema, request.params);
    return repos.whys.forNode(id);
  });

  app.post('/api/nodes/:id/whys', async (request, reply) => {
    const { id } = parse(idParamsSchema, request.params);
    const session = repos.whys.create(id, parse(createWhySessionInputSchema, request.body));
    return reply.status(201).send(session);
  });

  app.patch('/api/whys/:id', (request) => {
    const { id } = parse(idParamsSchema, request.params);
    return repos.whys.update(id, parse(updateWhySessionInputSchema, request.body));
  });

  app.delete('/api/whys/:id', async (request, reply) => {
    const { id } = parse(idParamsSchema, request.params);
    repos.whys.remove(id);
    return reply.status(204).send();
  });
}
