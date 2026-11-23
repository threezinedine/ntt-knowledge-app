import { nodeTitleSchema } from '@km/core';
import {
  ConnectionMode,
  ControlButton,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type EdgeTypes,
  type FitViewOptions,
  type NodeTypes,
  type OnBeforeDelete,
} from '@xyflow/react';
import { useEffect, useMemo, useRef, useState, type SubmitEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import {
  useCreateEdge,
  useCreateNode,
  useDeleteEdge,
  useGraph,
  useMovePositions,
  useUpdateEdge,
} from '../../api/queries';
import { useCommandHandler } from '../../commands/registry';
import { useCommandTooltip } from '../../commands/useCommandTooltip';
import { useI18n } from '../../i18n/context';
import { revealNodeId, useNodeContextMenu } from '../node/NodeContextMenu';
import { CircleNode } from './CircleNode';
import { pushAway, type Circle } from './collide';
import { EdgeRenameContext, FloatingEdge, GraphMarkers, type EdgeRename } from './FloatingEdge';
import { toFlowEdges, toFlowNodes, type KmFlowEdge, type KmFlowNode } from './flowMapping';
import {
  buildAdjacency,
  GraphHighlightContext,
  NO_HIGHLIGHT,
  type GraphHighlight,
} from './highlight';
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

// Module-level so React Flow sees stable references (it warns otherwise).
const nodeTypes: NodeTypes = { circle: CircleNode };
const nodeOrigin: [number, number] = [0.5, 0.5];
/** Keep dots clear of the toolbar panel (top), minimap/controls (bottom) and labels. */
const fitViewOptions: FitViewOptions<KmFlowNode> = {
  maxZoom: 1.5,
  padding: { top: '110px', bottom: '170px', left: '60px', right: '60px' },
};
const edgeTypes: EdgeTypes = { floating: FloatingEdge };

function GraphCanvas() {
  const graph = useGraph();
  const [nodes, setNodes, onNodesChange] = useNodesState<KmFlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<KmFlowEdge>([]);
  const [pendingConnection, setPendingConnection] = useState<Connection | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const movePositions = useMovePositions();
  const createEdge = useCreateEdge();
  const deleteEdge = useDeleteEdge();
  const updateEdge = useUpdateEdge();
  const navigate = useNavigate();
  const { t, errorText } = useI18n();
  const flow = useReactFlow<KmFlowNode, KmFlowEdge>();
  useCommandHandler('km.graph.fitView', () => void flow.fitView(fitViewOptions));
  useCommandHandler('km.graph.zoomIn', () => void flow.zoomIn());
  useCommandHandler('km.graph.zoomOut', () => void flow.zoomOut());
  const zoomInTip = useCommandTooltip('km.graph.zoomIn', { always: true });
  const zoomOutTip = useCommandTooltip('km.graph.zoomOut', { always: true });
  const fitTip = useCommandTooltip('km.graph.fitView', { always: true });
  const nodeMenu = useNodeContextMenu();

  const renameEdge = updateEdge.mutate; // stable, unlike the mutation object
  // Renaming a link: double-click it, or "Rename Link" with one link selected.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const selectedEdges = edges.filter((e) => e.selected);
  const onlySelectedEdge = selectedEdges.length === 1 ? selectedEdges[0] : undefined;
  useCommandHandler(
    'km.edge.rename',
    () => {
      if (onlySelectedEdge) setRenamingId(onlySelectedEdge.id);
    },
    onlySelectedEdge !== undefined,
  );
  const edgeRename = useMemo<EdgeRename>(
    () => ({
      editingId: renamingId,
      commit: (id, name) => {
        setRenamingId(null);
        const setName = (to: string) => {
          setEdges((prev) =>
            prev.map((e) =>
              e.id === id && e.data ? { ...e, label: to, data: { ...e.data, name: to } } : e,
            ),
          );
        };
        // Show the new name at once. On failure put the server's name back
        // directly: the refetch returns the same data, so the sync effect
        // wouldn't run again.
        const previous = graph.data?.edges.find((e) => e.id === id)?.name;
        setName(name);
        renameEdge(
          { id, patch: { name } },
          {
            onError: () => {
              if (previous !== undefined) setName(previous);
            },
          },
        );
      },
      cancel: () => {
        setRenamingId(null);
      },
    }),
    [renamingId, setEdges, renameEdge, graph.data],
  );

  // Dragging a dot near others nudges them out of the way (see collide.ts).
  // Origins are where every dot was when the drag began; pushed dots are
  // placed relative to them, so they settle back once the drag moves on.
  const dragOrigins = useRef<Map<string, Circle> | null>(null);
  /** Result of the latest nudge: what to save on drop (the render may lag behind). */
  const pushedNow = useRef<ReadonlyMap<string, { x: number; y: number }>>(new Map());
  const [dragging, setDragging] = useState(false);
  const circleOf = (n: KmFlowNode): Circle => ({
    x: n.position.x,
    y: n.position.y,
    r: n.data.radius,
  });
  const nudge = (dragged: readonly KmFlowNode[]) => {
    const origins = dragOrigins.current;
    if (!origins) return;
    const draggedCircles = new Map(dragged.map((n) => [n.id, circleOf(n)]));
    const pushed = pushAway(draggedCircles, origins);
    pushedNow.current = pushed;
    setNodes((prev) =>
      prev.map((n) => {
        if (draggedCircles.has(n.id)) return n;
        const target = pushed.get(n.id) ?? origins.get(n.id);
        if (!target || (target.x === n.position.x && target.y === n.position.y)) return n;
        return { ...n, position: { x: target.x, y: target.y } };
      }),
    );
  };

  // "Reveal in Graph" from a node's menu: centre on it once it is on the canvas.
  const location = useLocation();
  const reveal = revealNodeId(location.state);
  const revealReady = reveal !== null && nodes.some((n) => n.id === reveal);
  useEffect(() => {
    if (!revealReady) return;
    void flow.fitView({ nodes: [{ id: reveal }], maxZoom: 1.5, duration: 300 });
    setNodes((prev) => prev.map((n) => ({ ...n, selected: n.id === reveal })));
    void navigate(location, { replace: true, state: null }); // once
  }, [revealReady, reveal, flow, setNodes, navigate, location]);

  // React Flow owns interactive state (dragging, selection); the server is the
  // source of truth, so re-sync whenever a fresh snapshot arrives.
  // Not mid-drag: a refetch would put pushed dots back; it is applied on drop.
  useEffect(() => {
    if (!graph.data || dragging) return;
    const snapshot = graph.data;
    setNodes((prev) => toFlowNodes(snapshot.nodes, snapshot.edges, prev));
    setEdges((prev) => toFlowEdges(snapshot.edges, prev));
  }, [graph.data, dragging, setNodes, setEdges]);

  const adjacency = useMemo(() => buildAdjacency(edges), [edges]);
  const highlight = useMemo<GraphHighlight>(
    () =>
      hoveredId === null
        ? NO_HIGHLIGHT
        : { activeId: hoveredId, neighborIds: adjacency.get(hoveredId) ?? new Set() },
    [hoveredId, adjacency],
  );

  const titleOf = (id: string) => nodes.find((n) => n.id === id)?.data.label ?? '?';

  const closeDialog = () => {
    setPendingConnection(null);
    createEdge.reset();
  };

  return (
    <div className={`graph-page${dragging ? ' is-dragging' : ''}`} data-testid="graph-canvas">
      {nodeMenu.element}
      <GraphMarkers />
      <GraphHighlightContext value={highlight}>
        <EdgeRenameContext value={edgeRename}>
          <ReactFlow<KmFlowNode, KmFlowEdge>
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodeMouseEnter={(_event, node) => {
              setHoveredId(node.id);
            }}
            onNodeMouseLeave={() => {
              setHoveredId(null);
            }}
            // Loose: ending on *any* handle of another node connects (the dot's own
            // grip included), so the whole dot and its label are a drop target.
            connectionMode={ConnectionMode.Loose}
            connectionRadius={40}
            // Self-loops come from the node page; on the canvas a short drag from the
            // grip would otherwise snap back onto the same node.
            isValidConnection={(c) => c.source !== c.target}
            // Stored position = circle centre, so it doesn't drift as the radius
            // (which grows with link count) changes.
            nodeOrigin={nodeOrigin}
            connectionLineStyle={{ stroke: 'var(--graph-accent)', strokeWidth: 1.5 }}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={setPendingConnection}
            onBeforeDelete={onlyEdges}
            onEdgesDelete={(deleted) => {
              for (const edge of deleted) deleteEdge.mutate(edge.id);
            }}
            onNodeDragStart={() => {
              dragOrigins.current = new Map(nodes.map((n) => [n.id, circleOf(n)]));
              pushedNow.current = new Map();
              setDragging(true);
            }}
            onNodeDrag={(_event, _node, dragged) => {
              nudge(dragged);
            }}
            onNodeDragStop={(_event, _node, dragged) => {
              dragOrigins.current = null;
              setDragging(false);
              // The dragged dots and the ones they pushed, in one request.
              const items = [
                ...dragged.map((n) => ({ id: n.id, position: n.position })),
                ...[...pushedNow.current].map(([id, position]) => ({ id, position })),
              ];
              pushedNow.current = new Map();
              movePositions.mutate({ items }); // failures show in the panel below
            }}
            onNodeDoubleClick={(_event, node) => void navigate(`/nodes/${node.id}`)}
            onEdgeDoubleClick={(_event, edge) => {
              setRenamingId(edge.id);
            }}
            onNodeContextMenu={(event, node) => {
              event.preventDefault();
              nodeMenu.open({ id: node.id, title: node.data.label }, event.clientX, event.clientY);
            }}
            fitView
            fitViewOptions={fitViewOptions}
            minZoom={0.1}
          >
            {/* Our own buttons: translated labels and shortcut tooltips. */}
            <Controls
              showZoom={false}
              showFitView={false}
              showInteractive={false}
              aria-label={t('graph.controls')}
            >
              <ControlButton
                aria-label={t('cmd.zoomIn')}
                {...zoomInTip}
                onClick={() => void flow.zoomIn()}
              >
                <svg viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M5 0h2v5h5v2H7v5H5V7H0V5h5z" />
                </svg>
              </ControlButton>
              <ControlButton
                aria-label={t('cmd.zoomOut')}
                {...zoomOutTip}
                onClick={() => void flow.zoomOut()}
              >
                <svg viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M0 5h12v2H0z" />
                </svg>
              </ControlButton>
              <ControlButton
                aria-label={t('cmd.fitView')}
                {...fitTip}
                onClick={() => void flow.fitView(fitViewOptions)}
              >
                <svg viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M0 0h4v1.5H1.5V4H0zm8 0h4v4h-1.5V1.5H8zM0 8h1.5v2.5H4V12H0zm10.5 0H12v4H8v-1.5h2.5z" />
                </svg>
              </ControlButton>
            </Controls>
            <MiniMap<KmFlowNode>
              pannable
              zoomable
              nodeColor={(n) => n.data.color}
              nodeBorderRadius={999}
              bgColor="#1a1a1e"
              maskColor="rgb(10 10 12 / 60%)"
            />
            {/* One stacked panel: separate panels overlap (and steal taps) on narrow screens. */}
            <Panel position="top-left" className="graph-panel">
              <NewNodeForm />
              {graph.isError && <p className="error">{errorText(graph.error)}</p>}
              {movePositions.isError && (
                <p className="error">
                  {t('graph.savePositionFailed', { error: errorText(movePositions.error) })}
                </p>
              )}
              {updateEdge.isError && (
                <p className="error">
                  {t('graph.renameLinkFailed', { error: errorText(updateEdge.error) })}
                </p>
              )}
              {deleteEdge.isError && (
                <p className="error">
                  {t('graph.deleteLinkFailed', { error: errorText(deleteEdge.error) })}
                </p>
              )}
              {graph.data?.nodes.length === 0 && <p className="muted">{t('graph.empty')}</p>}
            </Panel>
          </ReactFlow>
        </EdgeRenameContext>
      </GraphHighlightContext>

      {pendingConnection && (
        <RelationDialog
          sourceTitle={titleOf(pendingConnection.source)}
          targetTitle={titleOf(pendingConnection.target)}
          pending={createEdge.isPending}
          error={createEdge.isError ? errorText(createEdge.error) : null}
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
  const { t, errorText } = useI18n();
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
    <form ref={formRef} className="toolbar" onSubmit={submit} aria-label={t('graph.newNodeForm')}>
      <input
        aria-label={t('graph.newNodeTitle')}
        placeholder={t('graph.newNodePlaceholder')}
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
        }}
      />
      <button type="submit" disabled={!valid || createNode.isPending}>
        {t('graph.addNode')}
      </button>
      {createNode.isError && <span className="error">{errorText(createNode.error)}</span>}
    </form>
  );
}
