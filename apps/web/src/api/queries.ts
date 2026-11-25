import { liveWikilinks, titleKey } from '@km/core';
import type {
  CreateEdgeInput,
  CreateNodeInput,
  CreateTagInput,
  CreateWhySessionInput,
  GraphNode,
  GraphSnapshot,
  NodePositionsInput,
  ReviewAnswerInput,
  SyncConnectInput,
  TaggableKind,
  UpdateEdgeInput,
  UpdateNodeInput,
  UpdateTagInput,
  UpdateWhySessionInput,
} from '@km/core';
import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { flushAllAutosaves } from '../hooks/useAutosave';
import { reloadAfterClosing } from '../local/engine';
import { api } from './client';

/**
 * Query-key factory. Structural changes (create/delete) invalidate broadly;
 * the hot path (node autosave) invalidates precisely, see `useUpdateNode`.
 */
export const keys = {
  nodes: ['nodes'] as const,
  nodeLists: ['nodes', 'list'] as const,
  nodeList: (q: string) => ['nodes', 'list', q] as const,
  node: (id: string) => ['nodes', 'detail', id] as const,
  allNodeEdges: ['nodes', 'edges'] as const,
  nodeEdges: (id: string) => ['nodes', 'edges', id] as const,
  /**
   * Under 'nodes', so edge and node create/delete make it stale; node edits
   * and tag links invalidate `allLocalGraphs` themselves (it quotes titles,
   * descriptions and tags).
   */
  allLocalGraphs: ['nodes', 'local'] as const,
  localGraph: (id: string, depth: number) => ['nodes', 'local', id, depth] as const,
  graph: ['graph'] as const,
  /** Under 'graph' (creates, deletes, renames); content edits invalidate it too. */
  wikilinks: ['graph', 'wikilinks'] as const,
  relations: ['relations'] as const,
  tags: ['tags'] as const,
  /** Derived from nodes + tags: invalidated by any write to either. */
  exp: ['exp'] as const,
  /** Under 'exp': whatever makes EXP stale makes this stale too. */
  nodeExp: ['exp', 'nodes'] as const,
  /** Under 'exp' (whys, content, node changes); links invalidate it too. */
  review: ['exp', 'review'] as const,
  sync: ['sync'] as const,
  whys: (nodeId: string) => ['whys', nodeId] as const,
};

export const useNodeList = (q: string) =>
  useQuery({ queryKey: keys.nodeList(q), queryFn: () => api.nodes.list({ q }) });

export const useNode = (id: string) =>
  useQuery({ queryKey: keys.node(id), queryFn: () => api.nodes.get(id) });

export const useNodeEdges = (id: string) =>
  useQuery({ queryKey: keys.nodeEdges(id), queryFn: () => api.nodes.edges(id) });

export const useLocalGraph = (id: string, depth: number) =>
  useQuery({
    queryKey: keys.localGraph(id, depth),
    queryFn: () => api.nodes.localGraph(id, depth),
  });

/** Not an edit: the sync warning ("a newer version is on the hub") ignores it. */
export const NOT_AN_EDIT = { notAnEdit: true } as const;

/**
 * This device vs the hub. Asked again every minute, on focus and when the
 * network comes back, so the title bar notices a newer version.
 */
export const useSyncStatus = (enabled = true) =>
  useQuery({
    queryKey: keys.sync,
    queryFn: api.sync.status,
    enabled,
    staleTime: 10_000,
    refetchInterval: 60_000,
    retry: false,
  });

/** A note's link targets, as one comparable string (any order, any case). */
const wikilinkTargets = (content: string): string =>
  [...new Set(liveWikilinks(content).map((l) => titleKey(l.target)))].sort().join('|');

/** Shown after the reload that follows a pull (the page is rebuilt from the new data). */
export const PULLED_NOTE_KEY = 'km.sync.pulledNote';

