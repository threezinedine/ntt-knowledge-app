import type {
  CreateEdgeInput,
  CreateNodeInput,
  CreateTagInput,
  CreateTaskInput,
  GraphNode,
  GraphSnapshot,
  TaggableKind,
  Task,
  UpdateNodeInput,
  UpdateTagInput,
  UpdateTaskInput,
} from '@km/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  nodeTasks: (id: string) => ['nodes', 'tasks', id] as const,
  graph: ['graph'] as const,
  relations: ['relations'] as const,
  tags: ['tags'] as const,
};

export const useNodeList = (q: string) =>
  useQuery({ queryKey: keys.nodeList(q), queryFn: () => api.nodes.list({ q }) });

export const useNode = (id: string) =>
  useQuery({ queryKey: keys.node(id), queryFn: () => api.nodes.get(id) });

export const useNodeEdges = (id: string) =>
  useQuery({ queryKey: keys.nodeEdges(id), queryFn: () => api.nodes.edges(id) });

export const useNodeTasks = (id: string) =>
  useQuery({ queryKey: keys.nodeTasks(id), queryFn: () => api.nodes.tasks(id) });

export const useGraph = () => useQuery({ queryKey: keys.graph, queryFn: api.graph });

export const useRelationNames = () =>
  useQuery({ queryKey: keys.relations, queryFn: api.relations });

export const useTags = () => useQuery({ queryKey: keys.tags, queryFn: api.tags.list });

/** Anything touching nodes or edges can change lists, the graph and neighbour panels. */
function useInvalidateGraph() {
  const qc = useQueryClient();
  return () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: keys.nodes }),
      qc.invalidateQueries({ queryKey: keys.graph }),
      qc.invalidateQueries({ queryKey: keys.relations }),
    ]);
}

export function useCreateNode() {
  const invalidate = useInvalidateGraph();
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

export function useDeleteNode() {
  const qc = useQueryClient();
  const invalidate = useInvalidateGraph();
  return useMutation({
    mutationFn: (id: string) => api.nodes.remove(id),
    onSuccess: async (_, id) => {
      qc.removeQueries({ queryKey: keys.node(id) });
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

export function useDeleteEdge() {
  const invalidate = useInvalidateGraph();
  // onSettled: the canvas removes the edge optimistically, so resync on failure too.
  return useMutation({ mutationFn: (id: string) => api.edges.remove(id), onSettled: invalidate });
}

export function useCreateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTagInput) => api.tags.create(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.tags }),
  });
}

export function useUpdateTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateTagInput }) =>
      api.tags.update(id, patch),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.tags }),
  });
}

export function useDeleteTag() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.tags.remove(id),
    // Deleting a tag detaches it from every node and task.
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: keys.tags }),
        qc.invalidateQueries({ queryKey: keys.nodes }),
      ]),
  });
}

export interface TagLinkVars {
  ownerId: string;
  tagId: string;
  attached: boolean;
}

/**
 * Attach (`attached: true`) or detach a tag on a node or task. The server
 * answers with the updated owner, which is written straight into the cache.
 */
export function useTagLink(kind: TaggableKind) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ownerId, tagId, attached }: TagLinkVars) =>
      attached ? api.tags.attach(kind, ownerId, tagId) : api.tags.detach(kind, ownerId, tagId),
    onSuccess: async (owner: GraphNode | Task) => {
      if (kind === 'nodes') {
        qc.setQueryData(keys.node(owner.id), owner);
        await qc.invalidateQueries({ queryKey: keys.nodeLists });
      } else {
        await qc.invalidateQueries({ queryKey: keys.nodeTasks((owner as Task).nodeId) });
      }
    },
  });
}

function useInvalidateTasks(nodeId: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: keys.nodeTasks(nodeId) });
}

export function useCreateTask(nodeId: string) {
  const invalidate = useInvalidateTasks(nodeId);
  return useMutation({
    mutationFn: (input: CreateTaskInput) => api.tasks.create(input),
    onSuccess: invalidate,
  });
}

export function useUpdateTask(nodeId: string) {
  const invalidate = useInvalidateTasks(nodeId);
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateTaskInput }) =>
      api.tasks.update(id, patch),
    onSettled: invalidate,
  });
}

export function useDeleteTask(nodeId: string) {
  const invalidate = useInvalidateTasks(nodeId);
  return useMutation({ mutationFn: (id: string) => api.tasks.remove(id), onSuccess: invalidate });
}
