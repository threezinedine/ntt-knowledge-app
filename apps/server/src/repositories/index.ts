import { createCategoryRepository } from './categoryRepository.js';
import type { RepoContext } from './context.js';
import { createEdgeRepository } from './edgeRepository.js';
import { createNodeRepository } from './nodeRepository.js';
import { createTaskRepository } from './taskRepository.js';

export type Repositories = ReturnType<typeof createRepositories>;

export function createRepositories(ctx: RepoContext) {
  const nodes = createNodeRepository(ctx);
  const edges = createEdgeRepository(ctx, nodes);
  const categories = createCategoryRepository(ctx);
  const tasks = createTaskRepository(ctx, nodes, categories);
  return { nodes, edges, categories, tasks };
}

export type { RepoContext } from './context.js';
