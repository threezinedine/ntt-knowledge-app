import { createNodeInputSchema, nodeListQuerySchema, updateNodeInputSchema } from '@km/core';
import type { FastifyInstance } from 'fastify';
import type { Repositories } from '../../repositories/index.js';
import { idParamsSchema, parse } from '../validation.js';

export function registerNodeRoutes(app: FastifyInstance, repos: Repositories): void {
  app.get('/api/nodes', (request) => repos.nodes.list(parse(nodeListQuerySchema, request.query)));

  app.post('/api/nodes', async (request, reply) => {
    const node = repos.nodes.create(parse(createNodeInputSchema, request.body));
    return reply.status(201).send(node);
  });

  app.get('/api/nodes/:id', (request) => {
    const { id } = parse(idParamsSchema, request.params);
    return repos.nodes.getOrThrow(id);
  });

  app.patch('/api/nodes/:id', (request) => {
    const { id } = parse(idParamsSchema, request.params);
    return repos.nodes.update(id, parse(updateNodeInputSchema, request.body));
  });

  app.delete('/api/nodes/:id', async (request, reply) => {
    const { id } = parse(idParamsSchema, request.params);
    repos.nodes.remove(id);
    return reply.status(204).send();
  });

  app.get('/api/nodes/:id/edges', (request) => {
    const { id } = parse(idParamsSchema, request.params);
    repos.nodes.getOrThrow(id);
    return repos.edges.forNode(id);
  });
}
