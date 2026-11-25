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
import {
  Component,
  lazy,
  Suspense,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type SubmitEvent,
} from 'react';
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
import { readJson, writeJson } from '../../commands/storage';
import { useCommandTooltip } from '../../commands/useCommandTooltip';
import { useI18n } from '../../i18n/context';
import { revealNodeId, useNodeContextMenu } from '../node/NodeContextMenu';
import { SettingsIcon } from '../../components/icons';
import { showToast } from '../../components/toast';
import { CircleNode } from './CircleNode';
import { useEdgeContextMenu } from './EdgeContextMenu';
import { useGraphSettings } from './graphSettings';
import { GraphSettingsPanel } from './GraphSettingsPanel';
import { pushAway, type Circle } from './collide';
import { useForceLayout } from './forceLayout';
import { EdgeRenameContext, FloatingEdge, GraphMarkers, type EdgeRename } from './FloatingEdge';
import { toFlowEdges, toFlowNodes, type KmFlowEdge, type KmFlowNode } from './flowMapping';
import { useTagColoring } from './useTagColoring';
import {
  buildAdjacency,
  GraphHighlightContext,
  NO_HIGHLIGHT,
  type GraphHighlight,
} from './highlight';
import { graph3dFailure, type Graph3DFailure } from './graph3dData';
import { RelationDialog } from './RelationDialog';
import { useReadOnly } from '../readOnly';

// three.js is big: only fetched when someone switches to 3D (and kept out of
// the service worker's precache, see vite.config.ts).
const Graph3D = lazy(() => import('./Graph3D'));

type GraphMode = '2d' | '3d';
const MODE_KEY = 'km.graph.mode';
const SETTINGS_OPEN_KEY = 'km.graph.settingsOpen';

export function GraphPage() {
  const { t } = useI18n();
  const [mode, setModeState] = useState<GraphMode>(() =>
    readJson(MODE_KEY) === '3d' ? '3d' : '2d',
  );
  const setMode = (m: GraphMode) => {
    setModeState(m);
    writeJson(MODE_KEY, m);
  };
  useCommandHandler('km.graph.toggle3d', () => {
    setMode(mode === '3d' ? '2d' : '3d');
  });
  const tip = useCommandTooltip('km.graph.toggle3d');
  // The settings panel sits beside the 2D canvas. Read-only (phone app) has its
  // own tab for the display settings instead, so the graph view stays clean.
  const readOnly = useReadOnly();
  const [settingsOpen, setSettingsOpenState] = useState(() => readJson(SETTINGS_OPEN_KEY) === true);
  // Focus moves into the panel when the user opens it (not when it is restored
  // open on load), and back to the gear when it closes.
  const [focusPanel, setFocusPanel] = useState(false);
  const gearRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const setSettingsOpen = (open: boolean) => {
    // Only if focus was in the panel: closing it from a shortcut leaves focus alone.
    const focusWasInside =
      document.getElementById(panelId)?.contains(document.activeElement) === true;
    setSettingsOpenState(open);
    setFocusPanel(open);
    writeJson(SETTINGS_OPEN_KEY, open);
    if (!open && focusWasInside) gearRef.current?.focus();
  };
  const canTune = mode === '2d' && !readOnly;
  useCommandHandler(
    'km.graph.toggleSettings',
    () => {
      setSettingsOpen(!settingsOpen);
    },
    canTune,
  );
  const settingsTip = useCommandTooltip('km.graph.toggleSettings', { always: true });

  return (
    <div className={`graph-shell${canTune ? ' can-tune' : ''}`}>
      {canTune && (
        <button
          type="button"
          ref={gearRef}
          className="graph-settings-toggle"
          aria-label={t('cmd.graphSettings')}
          aria-pressed={settingsOpen}
          aria-controls={settingsOpen ? panelId : undefined}
          {...settingsTip}
          onClick={() => {
            setSettingsOpen(!settingsOpen);
          }}
        >
          <SettingsIcon size={16} />
        </button>
      )}
      {canTune && settingsOpen && (
        <GraphSettingsPanel
          id={panelId}
          focusOnMount={focusPanel}
          onClose={() => {
            setSettingsOpen(false);
          }}
        />
      )}
      {/* Two toggle buttons, not tabs: no tab panel or arrow keys to promise. */}
      <div className="segmented graph-mode" role="group" aria-label={t('graph.mode')} {...tip}>
        {(['2d', '3d'] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => {
              setMode(m);
            }}
          >
            {t(m === '2d' ? 'graph.mode2d' : 'graph.mode3d')}
          </button>
        ))}
      </div>
      {mode === '3d' ? (
        <Graph3DBoundary
          fallback={(kind) => (
            <p className="empty">
              {t(kind === 'webgl' ? 'graph3d.unsupported' : 'graph3d.loadFailed')}
            </p>
          )}
        >
          <Suspense fallback={<p className="empty">{t('graph3d.loading')}</p>}>
            <Graph3D />
          </Suspense>
        </Graph3DBoundary>
      ) : (
        <ReactFlowProvider>
          <GraphCanvas />
        </ReactFlowProvider>
      )}
    </div>
  );
}

