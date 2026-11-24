import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type ForceLink,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from 'd3-force';
import { useEffect, useRef } from 'react';
import type { KmFlowEdge, KmFlowNode } from './flowMapping';
import type { GraphSettings } from './graphSettings';

/**
 * Dots that arrange themselves, like Obsidian's graph: links pull their ends
 * together, every dot pushes the others away, a light pull keeps the graph
 * centred, and dots never overlap. Dragging a dot holds it under the pointer
 * and the rest follow; on release it goes back to the forces.
 *
 * Positions are the simulation's, not saved: a layout that keeps moving
 * would otherwise count as an edit (and a change to push) all the time.
 */

interface SimNode extends SimulationNodeDatum {
  id: string;
  r: number;
}
type SimLink = SimulationLinkDatum<SimNode>;

export type ForceSettings = Pick<
  GraphSettings,
  'centerForce' | 'repelForce' | 'linkForce' | 'linkDistance'
>;

/** Gap kept between two dots' edges. */
const COLLIDE_PADDING = 6;

export interface ForceLayout {
  /** The pointer holds these dots (a drag): they stay where it puts them. */
  hold: (dragged: readonly { id: string; position: { x: number; y: number } }[]) => void;
  /** The drag ended: the held dots join the forces again. */
  release: () => void;
}

/**
 * Runs the simulation while `enabled`. It reads the canvas's dots and links
 * (ids, sizes, where they are), and writes positions back through
 * `setNodes`, once per animation frame. `onSettled` fires the first time it
 * comes to rest (to fit the view).
 */
export function useForceLayout(options: {
  enabled: boolean;
  nodes: readonly KmFlowNode[];
  edges: readonly KmFlowEdge[];
  settings: ForceSettings;
  setNodes: (update: (prev: KmFlowNode[]) => KmFlowNode[]) => void;
  onSettled?: () => void;
}): ForceLayout {
  const { enabled, nodes, edges, settings, setNodes } = options;
  const sim = useRef<Simulation<SimNode, SimLink> | null>(null);
  const byId = useRef(new Map<string, SimNode>());
  const held = useRef(new Set<string>());
  const settled = useRef(false);
  const onSettled = useRef(options.onSettled);
  useEffect(() => {
    onSettled.current = options.onSettled;
  });

  // Start and stop.
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const simulation = forceSimulation<SimNode, SimLink>([])
      .alphaDecay(0.03)
      .velocityDecay(0.35)
      .on('tick', () => {
        if (frame !== 0) return;
        frame = requestAnimationFrame(() => {
          frame = 0;
          setNodes((prev) => {
            let moved = false as boolean; // set inside the map below
            const next = prev.map((n) => {
              const s = byId.current.get(n.id);
              if (!s || s.x === undefined || s.y === undefined) return n;
              if (held.current.has(n.id)) return n; // React Flow moves it
              // Under half a unit isn't worth a render (the phone draws this too).
              if (Math.abs(s.x - n.position.x) < 0.5 && Math.abs(s.y - n.position.y) < 0.5) {
                return n;
              }
              moved = true;
              return { ...n, position: { x: s.x, y: s.y } };
            });
            return moved ? next : prev; // nothing moved: no re-render at all
          });
        });
      })
      .on('end', () => {
        // An empty canvas (data not there yet) isn't the first settle.
        if (settled.current || simulation.nodes().length === 0) return;
        settled.current = true;
        onSettled.current?.();
      });
    sim.current = simulation;
    return () => {
      simulation.stop();
      cancelAnimationFrame(frame);
      sim.current = null;
      byId.current = new Map();
      settled.current = false;
    };
  }, [enabled, setNodes]);

  // The dots and links (by identity, size and link structure, not position).
  const nodeKey = nodes.map((n) => `${n.id}:${String(n.data.radius)}`).join('|');
  const edgeKey = edges.map((e) => `${e.source}>${e.target}`).join('|');
  useEffect(() => {
    const simulation = sim.current;
    if (!simulation) return;
    const next = new Map<string, SimNode>();
    for (const n of nodes) {
      const known = byId.current.get(n.id);
      if (known) {
        // The same object (d3 holds it): keeps its place and speed.
        known.r = n.data.radius;
        next.set(n.id, known);
      } else {
        // A new dot starts where the canvas has it.
        next.set(n.id, { id: n.id, r: n.data.radius, x: n.position.x, y: n.position.y });
      }
    }
    byId.current = next;
    const simNodes = [...next.values()];
    // One spring per pair of dots, however many links (either way) join them.
    const pairs = new Map<string, SimLink>();
    for (const e of edges) {
      if (e.source === e.target || !next.has(e.source) || !next.has(e.target)) continue;
      const key = e.source < e.target ? `${e.source}|${e.target}` : `${e.target}|${e.source}`;
      if (!pairs.has(key)) pairs.set(key, { source: e.source, target: e.target });
    }
    const links = [...pairs.values()];
    simulation.nodes(simNodes);
    simulation.force(
      'link',
      forceLink<SimNode, SimLink>(links).id((d) => d.id),
    );
    applyForces(simulation, settings);
    if (simNodes.length > 0) simulation.alpha(Math.max(simulation.alpha(), 0.6)).restart();
    // Positions and settings are read inside; the keys above say when to run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, nodeKey, edgeKey]);

  // Tuning the forces: apply, and let the graph move to the new balance.
  const { centerForce, repelForce, linkForce, linkDistance } = settings;
  useEffect(() => {
    const simulation = sim.current;
    if (!simulation) return;
    applyForces(simulation, { centerForce, repelForce, linkForce, linkDistance });
    simulation.alpha(Math.max(simulation.alpha(), 0.4)).restart();
  }, [centerForce, repelForce, linkForce, linkDistance]);

  return {
    hold: (dragged) => {
      const simulation = sim.current;
      if (!simulation) return;
      for (const { id, position } of dragged) {
        const s = byId.current.get(id);
        if (!s) continue;
        held.current.add(id);
        s.fx = position.x;
        s.fy = position.y;
      }
      simulation.alphaTarget(0.3).restart();
    },
    release: () => {
      const simulation = sim.current;
      for (const id of held.current) {
        const s = byId.current.get(id);
        if (s) {
          s.fx = null;
          s.fy = null;
        }
      }
      held.current.clear();
      simulation?.alphaTarget(0);
    },
  };
}

function applyForces(simulation: Simulation<SimNode, SimLink>, s: ForceSettings): void {
  const link = simulation.force<ForceLink<SimNode, SimLink>>('link');
  link
    ?.distance((l) => s.linkDistance + (l.source as SimNode).r + (l.target as SimNode).r)
    .strength(s.linkForce);
  simulation
    .force('charge', forceManyBody<SimNode>().strength(-s.repelForce).distanceMax(1200))
    .force('x', forceX<SimNode>(0).strength(s.centerForce))
    .force('y', forceY<SimNode>(0).strength(s.centerForce))
    .force('collide', forceCollide<SimNode>((d) => d.r + COLLIDE_PADDING).strength(0.9));
}
