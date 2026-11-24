import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NODE_COLOR,
  edgeGeometry,
  degreeRange,
  EVEN_RADIUS,
  LINKED_MIN_RADIUS,
  MAX_RADIUS,
  MIN_RADIUS,
  radiusForDegree,
  typeColors,
  uprightAngle,
} from './graphGeometry';

describe('radiusForDegree', () => {
  it('spreads linked nodes from the fewest links to the most, so 2 vs 3 shows', () => {
    const range = { min: 2, max: 3 };
    expect(radiusForDegree(0, range)).toBe(MIN_RADIUS);
    expect(radiusForDegree(2, range)).toBe(LINKED_MIN_RADIUS);
    expect(radiusForDegree(3, range)).toBe(MAX_RADIUS);
    expect(radiusForDegree(26, { min: 2, max: 50 })).toBe((LINKED_MIN_RADIUS + MAX_RADIUS) / 2);
  });

  it('gives one size when all linked nodes are even, and stays in bounds', () => {
    expect(radiusForDegree(4, { min: 4, max: 4 })).toBe(EVEN_RADIUS);
    expect(radiusForDegree(0, { min: 0, max: 0 })).toBe(MIN_RADIUS);
    expect(radiusForDegree(9, { min: 2, max: 3 })).toBe(MAX_RADIUS);
  });
});

describe('degreeRange', () => {
  it('ignores unlinked nodes', () => {
    expect(degreeRange(new Map())).toEqual({ min: 0, max: 0 });
    expect(
      degreeRange(
        new Map([
          ['a', 0],
          ['b', 2],
          ['c', 7],
        ]),
      ),
    ).toEqual({ min: 2, max: 7 });
  });
});

describe('typeColors', () => {
  it('keeps notes neutral and gives each other type a distinct colour', () => {
    const colors = typeColors(['note', 'topic', 'project', 'topic', 'person']);
    expect(colors.get('note')).toBe(DEFAULT_NODE_COLOR);
    const assigned = ['person', 'project', 'topic'].map((t) => colors.get(t));
    expect(new Set(assigned).size).toBe(3);
    expect(assigned).not.toContain(DEFAULT_NODE_COLOR);
  });
});

describe('edgeGeometry', () => {
  it('runs from rim to rim along the center line', () => {
    const g = edgeGeometry({ cx: 0, cy: 0, r: 10 }, { cx: 100, cy: 0, r: 5 }, false);
    expect(g.path).toBe('M 10,0 L 95,0');
    expect([g.labelX, g.labelY]).toEqual([52.5, 0]);
  });

  it('draws self-loops above the node', () => {
    const g = edgeGeometry({ cx: 0, cy: 0, r: 10 }, { cx: 0, cy: 0, r: 10 }, true);
    expect(g.path.startsWith('M ')).toBe(true);
    expect(g.path).toContain(' C ');
    expect(g.labelY).toBeLessThan(-10);
  });

  it('does not produce NaN for overlapping nodes', () => {
    const g = edgeGeometry({ cx: 0, cy: 0, r: 10 }, { cx: 1, cy: 0, r: 10 }, false);
    expect(g.path).not.toContain('NaN');
  });
});

describe('edgeGeometry lanes', () => {
  const a = { cx: 0, cy: 0, r: 10 };
  const b = { cx: 100, cy: 0, r: 10 };

  it('bends offset edges to opposite sides with labels apart', () => {
    const up = edgeGeometry(a, b, false, { offset: 20, loopIndex: 0 });
    const down = edgeGeometry(a, b, false, { offset: -20, loopIndex: 0 });
    expect(up.path).toContain(' Q ');
    // Apex is roughly `offset` from the centre line (endpoints shift slightly toward it).
    expect(up.labelY).toBeGreaterThan(15);
    expect(down.labelY).toBeCloseTo(-up.labelY, 6);
  });

  it('starts and ends curved edges on the rims', () => {
    const g = edgeGeometry(a, b, false, { offset: 20, loopIndex: 0 });
    const match = /^M ([-\d.e]+),([-\d.e]+)/.exec(g.path);
    const [sx, sy] = [Number(match?.[1]), Number(match?.[2])];
    expect(Math.hypot(sx - a.cx, sy - a.cy)).toBeCloseTo(a.r, 5);
  });

  it('nests repeated self-loops', () => {
    const first = edgeGeometry(a, a, true, { offset: 0, loopIndex: 0 });
    const second = edgeGeometry(a, a, true, { offset: 0, loopIndex: 1 });
    expect(second.labelY).toBeLessThan(first.labelY);
  });
});

describe('label angle', () => {
  it('follows the edge and never turns the text upside down', () => {
    expect(uprightAngle(1, 0)).toBe(0);
    expect(uprightAngle(-1, 0)).toBe(0); // right-to-left still reads left-to-right
    expect(uprightAngle(1, 1)).toBeCloseTo(45);
    expect(uprightAngle(-1, -1)).toBeCloseTo(45);
    expect(uprightAngle(1, -1)).toBeCloseTo(-45);
    expect(uprightAngle(0, 1)).toBeCloseTo(90);
    expect(uprightAngle(0, -1)).toBeCloseTo(90);
  });

  it('is set for straight and bent edges, flat for self-loops', () => {
    const a = { cx: 0, cy: 0, r: 5 };
    const b = { cx: 100, cy: 100, r: 5 };
    expect(edgeGeometry(a, b, false).labelAngle).toBeCloseTo(45);
    expect(edgeGeometry(b, a, false).labelAngle).toBeCloseTo(45);
    expect(edgeGeometry(a, b, false, { offset: 20, loopIndex: 0 }).labelAngle).toBeCloseTo(45);
    expect(edgeGeometry(a, a, true).labelAngle).toBe(0);
  });
});
