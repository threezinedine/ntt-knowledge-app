import type { RepoContext } from './context.js';
import { createEdgeRepository } from './edgeRepository.js';
import { createNodeRepository } from './nodeRepository.js';
import { createTagLinkRepository } from './tagLinkRepository.js';
import { createTagRepository } from './tagRepository.js';
import { createExpRepository } from './expRepository.js';
import { createWhyRepository } from './whyRepository.js';
import { createLocalGraphRepository } from './localGraphRepository.js';
import { createSyncRepository } from './syncRepository.js';
import { createSettingsRepository } from './settingsRepository.js';
import { createReviewRepository } from './reviewRepository.js';
import { createWikilinkRepository } from './wikilinkRepository.js';

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
  const whys = createWhyRepository(ctx, nodes);
  const localGraph = createLocalGraphRepository(nodes, edges);
  const sync = createSyncRepository(ctx);
  const settings = createSettingsRepository(ctx);
  const review = createReviewRepository(ctx, { exp, nodes, settings });
  const wikilinks = createWikilinkRepository(ctx, { nodes, settings });
  return { nodes, edges, tags, exp, whys, localGraph, sync, settings, review, wikilinks };
}

export type { RepoContext } from './context.js';
