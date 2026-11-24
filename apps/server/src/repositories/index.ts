import type { RepoContext } from './context.js';
import { createEdgeRepository } from './edgeRepository.js';
import { createNodeRepository } from './nodeRepository.js';
import { createTagLinkRepository } from './tagLinkRepository.js';
import { createTagRepository } from './tagRepository.js';
import { createExpRepository } from './expRepository.js';
import { createSessionRepository } from './sessionRepository.js';
import { createWhyRepository } from './whyRepository.js';

export type Repositories = ReturnType<typeof createRepositories>;

export function createRepositories(ctx: RepoContext) {
  // Tags and tag links reference each other (links validate tags; deleting a
  // tag tombstones its links). The callback only runs after both exist.
  const tags = createTagRepository(ctx, (tagId, ts) => {
    links.detachAllForTag(tagId, ts);
  });
  const links = createTagLinkRepository(ctx, (id) => tags.exists(id));

  const nodes = createNodeRepository(ctx, links);
  const edges = createEdgeRepository(ctx, nodes);
  const exp = createExpRepository(ctx);
  const sessions = createSessionRepository(ctx);
  const whys = createWhyRepository(ctx, nodes);
  return { nodes, edges, tags, exp, sessions, whys };
}

export type { RepoContext } from './context.js';
