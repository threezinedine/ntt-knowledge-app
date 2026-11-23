import {
  createCategoryInputSchema,
  createTaskInputSchema,
  updateCategoryInputSchema,
  updateTaskInputSchema,
} from '@km/core';
import type { FastifyInstance } from 'fastify';
import type { Repositories } from '../../repositories/index.js';
import { idParamsSchema, parse } from '../validation.js';

export function registerTaskRoutes(app: FastifyInstance, repos: Repositories): void {
  app.get('/api/categories', () => repos.categories.all());

  app.post('/api/categories', async (request, reply) => {
    const category = repos.categories.create(parse(createCategoryInputSchema, request.body));
    return reply.status(201).send(category);
  });

  app.patch('/api/categories/:id', (request) => {
    const { id } = parse(idParamsSchema, request.params);
    return repos.categories.update(id, parse(updateCategoryInputSchema, request.body));
  });

  app.delete('/api/categories/:id', async (request, reply) => {
    const { id } = parse(idParamsSchema, request.params);
    repos.categories.remove(id);
    return reply.status(204).send();
  });

  app.post('/api/tasks', async (request, reply) => {
    const task = repos.tasks.create(parse(createTaskInputSchema, request.body));
    return reply.status(201).send(task);
  });

  app.patch('/api/tasks/:id', (request) => {
    const { id } = parse(idParamsSchema, request.params);
    return repos.tasks.update(id, parse(updateTaskInputSchema, request.body));
  });

  app.delete('/api/tasks/:id', async (request, reply) => {
    const { id } = parse(idParamsSchema, request.params);
    repos.tasks.remove(id);
    return reply.status(204).send();
  });
}
