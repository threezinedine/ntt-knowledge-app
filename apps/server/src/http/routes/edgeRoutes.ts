import { createEdgeInputSchema, updateEdgeInputSchema, type GraphSnapshot } from '@km/core';
import type { FastifyInstance } from 'fastify';
import type { Repositories } from '../../repositories/index.js';
import { idParamsSchema, parse } from '../validation.js';

export function registerEdgeRoutes(app: FastifyInstance, repos: Repositories): void {
  app.get('/api/graph', (): GraphSnapshot => ({
    nodes: repos.nodes.summaries(),
    edges: repos.edges.all(),
  }));

  app.get('/api/relations', () => repos.edges.relationNames());

  app.post('/api/edges', async (request, reply) => {
    const edge = repos.edges.create(parse(createEdgeInputSchema, request.body));
    return reply.status(201).send(edge);
  });

  app.patch('/api/edges/:id', (request) => {
    const { id } = parse(idParamsSchema, request.params);
    return repos.edges.update(id, parse(updateEdgeInputSchema, request.body));
  });

  app.delete('/api/edges/:id', async (request, reply) => {
    const { id } = parse(idParamsSchema, request.params);
    repos.edges.remove(id);
    return reply.status(204).send();
  });
}
