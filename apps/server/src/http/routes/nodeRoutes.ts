import {
  createNodeInputSchema,
  localGraphQuerySchema,
  nodeListQuerySchema,
  nodePositionsInputSchema,
  updateNodeInputSchema,
} from '@km/core';
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

  app.patch('/api/nodes/positions', async (request, reply) => {
    repos.nodes.movePositions(parse(nodePositionsInputSchema, request.body).items);
    return reply.status(204).send();
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

  /** Neighbourhood within ?depth=1..3 links, both ways (the link-check prompt). */
  app.get('/api/nodes/:id/local-graph', (request) => {
    const { id } = parse(idParamsSchema, request.params);
    const { depth } = parse(localGraphQuerySchema, request.query);
    return repos.localGraph.of(id, depth);
  });
}
