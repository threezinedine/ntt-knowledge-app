import type {
  CreateEdgeInput,
  CreateNodeInput,
  CreateTagInput,
  CreateWhySessionInput,
  GraphNode,
  GraphSnapshot,
  NodePositionsInput,
  TaggableKind,
  UpdateEdgeInput,
  UpdateNodeInput,
  UpdateTagInput,
  UpdateWhySessionInput,
} from '@km/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { flushAllAutosaves } from '../hooks/useAutosave';
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
  graph: ['graph'] as const,
  relations: ['relations'] as const,
  tags: ['tags'] as const,
  /** Derived from nodes + tags: invalidated by any write to either. */
  exp: ['exp'] as const,
  auth: ['auth'] as const,
  whys: (nodeId: string) => ['whys', nodeId] as const,
};

export const useNodeList = (q: string) =>
  useQuery({ queryKey: keys.nodeList(q), queryFn: () => api.nodes.list({ q }) });

export const useNode = (id: string) =>
  useQuery({ queryKey: keys.node(id), queryFn: () => api.nodes.get(id) });

export const useNodeEdges = (id: string) =>
  useQuery({ queryKey: keys.nodeEdges(id), queryFn: () => api.nodes.edges(id) });

export const useAuthStatus = () =>
  useQuery({ queryKey: keys.auth, queryFn: api.auth.status, staleTime: 60_000 });

/**
 * Signs in with an authenticator code, then refetches what failed while
 * signed out and saves pending edits at once (not at their next retry).
 */
export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ code, readOnly }: { code: string; readOnly: boolean }) =>
      api.auth.login(code, readOnly),
    onSuccess: (status) => {
      qc.setQueryData(keys.auth, status);
      void flushAllAutosaves();
      void qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== keys.auth[0] });
    },
  });
}

/**
 * Saves pending edits, signs out, then reloads the app: nothing of the
 * session (cached data, the open page) should outlive it.
 */
export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await flushAllAutosaves();
      // A flush that found a save already running returns before it ends.
      for (let waited = 0; qc.isMutating() > 1 && waited < 5_000; waited += 50) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await api.auth.signOut();
    },
    onSettled: () => {
      window.location.replace('/');
    },
  });
}

export const useExp = () => useQuery({ queryKey: keys.exp, queryFn: api.exp });

export const useGraph = () => useQuery({ queryKey: keys.graph, queryFn: api.graph });

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
      ...(exp ? [qc.invalidateQueries({ queryKey: keys.exp })] : []),
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
      qc.setQueryData(keys.node(node.id), node);
      const stale: (readonly string[])[] = [];
      const labelChanged = patch.title !== undefined || patch.type !== undefined;
      // Sidebar is ordered by last edit, so any content-ish change reorders it.
      if (labelChanged || patch.content !== undefined || patch.props !== undefined) {
        stale.push(keys.nodeLists);
      }
      if (labelChanged) stale.push(keys.graph, keys.allNodeEdges); // titles shown there
      if (patch.content !== undefined) stale.push(keys.exp); // longer notes earn more
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
      await qc.cancelQueries({ queryKey: keys.graph });
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
      ]);
    },
  });
}

export const useWhySessions = (nodeId: string) =>
  useQuery({ queryKey: keys.whys(nodeId), queryFn: () => api.whys.list(nodeId) });

export function useCreateWhySession(nodeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWhySessionInput) => api.whys.create(nodeId, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.whys(nodeId) }),
  });
}

export function useUpdateWhySession(nodeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateWhySessionInput }) =>
      api.whys.update(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.whys(nodeId) }),
  });
}

export function useDeleteWhySession(nodeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.whys.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.whys(nodeId) }),
  });
}