/** Waits for saves already running (a flush that finds one returns before it ends). */
async function settleSaves(qc: QueryClient): Promise<void> {
  await flushAllAutosaves();
  // This mutation counts itself.
  for (let waited = 0; qc.isMutating() > 1 && waited < 5_000; waited += 50) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export function useSyncConnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: keys.sync,
    meta: NOT_AN_EDIT,
    mutationFn: (input: SyncConnectInput) => api.sync.connect(input),
    onSuccess: (status) => {
      qc.setQueryData(keys.sync, status);
    },
  });
}

export function useSyncDisconnect() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: keys.sync,
    meta: NOT_AN_EDIT,
    mutationFn: api.sync.disconnect,
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.sync }),
  });
}

/** Saves pending edits first, so what is pushed is what is on screen. */
export function useSyncPush() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: keys.sync,
    meta: NOT_AN_EDIT,
    mutationFn: async (force: boolean) => {
      await settleSaves(qc);
      return api.sync.push(force);
    },
    onSuccess: (status) => {
      qc.setQueryData(keys.sync, status);
    },
  });
}

/**
 * Saves pending edits first (a refused pull then still sees them as changes).
 * After a pull the page reloads, so every screen and open editor is rebuilt
 * from the new data; in the hook, not the caller, so it happens even if the
 * dialog was closed meanwhile.
 */
export function useSyncPull() {
  const qc = useQueryClient();
  return useMutation({
    mutationKey: keys.sync,
    meta: NOT_AN_EDIT,
    mutationFn: async (force: boolean) => {
      await settleSaves(qc);
      return api.sync.pull(force);
    },
    onSuccess: (status) => {
      try {
        if (status.connected && status.synced) {
          sessionStorage.setItem(PULLED_NOTE_KEY, String(status.synced.version));
        }
      } catch {
        // No note after the reload; the data is there either way.
      }
      void reloadAfterClosing();
    },
  });
}

export const useExp = () => useQuery({ queryKey: keys.exp, queryFn: api.exp });

export const useReview = (enabled: boolean) =>
  useQuery({
    queryKey: keys.review,
    queryFn: api.review.today,
    enabled,
    // Today's cards change at midnight, even with the window left open.
    refetchInterval: 5 * 60_000,
  });

export function useAnswerReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ReviewAnswerInput) => api.review.answer(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.review }),
  });
}

/** Only fetched while something needs it (the graph's tag colours). */
export const useNodeExp = (enabled: boolean) =>
  useQuery({ queryKey: keys.nodeExp, queryFn: api.nodeExp, enabled });

export const useGraph = () => useQuery({ queryKey: keys.graph, queryFn: api.graph });

/** Only fetched while drawn (graph settings: show wikilinks). */
export const useWikilinks = (enabled: boolean) =>
  useQuery({ queryKey: keys.wikilinks, queryFn: api.wikilinks, enabled });

export const useRelationNames = () =>
  useQuery({ queryKey: keys.relations, queryFn: api.relations });

export const useTags = () => useQuery({ queryKey: keys.tags, queryFn: api.tags.list });

/**
 * Anything touching nodes or edges can change lists, the graph and neighbour
 * panels; node creates/deletes also change EXP.
 */
function useInvalidateGraph({ exp = false } = {}) {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.nodes }),
      qc.invalidateQueries({ queryKey: keys.graph }),
      qc.invalidateQueries({ queryKey: keys.relations }),
      // Exp covers review; without it, a new link can still end a link card.
      qc.invalidateQueries({ queryKey: exp ? keys.exp : keys.review }),
    ]);
}

export function useCreateNode() {
  const invalidate = useInvalidateGraph({ exp: true });
  return useMutation({
    mutationFn: (input: CreateNodeInput) => api.nodes.create(input),
    onSuccess: invalidate,
  });
}

/**
 * Invalidates only what a node patch can affect. Autosave fires this every
 * debounce, so refetching the whole graph on each keystroke burst is not OK.
 */
