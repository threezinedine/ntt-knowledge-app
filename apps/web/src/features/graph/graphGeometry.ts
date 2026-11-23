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
}

const MIN_RADIUS = 7;
const MAX_RADIUS = 26;

/** Like Obsidian: well-connected nodes grow, sub-linearly so hubs don't explode. */
export function radiusForDegree(degree: number): number {
  return Math.min(MAX_RADIUS, MIN_RADIUS + Math.sqrt(Math.max(0, degree)) * 3);
}

/** Plain notes stay neutral grey; other types get a stable colour (Obsidian "groups"). */
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

/**
 * Assigns palette colours to the distinct non-note types present, in sorted
 * order, so up to eight types never collide (hashing would).
 */
export function typeColors(types: Iterable<string>): Map<string, string> {
  const distinct = [...new Set(types)].filter((t) => t !== 'note').sort();
  const colors = new Map<string, string>([['note', DEFAULT_NODE_COLOR]]);
  distinct.forEach((type, i) => {
    colors.set(type, TYPE_PALETTE[i % TYPE_PALETTE.length] ?? DEFAULT_NODE_COLOR);
  });
  return colors;
}

/**
 * Straight line between the two circle borders (not centers), so the arrow
 * head of a directed edge lands on the target's rim. A self-loop is drawn as
 * a teardrop above the node.
 */
export function edgeGeometry(source: Circle, target: Circle, isSelfLoop: boolean): EdgeGeometry {
  if (isSelfLoop) return selfLoop(source);

  const dx = target.cx - source.cx;
  const dy = target.cy - source.cy;
  const length = Math.hypot(dx, dy);
  if (length <= source.r + target.r) {
    // Overlapping circles: nothing sensible to draw between rims.
    return {
      path: `M ${source.cx},${source.cy} L ${target.cx},${target.cy}`,
      labelX: source.cx,
      labelY: source.cy,
    };
  }
  const ux = dx / length;
  const uy = dy / length;
  const sx = source.cx + ux * source.r;
  const sy = source.cy + uy * source.r;
  const tx = target.cx - ux * target.r;
  const ty = target.cy - uy * target.r;
  return { path: `M ${sx},${sy} L ${tx},${ty}`, labelX: (sx + tx) / 2, labelY: (sy + ty) / 2 };
}

function selfLoop({ cx, cy, r }: Circle): EdgeGeometry {
  const angle = Math.PI / 5; // leave/enter 36° either side of the top
  const sx = cx - Math.sin(angle) * r;
  const ex = cx + Math.sin(angle) * r;
  const y = cy - Math.cos(angle) * r;
  const height = r * 2 + 28;
  const spread = r + 18;
  return {
    path: `M ${sx},${y} C ${cx - spread},${y - height} ${cx + spread},${y - height} ${ex},${y}`,
    labelX: cx,
    labelY: y - height * 0.75,
  };
}
