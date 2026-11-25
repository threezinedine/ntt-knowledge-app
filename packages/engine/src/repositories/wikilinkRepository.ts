import {
  linkMentions,
  NODE_CONTENT_MAX,
  renameWikilinks,
  titleKey,
  type GraphNode,
  type UpdateNodeInput,
  type WikilinkSyncInput,
  type WikilinkSyncResult,
} from '@km/core';
import { transaction } from '../database.js';
import type { RepoContext } from './context.js';
import type { NodeRepository } from './nodeRepository.js';
import type { SettingsRepository } from './settingsRepository.js';

export type WikilinkRepository = ReturnType<typeof createWikilinkRepository>;

/**
 * Titles nodes had before a rename not yet carried into other nodes' links:
 * node id → old title. Device-local (device_settings): it survives closing
 * the tab mid-rename, and is replayed at start-up (`syncPending`). A pull
 * replaces the data, so it clears this too.
 */
export const PENDING_RENAMES_KEY = 'wikilinkRenames';

/**
 * Keeps `[[wikilinks]]` (see @km/core wikilinks.ts) in step with titles. Run
 * once a node is settled: just created with its title, or left after editing
 * (not on every keystroke, so half-typed words and titles never get linked).
 *
 * 1. Renamed: `[[Old]]` in other nodes becomes `[[New]]`, unless another
 *    node has the old or the new title (the links may mean, or would then
 *    open, that one).
 * 2. New or renamed: plain mentions of its title in other nodes are linked.
 * 3. Its own content: plain mentions of other nodes' titles are linked.
 *
 * Every rewrite is an ordinary content edit (updated_at, word count), so it
 * syncs like one.
 */
export function createWikilinkRepository(
  { db }: RepoContext,
  deps: { nodes: NodeRepository; settings: SettingsRepository },
) {
  const selectAll = db.prepare(
    'SELECT id, title, content FROM nodes WHERE deleted_at IS NULL ORDER BY id',
  );

  const readPending = (): Record<string, string> => {
    try {
      const raw = JSON.parse(deps.settings.get(PENDING_RENAMES_KEY) ?? '{}') as unknown;
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
      return Object.fromEntries(
        Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === 'string'),
      );
    } catch {
      return {};
    }
  };
  const writePending = (pending: Record<string, string>) => {
    deps.settings.set(PENDING_RENAMES_KEY, JSON.stringify(pending));
  };

  const forget = (id: string) => {
    writePending(Object.fromEntries(Object.entries(readPending()).filter(([k]) => k !== id)));
  };

  function sync(id: string, { created }: WikilinkSyncInput): WikilinkSyncResult {
    return transaction(db, () => {
      const self = deps.nodes.getOrThrow(id);
      const pending = readPending();
      const previousTitle = created ? null : (pending[id] ?? self.title);
      if (id in pending) forget(id);

      const rows = selectAll.all() as { id: string; title: string; content: string }[];
      const selfKey = titleKey(self.title);
      const taken = (title: string) =>
        rows.some((r) => r.id !== id && titleKey(r.title) === titleKey(title));
      // Nodes with the same title (any case) aren't linked to or from this one.
      const others = rows.filter((r) => r.id !== id && titleKey(r.title) !== selfKey);
      const changedIds: string[] = [];
      const write = (nodeId: string, before: string, after: string) => {
        if (after === before || after.length > NODE_CONTENT_MAX) return;
        deps.nodes.update(nodeId, { content: after });
        changedIds.push(nodeId);
      };

      const rename =
        previousTitle !== null &&
        previousTitle.trim() !== self.title.trim() &&
        !taken(previousTitle) &&
        !taken(self.title);
      const titleIsNew = previousTitle === null || titleKey(previousTitle) !== selfKey;
      for (const other of others) {
        let content = other.content;
        if (rename) content = renameWikilinks(content, previousTitle, self.title);
        if (titleIsNew) content = linkMentions(content, [self.title]);
        write(other.id, other.content, content);
      }
      write(
        id,
        self.content,
        linkMentions(
          self.content,
          others.map((r) => r.title),
        ),
      );
      return { changedIds };
    });
  }

  return {
    sync,

    /**
     * PATCH /nodes/:id: the edit, and if the title changed, the one it had
     * first (until links follow, on settling), in one transaction.
     */
    updateNode(id: string, patch: UpdateNodeInput): GraphNode {
      return transaction(db, () => {
        const before = deps.nodes.getOrThrow(id).title;
        const node = deps.nodes.update(id, patch);
        const pending = readPending();
        if (node.title !== before && !(id in pending)) {
          writePending({ ...pending, [id]: before });
        }
        return node;
      });
    },

    /** Renames left over (tab closed before leaving the node): carry them out now. */
    syncPending(): WikilinkSyncResult {
      const changed = new Set<string>();
      for (const id of Object.keys(readPending())) {
        if (deps.nodes.get(id) === undefined) {
          forget(id); // deleted since
          continue;
        }
        for (const c of sync(id, { created: false }).changedIds) changed.add(c);
      }
      return { changedIds: [...changed] };
    },

    /** After a pull: the data was replaced, so earlier renames no longer apply. */
    forgetPending(): void {
      writePending({});
    },
  };
}