/** Say why 3D isn't showing (no WebGL vs. anything else, e.g. the chunk didn't load). */
class Graph3DBoundary extends Component<
  { fallback: (kind: Graph3DFailure) => ReactNode; children: ReactNode },
  { failed: Graph3DFailure | null }
> {
  override state: { failed: Graph3DFailure | null } = { failed: null };
  static getDerivedStateFromError(error: unknown) {
    return { failed: graph3dFailure(error) };
  }
  override render() {
    return this.state.failed ? this.props.fallback(this.state.failed) : this.props.children;
  }
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
  // Any view change the user asked for (a zoom, a fit, a reveal, a drag) keeps the
  // auto layout's first-settle fit from overriding it.
  const userMoved = useRef(false);
  /** A node the view should stay on while the dots are still settling (a reveal). */
  const followId = useRef<string | null>(null);
  const takeView = () => {
    userMoved.current = true;
    followId.current = null;
  };
  const fitAll = () => {
    takeView();
    void flow.fitView(fitViewOptions);
  };
  const zoomIn = () => {
    takeView();
    void flow.zoomIn();
  };
  const zoomOut = () => {
    takeView();
    void flow.zoomOut();
  };
  useCommandHandler('km.graph.fitView', fitAll);
  useCommandHandler('km.graph.zoomIn', zoomIn);
  useCommandHandler('km.graph.zoomOut', zoomOut);
  const zoomInTip = useCommandTooltip('km.graph.zoomIn', { always: true });
  const zoomOutTip = useCommandTooltip('km.graph.zoomOut', { always: true });
  const fitTip = useCommandTooltip('km.graph.fitView', { always: true });
  const nodeMenu = useNodeContextMenu();
  const edgeMenu = useEdgeContextMenu({
    onRename: (edge) => {
      setRenamingId(edge.id);
    },
    // Not removed from the canvas up front: the refetch after the delete does
    // it, and a failed delete then simply leaves the link where it was.
    onDelete: (edge) => {
      deleteEdge.mutate(edge.id, {
        onSuccess: () => {
          showToast(t('edgeMenu.deleted', { name: edge.name }));
        },
      });
    },
  });
  // Read-only (phone app): look and navigate; no drag, connect, rename, delete.
  const readOnly = useReadOnly();
  const settings = useGraphSettings();
  const { unlinkedRadius, linkedMinRadius, maxRadius } = settings;
  const sizes = useMemo(
    () => ({ unlinkedRadius, linkedMinRadius, maxRadius }),
    [unlinkedRadius, linkedMinRadius, maxRadius],
  );
  const tagColoring = useTagColoring(graph.data, settings);

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
    onlySelectedEdge !== undefined && !readOnly,
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
    const pushed = pushAway(draggedCircles, origins, {
      gap: settings.pushGap,
      reach: settings.pushReach,
      softness: settings.pushSoftness,
    });
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

  // Auto layout (forces): the dots place themselves; see forceLayout.ts.
  const auto = settings.autoLayout;
  const forces = useForceLayout({
    enabled: auto,
    nodes,
    edges,
    settings,
    setNodes,
    // The first rest: back on the revealed node (it moved while settling), or
    // the whole graph, unless the user already took the view elsewhere.
    onSettled: () => {
      const follow = followId.current;
      followId.current = null;
      if (follow !== null) {
        void flow.fitView({ nodes: [{ id: follow }], maxZoom: 1.5, duration: 300 });
      } else if (!userMoved.current) {
        void flow.fitView({ ...fitViewOptions, duration: 300 });
      }
    },
  });

  // A revealed dot moves while the forces settle: the view follows it.
  useEffect(() => {
    const id = followId.current;
    if (id === null) return;
    const n = nodes.find((node) => node.id === id);
    if (n) void flow.setCenter(n.position.x, n.position.y, { zoom: flow.getZoom() });
  }, [nodes, flow]);

  // "Reveal in Graph" from a node's menu: centre on it once it is on the canvas.
  const location = useLocation();
  const reveal = revealNodeId(location.state);
  const revealReady = reveal !== null && nodes.some((n) => n.id === reveal);
  useEffect(() => {
    if (!revealReady) return;
    userMoved.current = true;
    followId.current = reveal;
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
    setNodes((prev) => toFlowNodes(snapshot.nodes, snapshot.edges, prev, sizes, auto, tagColoring));
    setEdges((prev) => toFlowEdges(snapshot.edges, prev));
  }, [graph.data, dragging, setNodes, setEdges, sizes, auto, tagColoring]);

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
    <div
      className={`graph-page${dragging ? ' is-dragging' : ''}`}
      data-testid="graph-canvas"
      style={
        {
          '--node-label-size': `${String(settings.nodeLabelSize)}px`,
          '--node-label-opacity': String(settings.nodeLabelOpacity),
          '--edge-width': `${String(settings.linkWidth)}px`,
          '--edge-label-size': `${String(settings.linkLabelSize)}px`,
        } as CSSProperties
      }
    >
      {nodeMenu.element}
      {edgeMenu.element}
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
            nodesDraggable={!readOnly}
            nodesConnectable={!readOnly}
            deleteKeyCode={readOnly ? null : undefined}
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
            onMoveStart={(event) => {
              if (event) takeView(); // a pan or zoom by hand, not a fitView of ours
            }}
            onNodeDragStart={(_event, _node, dragged) => {
              takeView();
              setDragging(true);
              if (auto) {
                forces.hold(dragged);
                return;
              }
              dragOrigins.current = new Map(nodes.map((n) => [n.id, circleOf(n)]));
              pushedNow.current = new Map();
            }}
            onNodeDrag={(_event, _node, dragged) => {
              if (auto) forces.hold(dragged);
              else nudge(dragged);
            }}
            onNodeDragStop={(_event, _node, dragged) => {
              setDragging(false);
              // Forces: the dot goes back to them; nothing is saved (see forceLayout.ts).
              if (auto) {
                forces.release();
                return;
              }
              dragOrigins.current = null;
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
              if (!readOnly) setRenamingId(edge.id);
            }}
            onNodeContextMenu={(event, node) => {
              event.preventDefault();
              nodeMenu.open({ id: node.id, title: node.data.label }, event.clientX, event.clientY);
            }}
            onEdgeContextMenu={(event, edge) => {
              event.preventDefault();
              edgeMenu.open(
                {
                  id: edge.id,
                  name: edge.data?.name ?? '',
                  from: { id: edge.source, title: titleOf(edge.source) },
                  to: { id: edge.target, title: titleOf(edge.target) },
                },
                event.clientX,
                event.clientY,
              );
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
              <ControlButton aria-label={t('cmd.zoomIn')} {...zoomInTip} onClick={zoomIn}>
                <svg viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M5 0h2v5h5v2H7v5H5V7H0V5h5z" />
                </svg>
              </ControlButton>
              <ControlButton aria-label={t('cmd.zoomOut')} {...zoomOutTip} onClick={zoomOut}>
                <svg viewBox="0 0 12 12" aria-hidden="true">
                  <path d="M0 5h12v2H0z" />
                </svg>
              </ControlButton>
              <ControlButton aria-label={t('cmd.fitView')} {...fitTip} onClick={fitAll}>
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
              {!readOnly && <NewNodeForm />}
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