export function useUpdateNode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateNodeInput }) =>
      api.nodes.update(id, patch),
    onSuccess: async (node, { patch }) => {
      const before = qc.getQueryData<GraphNode>(keys.node(node.id));
      qc.setQueryData(keys.node(node.id), node);
      const stale: (readonly string[])[] = [];
      const labelChanged = patch.title !== undefined || patch.type !== undefined;
      // Sidebar is ordered by last edit, so any content-ish change reorders it.
      if (labelChanged || patch.content !== undefined || patch.props !== undefined) {
        stale.push(keys.nodeLists);
      }
      if (labelChanged) stale.push(keys.graph, keys.allNodeEdges, keys.review); // titles shown there
      if (patch.content !== undefined) stale.push(keys.exp); // longer notes earn more
      // GET /wikilinks scans every note: only when this note's links changed, not per keystroke burst.
      if (
        patch.content !== undefined &&
        (before === undefined || wikilinkTargets(before.content) !== wikilinkTargets(node.content))
      ) {
        stale.push(keys.wikilinks);
      }
      if (labelChanged || patch.content !== undefined) stale.push(keys.allLocalGraphs);
      if (patch.position !== undefined) {
        qc.setQueryData<GraphSnapshot>(
          keys.graph,
          (graph) =>
            graph && {
              ...graph,
              nodes: graph.nodes.map((n) =>
                n.id === node.id ? { ...n, position: node.position } : n,
              ),
            },
        );
      }
      await Promise.all(stale.map((queryKey) => qc.invalidateQueries({ queryKey })));
    },
  });
}

/**
 * Saves where a drag left every dot it moved. The canvas cache is updated
 * first (optimistic), so no refetch or other response can flash the dots
 * back; a failure restores the server's view.
 */
export function useMovePositions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: NodePositionsInput) => api.nodes.movePositions(input),
    onMutate: async ({ items }) => {
      // Exact: not the wikilinks under it (a cancelled first fetch wouldn't come back by itself).
      await qc.cancelQueries({ queryKey: keys.graph, exact: true });
      const moved = new Map(items.map((i) => [i.id, i.position]));
      qc.setQueryData<GraphSnapshot>(
        keys.graph,
        (graph) =>
          graph && {
            ...graph,
            nodes: graph.nodes.map((n) => {
              const position = moved.get(n.id);
              return position ? { ...n, position } : n;
            }),
          },
      );
      for (const [id, position] of moved) {
        qc.setQueryData<GraphNode>(keys.node(id), (node) => node && { ...node, position });
      }
    },
    onError: () => qc.invalidateQueries({ queryKey: keys.graph }),
  });
}

export function useDeleteNode() {
  const qc = useQueryClient();
  const invalidate = useInvalidateGraph({ exp: true });
  return useMutation({
    mutationFn: (id: string) => api.nodes.remove(id),
    onSuccess: async (_, id) => {
      qc.removeQueries({ queryKey: keys.node(id) });
      qc.removeQueries({ queryKey: keys.whys(id) });
      await invalidate();
    },
  });
}

/**
 * Brings [[wikilinks]] in step with a settled node (created with its title,
 * or left after editing). Plain callback, not a mutation: it runs as a node
 * page unmounts, so it must not depend on the caller staying mounted.
 * Rewritten nodes refetch; an open editor adopts the new text if it has no
 * edits of its own (NodeEditor).
 */
export function useSyncWikilinks() {
  const invalidate = useInvalidateGraph({ exp: true }); // keys.nodes covers each node's own query
  return async (id: string, created: boolean): Promise<void> => {
    const { changedIds } = await api.nodes.syncWikilinks(id, { created });
    if (changedIds.length > 0) await invalidate();
  };
}

