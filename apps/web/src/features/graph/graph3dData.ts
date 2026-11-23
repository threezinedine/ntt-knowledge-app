import type { Edge, NodeSummary } from '@km/core';
import { degrees } from './flowMapping';
import { DEFAULT_NODE_COLOR, radiusForDegree, typeColors } from './graphGeometry';

/** A sphere in the 3D view. x/y/z (and the v*, f* fields) are owned by the force engine. */
export interface Node3D {
  id: string;
  title: string;
  color: string;
  /** Sphere radius in world units, from the link count like the 2D dots. */
  radius: number;
  x?: number;
  y?: number;
  z?: number;
  vx?: number;
  vy?: number;
  vz?: number;
  fx?: number;
  fy?: number;
  fz?: number;
}

export interface Link3D {
  id: string;
  name: string;
  source: string | Node3D;
  target: string | Node3D;
  /** Bend so parallel links between the same pair (and self-loops) don't overlap. */
  curvature: number;
}

export interface Graph3DData {
  nodes: Node3D[];
  links: Link3D[];
}

/** 2D positions are in pixels; the 3D world is smaller. */
const SEED_SCALE = 0.25;
const CURVE_STEP = 0.3;

/**
 * Server snapshot → force-graph data. Nodes keep the engine's coordinates
 * from `previous` (a refetch must not restart the layout); new nodes start
 * near their 2D spot, so the first 3D layout resembles the 2D one.
 */
export function toGraph3D(
  nodes: readonly NodeSummary[],
  edges: readonly Edge[],
  previous: readonly Node3D[] = [],
): Graph3DData {
  const prevById = new Map(previous.map((n) => [n.id, n]));
  const degree = degrees(edges);
  const colors = typeColors(nodes.map((n) => n.type));
  const ids = new Set(nodes.map((n) => n.id));

  const out3d: Node3D[] = nodes.map((node, i) => {
    const prev = prevById.get(node.id);
    const base: Node3D = {
      id: node.id,
      title: node.title,
      color: colors.get(node.type) ?? DEFAULT_NODE_COLOR,
      radius: radiusForDegree(degree.get(node.id) ?? 0) / 2,
    };
    if (prev) {
      const { x, y, z, vx, vy, vz, fx, fy, fz } = prev;
      return { ...base, x, y, z, vx, vy, vz, fx, fy, fz };
    }
    if (node.position) {
      // Small deterministic depth spread so the engine has a 3D start.
      const z = ((i % 7) - 3) * 4;
      return { ...base, x: node.position.x * SEED_SCALE, y: -node.position.y * SEED_SCALE, z };
    }
    return base;
  });

  // Group links by unordered pair; spread each group's curvature around 0.
  const groups = new Map<string, Edge[]>();
  for (const edge of edges) {
    if (!ids.has(edge.fromId) || !ids.has(edge.toId)) continue;
    const key = [edge.fromId, edge.toId].sort().join('|');
    const group = groups.get(key) ?? [];
    group.push(edge);
    groups.set(key, group);
  }
  const links: Link3D[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => (a.id < b.id ? -1 : 1));
    group.forEach((edge, i) => {
      let curvature: number;
      if (edge.fromId === edge.toId) {
        curvature = 0.5 + i * CURVE_STEP; // a loop needs a bend to be drawn at all
      } else {
        const centred = (i - (group.length - 1) / 2) * CURVE_STEP;
        // Curvature is relative to the link's own direction: flip reversed ones
        // so A→B and B→A bend apart instead of onto each other.
        curvature = edge.fromId < edge.toId ? centred : -centred;
      }
      links.push({
        id: edge.id,
        name: edge.name,
        source: edge.fromId,
        target: edge.toId,
        curvature,
      });
    });
  }
  return { nodes: out3d, links };
}

/** The id of a link end, whether the engine has resolved it to a node yet or not. */
export function endId(end: string | Node3D): string {
  return typeof end === 'string' ? end : end.id;
}

export type Graph3DFailure = 'webgl' | 'other';

/** three.js reports a missing GPU context as "Error creating WebGL context". */
export function graph3dFailure(error: unknown): Graph3DFailure {
  return error instanceof Error && /webgl/i.test(error.message) ? 'webgl' : 'other';
}
