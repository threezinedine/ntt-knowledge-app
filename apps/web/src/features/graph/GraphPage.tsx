import { nodeTitleSchema } from '@km/core';
import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type OnBeforeDelete,
} from '@xyflow/react';
import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { useNavigate } from 'react-router';
import { errorMessage } from '../../api/client';
import {
  useCreateEdge,
  useCreateNode,
  useDeleteEdge,
  useGraph,
  useUpdateNode,
} from '../../api/queries';
import { toFlowEdges, toFlowNodes, type KmFlowEdge, type KmFlowNode } from './flowMapping';
import { RelationDialog } from './RelationDialog';

export function GraphPage() {
  return (
    <ReactFlowProvider>
      <GraphCanvas />
    </ReactFlowProvider>
  );
}

/** Only edges may be deleted from the canvas; deleting nodes is a deliberate action on the node page. */
const onlyEdges: OnBeforeDelete<KmFlowNode, KmFlowEdge> = ({ edges }) =>
  Promise.resolve({ nodes: [], edges });

function GraphCanvas() {
  const graph = useGraph();
  const [nodes, setNodes, onNodesChange] = useNodesState<KmFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<KmFlowEdge>([]);
  const [pendingConnection, setPendingConnection] = useState<Connection | null>(null);

  const updateNode = useUpdateNode();
  const createEdge = useCreateEdge();
  const deleteEdge = useDeleteEdge();
  const navigate = useNavigate();

  // React Flow owns interactive state (dragging, selection); the server is the
  // source of truth, so re-sync whenever a fresh snapshot arrives.
  useEffect(() => {
    if (!graph.data) return;
    const snapshot = graph.data;
    setNodes((prev) => toFlowNodes(snapshot.nodes, prev));
    setEdges((prev) => toFlowEdges(snapshot.edges, prev));
  }, [graph.data, setNodes, setEdges]);

  const titleOf = (id: string) => nodes.find((n) => n.id === id)?.data.label ?? '?';

  const closeDialog = () => {
    setPendingConnection(null);
    createEdge.reset();
  };

  return (
    <div className="graph-page" data-testid="graph-canvas">
      <ReactFlow<KmFlowNode, KmFlowEdge>
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={setPendingConnection}
        onBeforeDelete={onlyEdges}
        onEdgesDelete={(deleted) => {
          for (const edge of deleted) deleteEdge.mutate(edge.id);
        }}
        onNodeDragStop={(_event, _node, dragged) => {
          for (const n of dragged) {
            updateNode.mutate({ id: n.id, patch: { position: n.position } });
          }
        }}
        onNodeDoubleClick={(_event, node) => void navigate(`/nodes/${node.id}`)}
        fitView
        minZoom={0.1}
      >
        <Background />
        <Controls />
        <MiniMap pannable zoomable />
        {/* One stacked panel: separate panels overlap (and steal taps) on narrow screens. */}
        <Panel position="top-left" className="graph-panel">
          <NewNodeForm />
          {graph.isError && <p className="error">{errorMessage(graph.error)}</p>}
          {deleteEdge.isError && (
            <p className="error">Could not delete link: {errorMessage(deleteEdge.error)}</p>
          )}
          {graph.data?.nodes.length === 0 && (
            <p className="muted">
              Empty graph. Add a node, then drag from a node&apos;s bottom handle to another node.
            </p>
          )}
        </Panel>
      </ReactFlow>

      {pendingConnection && (
        <RelationDialog
          sourceTitle={titleOf(pendingConnection.source)}
          targetTitle={titleOf(pendingConnection.target)}
          pending={createEdge.isPending}
          error={createEdge.isError ? errorMessage(createEdge.error) : null}
          onCancel={closeDialog}
          onSubmit={(name) => {
            createEdge.mutate(
              { fromId: pendingConnection.source, toId: pendingConnection.target, name },
              { onSuccess: closeDialog },
            );
          }}
        />
      )}
    </div>
  );
}

function NewNodeForm() {
  const [title, setTitle] = useState('');
  const createNode = useCreateNode();
  const { screenToFlowPosition } = useReactFlow();
  const formRef = useRef<HTMLFormElement>(null);
  const valid = nodeTitleSchema.safeParse(title).success;

  const submit = (e: SubmitEvent) => {
    e.preventDefault();
    if (!valid) return;
    // Drop the new node in the middle of the visible canvas.
    const canvas = formRef.current?.closest('.react-flow')?.getBoundingClientRect();
    const position = canvas
      ? screenToFlowPosition({
          x: canvas.left + canvas.width / 2,
          y: canvas.top + canvas.height / 2,
        })
      : null;
    createNode.mutate(
      { title, position },
      {
        onSuccess: () => {
          setTitle('');
        },
      },
    );
  };

  return (
    <form ref={formRef} className="toolbar" onSubmit={submit} aria-label="New node">
      <input
        aria-label="New node title"
        placeholder="New node title…"
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
        }}
      />
      <button type="submit" disabled={!valid || createNode.isPending}>
        Add node
      </button>
      {createNode.isError && <span className="error">{errorMessage(createNode.error)}</span>}
    </form>
  );
}
