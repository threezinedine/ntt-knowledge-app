import { createTagInputSchema, idSchema, updateTagInputSchema } from '@km/core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Repositories } from '../../repositories/index.js';
import { idParamsSchema, parse } from '../validation.js';

const linkParamsSchema = z.object({ id: idSchema, tagId: idSchema });

export function registerTagRoutes(app: FastifyInstance, repos: Repositories): void {
  app.get('/api/tags', () => repos.tags.all());

  app.post('/api/tags', async (request, reply) => {
    const tag = repos.tags.create(parse(createTagInputSchema, request.body));
    return reply.status(201).send(tag);
  });

  app.patch('/api/tags/:id', (request) => {
    const { id } = parse(idParamsSchema, request.params);
    return repos.tags.update(id, parse(updateTagInputSchema, request.body));
  });

  app.delete('/api/tags/:id', async (request, reply) => {
    const { id } = parse(idParamsSchema, request.params);
    repos.tags.remove(id);
    return reply.status(204).send();
  });

  // Attach/detach are idempotent (PUT/DELETE on the link resource) and return
  // the updated owner, so drag-and-drop can retry safely.
  app.put('/api/nodes/:id/tags/:tagId', (request) => {
    const { id, tagId } = parse(linkParamsSchema, request.params);
    return repos.nodes.attachTag(id, tagId);
  });
  app.delete('/api/nodes/:id/tags/:tagId', (request) => {
    const { id, tagId } = parse(linkParamsSchema, request.params);
    return repos.nodes.detachTag(id, tagId);
  });
  app.put('/api/tasks/:id/tags/:tagId', (request) => {
    const { id, tagId } = parse(linkParamsSchema, request.params);
    return repos.tasks.attachTag(id, tagId);
  });
  app.delete('/api/tasks/:id/tags/:tagId', (request) => {
    const { id, tagId } = parse(linkParamsSchema, request.params);
    return repos.tasks.detachTag(id, tagId);
  });
}