/** Once per start: renames left half done (tab closed on the node page) get their links. */
export function useSyncPendingWikilinks(enabled: boolean) {
  const invalidate = useInvalidateGraph({ exp: true });
  const invalidateRef = useRef(invalidate);
  useEffect(() => {
    invalidateRef.current = invalidate;
  });
  useEffect(() => {
    if (!enabled) return;
    api
      .syncPendingWikilinks()
      .then(({ changedIds }) => (changedIds.length > 0 ? invalidateRef.current() : undefined))
      .catch((error: unknown) => {
        console.error('Wikilink update failed', error);
      });
  }, [enabled]);
}

export function useCreateEdge() {
  const invalidate = useInvalidateGraph();
  return useMutation({
    mutationFn: (input: CreateEdgeInput) => api.edges.create(input),
    onSuccess: invalidate,
  });
}

export function useUpdateEdge() {
  const invalidate = useInvalidateGraph();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateEdgeInput }) =>
      api.edges.update(id, patch),
    onSuccess: invalidate,
  });
}

export function useDeleteEdge() {
  const invalidate = useInvalidateGraph();
  // onSettled: the canvas removes the edge optimistically, so resync on failure too.
  return useMutation({ mutationFn: (id: string) => api.edges.remove(id), onSettled: invalidate });
}

export function useCreateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTagInput) => api.tags.create(input),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: keys.tags }),
        qc.invalidateQueries({ queryKey: keys.exp }),
      ]),
  });
}

export function useUpdateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateTagInput }) =>
      api.tags.update(id, patch),
    // Moving a tag moves its EXP to the new parents.
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: keys.tags }),
        qc.invalidateQueries({ queryKey: keys.exp }),
      ]),
  });
}

export function useDeleteTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.tags.remove(id),
    // Deleting a tag detaches it from every node.
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: keys.tags }),
        qc.invalidateQueries({ queryKey: keys.nodes }),
        qc.invalidateQueries({ queryKey: keys.exp }),
      ]),
  });
}

export interface TagLinkVars {
  ownerId: string;
  tagId: string;
  attached: boolean;
}

/**
 * Attach (`attached: true`) or detach a tag on a node. The server
 * answers with the updated owner, which is written straight into the cache.
 */
export function useTagLink(kind: TaggableKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ownerId, tagId, attached }: TagLinkVars) =>
      attached ? api.tags.attach(kind, ownerId, tagId) : api.tags.detach(kind, ownerId, tagId),
    onSuccess: async (owner: GraphNode) => {
      qc.setQueryData(keys.node(owner.id), owner);
      await Promise.all([
        qc.invalidateQueries({ queryKey: keys.nodeLists }),
        qc.invalidateQueries({ queryKey: keys.exp }),
        qc.invalidateQueries({ queryKey: keys.allLocalGraphs }), // tags are quoted there
      ]);
    },
  });
}

export const useWhySessions = (nodeId: string) =>
  useQuery({ queryKey: keys.whys(nodeId), queryFn: () => api.whys.list(nodeId) });

/**
 * Answered whys earn EXP, so a session change moves the fields too. Only the
 * session list is awaited: waiting for EXP as well let the list refetch land
 * first, unmounting the deleted session's view before its onSuccess ran (the
 * dialog then stuck on "no longer exists").
 */
const invalidateWhys = (qc: QueryClient, nodeId: string) => {
  void qc.invalidateQueries({ queryKey: keys.exp });
  return qc.invalidateQueries({ queryKey: keys.whys(nodeId) });
};

export function useCreateWhySession(nodeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWhySessionInput) => api.whys.create(nodeId, input),
    onSuccess: () => invalidateWhys(qc, nodeId),
  });
}

export function useUpdateWhySession(nodeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateWhySessionInput }) =>
      api.whys.update(id, patch),
    onSuccess: () => invalidateWhys(qc, nodeId),
  });
}

export function useDeleteWhySession(nodeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.whys.remove(id),
    onSuccess: () => invalidateWhys(qc, nodeId),
  });
}

/** Writes a file on the server; nothing cached changes. */
