import { LOCAL_GRAPH_MAX_DEPTH } from '@km/core';
import {
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type EdgeTypes,
  type NodeTypes,
} from '@xyflow/react';
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router';
import { useLocalGraph, useWikilinks } from '../../api/queries';
import { readJson, writeJson } from '../../commands/storage';
import { isCoarsePointer } from '../../hooks/pointer';
import { useI18n } from '../../i18n/context';
import { CircleNode } from './CircleNode';
import { FloatingEdge } from './FloatingEdge';
import {
  toFlowEdges,
  toFlowNodes,
  toWikilinkEdges,
  type KmFlowEdge,
  type KmFlowNode,
} from './flowMapping';
import { useForceLayout } from './forceLayout';
import { useGraphSettings } from './graphSettings';
import { WikilinkEdge } from './WikilinkEdge';

const DEPTH_KEY = 'km.localGraph.depth';
const OPEN_KEY = 'km.localGraph.open';
const DEPTHS = Array.from({ length: LOCAL_GRAPH_MAX_DEPTH }, (_, i) => i + 1);

const readDepth = (): number => {
  const saved = readJson(DEPTH_KEY);
  return typeof saved === 'number' && DEPTHS.includes(saved) ? saved : 1;
};

const nodeTypes: NodeTypes = { circle: CircleNode };
const edgeTypes: EdgeTypes = { floating: FloatingEdge, wikilink: WikilinkEdge };
const nodeOrigin: [number, number] = [0.5, 0.5];
const fitOptions = { padding: 0.2, maxZoom: 1.2 };

/**
 * Side panel of the node being edited: the node and everything up to
 * `depth` links away (its own depth, apart from Link check's), arranging
 * itself like the big graph. Click a dot to open it. Look only: nothing here
 * edits the graph. Editable node page only, like the other panels.
 */
export function LocalGraphPanel({ nodeId }: { nodeId: string }) {
  const { t } = useI18n();
  const [depth, setDepthState] = useState(readDepth);
  const [open, setOpenState] = useState(() => readJson(OPEN_KEY) !== false);
  const setDepth = (d: number) => {
    setDepthState(d);
    writeJson(DEPTH_KEY, d);
  };
  const setOpen = (o: boolean) => {
    setOpenState(o);
    writeJson(OPEN_KEY, o);
  };
  return (
    <section className="panel local-graph-panel" aria-label={t('localGraph.heading')}>
      <div className="local-graph-head">
        <h3>
          <button
            type="button"
            className="subtle panel-toggle"
            aria-expanded={open}
            onClick={() => {
              setOpen(!open);
            }}
          >
            {t('localGraph.heading')}
          </button>
        </h3>
        {open && (
          <select
            aria-label={t('localGraph.depth')}
            value={depth}
            onChange={(e) => {
              setDepth(Number(e.target.value));
            }}
          >
            {DEPTHS.map((d) => (
              <option key={d} value={d}>
                {t('localGraph.depthN', { depth: d })}
              </option>
            ))}
          </select>
        )}
      </div>
      {open && (
        <ReactFlowProvider>
          <LocalGraphCanvas nodeId={nodeId} depth={depth} />
        </ReactFlowProvider>
      )}
    </section>
  );
}

function LocalGraphCanvas({ nodeId, depth }: { nodeId: string; depth: number }) {
  const { t, errorText } = useI18n();
  const local = useLocalGraph(nodeId, depth);
  const settings = useGraphSettings();
  const wikilinks = useWikilinks(settings.showWikilinks);
  const navigate = useNavigate();
  const flow = useReactFlow<KmFlowNode, KmFlowEdge>();
  const [nodes, setNodes] = useNodesState<KmFlowNode>([]);
  const [edges, setEdges] = useEdgesState<KmFlowEdge>([]);
  const { unlinkedRadius, linkedMinRadius, maxRadius } = settings;
  const sizes = useMemo(
    () => ({ unlinkedRadius, linkedMinRadius, maxRadius }),
    [unlinkedRadius, linkedMinRadius, maxRadius],
  );

  useEffect(() => {
    if (!local.data) return;
    // Saved positions belong to the big graph's hand layout: start compact and let the forces arrange.
    const summaries = local.data.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      title: n.title,
      position: null,
    }));
    const graphEdges = local.data.edges;
    setNodes((prev) =>
      toFlowNodes(summaries, graphEdges, prev, sizes, true).map((n) => ({
        ...n,
        selected: n.id === nodeId, // the node being edited stands out
      })),
    );
    setEdges((prev) => toFlowEdges(graphEdges, prev));
  }, [local.data, nodeId, sizes, setNodes, setEdges]);

  const wikiEdges = useMemo(
    () =>
      settings.showWikilinks && wikilinks.data && local.data
        ? toWikilinkEdges(
            wikilinks.data,
            local.data.edges,
            new Set(local.data.nodes.map((n) => n.id)),
          )
        : [],
    [settings.showWikilinks, wikilinks.data, local.data],
  );
  const drawnEdges = useMemo(() => [...edges, ...wikiEdges], [edges, wikiEdges]);

  useForceLayout({
    enabled: true,
    nodes,
    edges,
    settings,
    setNodes,
  });
  // The view follows the dots while they settle (also after a depth change),
  // until the user pans or zooms it themselves.
  const [userMoved, setUserMoved] = useState(false);
  useEffect(() => {
    if (!userMoved && nodes.length > 0) void flow.fitView(fitOptions);
  }, [nodes, userMoved, flow]);

  return (
    <div
      className="local-graph graph-page"
      data-testid="local-graph"
      style={
        {
          '--node-label-size': `${String(settings.nodeLabelSize)}px`,
          '--node-label-opacity': String(settings.nodeLabelOpacity),
          '--edge-width': `${String(settings.linkWidth)}px`,
          '--edge-label-size': `${String(settings.linkLabelSize)}px`,
        } as CSSProperties
      }
    >
      {local.isError && <p className="error">{errorText(local.error)}</p>}
      {local.data?.nodes.length === 1 && <p className="muted">{t('localGraph.alone')}</p>}
      <ReactFlow<KmFlowNode, KmFlowEdge>
        nodes={nodes}
        edges={drawnEdges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        nodeOrigin={nodeOrigin}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        deleteKeyCode={null}
        onNodeClick={(_event, node) => {
          if (node.id !== nodeId) void navigate(`/nodes/${node.id}`);
        }}
        // An embed in a scrolling page: the wheel scrolls the page (Ctrl+wheel or
        // pinch zooms), and on touch screens a drag scrolls too, not pans.
        preventScrolling={false}
        zoomOnScroll={false}
        panOnDrag={!isCoarsePointer()}
        onMoveStart={(event) => {
          if (event) setUserMoved(true); // a pan or zoom by hand, not our fit
        }}
        fitView
        fitViewOptions={fitOptions}
        minZoom={0.1}
      />
    </div>
  );
}
