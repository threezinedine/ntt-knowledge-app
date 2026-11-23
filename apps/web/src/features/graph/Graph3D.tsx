import { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph3D, { type ForceGraphMethods } from 'react-force-graph-3d';
import { useLocation, useNavigate } from 'react-router';
import type { Object3D } from 'three';
import { useGraph } from '../../api/queries';
import { useCommandHandler } from '../../commands/registry';
import { useI18n } from '../../i18n/context';
import { revealNodeId, useNodeContextMenu } from '../node/NodeContextMenu';
import { endId, toGraph3D, type Graph3DData, type Link3D, type Node3D } from './graph3dData';
import { BG, SceneStyler } from './graph3dScene';

const DOUBLE_CLICK_MS = 350;

type Fg = ForceGraphMethods<Node3D, Link3D>;
interface Vec {
  x: number;
  y: number;
  z: number;
}
/** TrackballControls, as far as we use it. */
interface Controls {
  target: Vec;
}
/** Set by the engine on curved links. */
interface Curved {
  __curve?: { getPoint: (t: number) => Vec };
}

// Accessors live at module level on purpose: the engine rebuilds every object
// when one of these props changes identity (see SceneStyler).
const noTooltip = () => '';
const linkCurvature = (l: Link3D) => l.curvature;
const placeLinkLabel = (
  sprite: Object3D,
  { start, end }: { start: Vec; end: Vec },
  link: object, // the library types this generically
) => {
  const mid = (link as Curved).__curve?.getPoint(0.5) ?? {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
    z: (start.z + end.z) / 2,
  };
  sprite.position.set(mid.x, mid.y, mid.z);
};

/**
 * The graph as spheres in 3D space (force layout, orbit with the mouse or
 * touch). Read-and-navigate: click focuses a node, double-click opens it,
 * right-click has the node menu. Layout here is not saved; the 2D canvas
 * keeps its own positions.
 */
export default function Graph3D() {
  const graph = useGraph();
  const navigate = useNavigate();
  const location = useLocation();
  const { t, errorText } = useI18n();
  const nodeMenu = useNodeContextMenu();
  const fg = useRef<Fg | undefined>(undefined);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // One per mount; owns the meshes and restyles them on hover (no re-render).
  const [styler] = useState(() => new SceneStyler());
  const lastClick = useRef<{ id: string; at: number } | null>(null);
  const fitted = useRef(false);

  // The canvas needs pixel sizes; follow the container.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  // Re-sync on each snapshot, carrying over where the engine put known nodes
  // (React's "adjust state while rendering" pattern, not an effect).
  const [synced, setSynced] = useState<{ from: unknown; data: Graph3DData }>({
    from: null,
    data: { nodes: [], links: [] },
  });
  if (graph.data && synced.from !== graph.data) {
    const { nodes, edges } = graph.data;
    setSynced({ from: graph.data, data: toGraph3D(nodes, edges, synced.data.nodes) });
  }
  const { data } = synced;

  const neighbours = useMemo(() => {
    const out = new Map<string, Set<string>>();
    for (const l of data.links) {
      const [a, b] = [endId(l.source), endId(l.target)];
      out.set(a, (out.get(a) ?? new Set()).add(b));
      out.set(b, (out.get(b) ?? new Set()).add(a));
    }
    return out;
  }, [data]);
  // After the engine has applied new data (child effects run first): forget
  // removed objects and style the freshly built link meshes.
  useEffect(() => {
    styler.setNeighbours(neighbours);
    styler.prune(new Set(data.nodes.map((n) => n.id)), new Set(data.links.map((l) => l.id)));
    styler.restyleLinks();
  }, [styler, data, neighbours]);

  const focusNode = (node: Node3D, ms = 600) => {
    const { x = 0, y = 0, z = 0 } = node;
    // Stand back along the line from the origin through the node.
    const len = Math.hypot(x, y, z) || 1;
    const back = 1 + 90 / len;
    fg.current?.cameraPosition({ x: x * back, y: y * back, z: z * back }, { x, y, z }, ms);
  };

  const zoomBy = (factor: number) => {
    const g = fg.current;
    if (!g) return;
    const cam = g.camera().position;
    const { target } = g.controls() as Controls;
    g.cameraPosition(
      {
        x: target.x + (cam.x - target.x) * factor,
        y: target.y + (cam.y - target.y) * factor,
        z: target.z + (cam.z - target.z) * factor,
      },
      target,
      200,
    );
  };
  useCommandHandler('km.graph.fitView', () => fg.current?.zoomToFit(400, 40));
  useCommandHandler('km.graph.zoomIn', () => {
    zoomBy(0.8);
  });
  useCommandHandler('km.graph.zoomOut', () => {
    zoomBy(1.25);
  });

  // "Reveal in Graph": fly to the node once the engine has placed it.
  const reveal = revealNodeId(location.state);
  useEffect(() => {
    if (reveal === null) return;
    const node = data.nodes.find((n) => n.id === reveal);
    if (!node) return;
    const timer = setTimeout(() => {
      focusNode(node, 800);
      void navigate(location, { replace: true, state: null }); // once
    }, 600);
    return () => {
      clearTimeout(timer);
    };
  }, [reveal, data, navigate, location]);

  return (
    <div className="graph-3d">
      {nodeMenu.element}
      {graph.isError && <p className="error graph-3d-error">{errorText(graph.error)}</p>}
      <div
        ref={box}
        className="graph-3d-canvas"
        data-testid="graph-3d"
        role="img"
        aria-label={t('graph3d.label', { nodes: data.nodes.length, links: data.links.length })}
        onContextMenu={(e) => {
          e.preventDefault(); // the canvas has its own node menu
        }}
      >
        {size.width > 0 && (
          <ForceGraph3D<Node3D, Link3D>
            ref={fg}
            width={size.width}
            height={size.height}
            graphData={data}
            backgroundColor={BG}
            showNavInfo={false}
            nodeId="id"
            nodeLabel={noTooltip}
            nodeThreeObject={styler.nodeObject}
            linkWidth={0.4}
            linkMaterial={styler.linkMaterial}
            linkCurvature={linkCurvature}
            linkDirectionalArrowLength={3.5}
            linkDirectionalArrowRelPos={1}
            linkLabel={noTooltip}
            linkThreeObjectExtend
            linkThreeObject={styler.linkObject}
            linkPositionUpdate={placeLinkLabel}
            onNodeHover={(n) => {
              styler.highlight(n?.id ?? null);
              if (box.current) box.current.style.cursor = n ? 'pointer' : '';
            }}
            onNodeClick={(n) => {
              const now = Date.now();
              const prev = lastClick.current;
              if (prev?.id === n.id && now - prev.at < DOUBLE_CLICK_MS) {
                lastClick.current = null;
                void navigate(`/nodes/${n.id}`);
                return;
              }
              lastClick.current = { id: n.id, at: now };
              focusNode(n);
            }}
            onNodeRightClick={(n, e) => {
              nodeMenu.open({ id: n.id, title: n.title }, e.clientX, e.clientY);
            }}
            onNodeDragEnd={(n) => {
              // Pin where it was dropped, like arranging by hand in 2D.
              n.fx = n.x;
              n.fy = n.y;
              n.fz = n.z;
            }}
            cooldownTime={4000}
            onEngineStop={() => {
              // Frame the graph once the first layout settles; later, leave the camera be.
              if (fitted.current) return;
              fitted.current = true;
              fg.current?.zoomToFit(600, 40);
            }}
          />
        )}
      </div>
    </div>
  );
}
