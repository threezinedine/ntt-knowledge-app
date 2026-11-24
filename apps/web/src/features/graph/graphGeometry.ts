/** Pure geometry/styling for the Obsidian-style graph: circles + center-to-center edges. */

export interface Circle {
  cx: number;
  cy: number;
  r: number;
}

export interface EdgeGeometry {
  path: string;
  labelX: number;
  labelY: number;
  /** Degrees to rotate the label so it runs along the edge, kept upright (−90, 90]. */
  labelAngle: number;
}

/** Direction of (dx, dy) in degrees, flipped if needed so text never reads upside down. */
export function uprightAngle(dx: number, dy: number): number {
  if (dx === 0 && dy === 0) return 0;
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (deg > 90) deg -= 180;
  else if (deg <= -90) deg += 180;
  return deg;
}

/** An unlinked node. */
export const MIN_RADIUS = 6;
/** The least-linked of the linked nodes... */
export const LINKED_MIN_RADIUS = 12;
/** ...and the best-linked one. */
export const MAX_RADIUS = 32;
/** When every linked node has the same number of links. */
export const EVEN_RADIUS = 18;

export interface DegreeRange {
  /** Fewest links of any linked node (0 when nothing is linked). */
  min: number;
  max: number;
}

/**
 * Size spread over the graph's own range of links (the user's choice, so
 * nodes never look alike): the least-linked node gets `LINKED_MIN_RADIUS`,
 * the best-linked `MAX_RADIUS`, the rest evenly in between. Even 2 vs 3
 * links shows. A link elsewhere can therefore resize the others.
 */
export function radiusForDegree(degree: number, range: DegreeRange): number {
  if (degree <= 0) return MIN_RADIUS;
  if (range.max <= range.min) return EVEN_RADIUS;
  const share = Math.min(1, Math.max(0, (degree - range.min) / (range.max - range.min)));
  return LINKED_MIN_RADIUS + (MAX_RADIUS - LINKED_MIN_RADIUS) * share;
}

/** Fewest and most links among the nodes that have any. */
export function degreeRange(degree: ReadonlyMap<string, number>): DegreeRange {
  let min = Infinity;
  let max = 0;
  for (const d of degree.values()) {
    if (d <= 0) continue;
    min = Math.min(min, d);
    max = Math.max(max, d);
  }
  return { min: Number.isFinite(min) ? min : 0, max };
}

/**
 * Plain notes stay neutral grey; other types get palette colours.
 * Trade-off (deliberate): colours are *distinct* for up to 8 types present,
 * not *stable*. Adding/removing a type can shift others. Hashing would be
 * stable but collides often; a persisted type→colour map is the real fix.
 */
export const DEFAULT_NODE_COLOR = '#a3a3a3';
const TYPE_PALETTE = [
  '#e0af68',
  '#9ece6a',
  '#7dcfff',
  '#f7768e',
  '#bb9af7',
  '#ff9e64',
  '#73daca',
  '#2ac3de',
] as const;

/** Distinct palette colours for the non-note types present, assigned in sorted order. */
export function typeColors(types: Iterable<string>): Map<string, string> {
  const distinct = [...new Set(types)].filter((t) => t !== 'note').sort();
  const colors = new Map<string, string>([['note', DEFAULT_NODE_COLOR]]);
  distinct.forEach((type, i) => {
    colors.set(type, TYPE_PALETTE[i % TYPE_PALETTE.length] ?? DEFAULT_NODE_COLOR);
  });
  return colors;
}

/** Gap between parallel edges of the same node pair, in flow units. */
export const PARALLEL_EDGE_SPACING = 28;

export interface EdgeLane {
  /** Perpendicular bend (signed, flow units) for parallel/reciprocal edges; 0 = straight. */
  offset: number;
  /** n-th self-loop on the same node (0-based); each one is drawn larger. */
  loopIndex: number;
}

/**
 * Edge from rim to rim (not centre to centre), so a directed edge's arrow head
 * lands on the target's border. Parallel edges between the same pair bend
 * apart by `lane.offset`; self-loops are teardrops above the node.
 */
export function edgeGeometry(
  source: Circle,
  target: Circle,
  isSelfLoop: boolean,
  lane: EdgeLane = { offset: 0, loopIndex: 0 },
): EdgeGeometry {
  if (isSelfLoop) return selfLoop(source, lane.loopIndex);

  const dx = target.cx - source.cx;
  const dy = target.cy - source.cy;
  const length = Math.hypot(dx, dy);
  if (length <= source.r + target.r) {
    // Overlapping circles: nothing sensible to draw between rims.
    return {
      path: `M ${source.cx},${source.cy} L ${target.cx},${target.cy}`,
      labelX: source.cx,
      labelY: source.cy,
      labelAngle: 0,
    };
  }

  if (lane.offset === 0) {
    const ux = dx / length;
    const uy = dy / length;
    const sx = source.cx + ux * source.r;
    const sy = source.cy + uy * source.r;
    const tx = target.cx - ux * target.r;
    const ty = target.cy - uy * target.r;
    return {
      path: `M ${sx},${sy} L ${tx},${ty}`,
      labelX: (sx + tx) / 2,
      labelY: (sy + ty) / 2,
      labelAngle: uprightAngle(dx, dy),
    };
  }

  // Quadratic curve whose apex sits `offset` away from the centre line
  // (control point at twice the offset, since a quadratic's apex is half-way).
  const nx = -dy / length;
  const ny = dx / length;
  const cx = (source.cx + target.cx) / 2 + nx * lane.offset * 2;
  const cy = (source.cy + target.cy) / 2 + ny * lane.offset * 2;
  const [sx, sy] = towards(source, cx, cy);
  const [tx, ty] = towards(target, cx, cy);
  return {
    path: `M ${sx},${sy} Q ${cx},${cy} ${tx},${ty}`,
    labelX: 0.25 * sx + 0.5 * cx + 0.25 * tx,
    labelY: 0.25 * sy + 0.5 * cy + 0.25 * ty,
    // A quadratic's tangent at its midpoint is parallel to its chord.
    labelAngle: uprightAngle(tx - sx, ty - sy),
  };
}

/** Point on the circle's rim in the direction of (x, y). */
function towards({ cx, cy, r }: Circle, x: number, y: number): [number, number] {
  const len = Math.hypot(x - cx, y - cy) || 1;
  return [cx + ((x - cx) / len) * r, cy + ((y - cy) / len) * r];
}

function selfLoop({ cx, cy, r }: Circle, loopIndex: number): EdgeGeometry {
  const angle = Math.PI / 5; // leave/enter 36° either side of the top
  const sx = cx - Math.sin(angle) * r;
  const ex = cx + Math.sin(angle) * r;
  const y = cy - Math.cos(angle) * r;
  const height = r * 2 + 28 + loopIndex * 22;
  const spread = r + 18 + loopIndex * 10;
  return {
    path: `M ${sx},${y} C ${cx - spread},${y - height} ${cx + spread},${y - height} ${ex},${y}`,
    labelX: cx,
    labelY: y - height * 0.75,
    labelAngle: 0,
  };
}
