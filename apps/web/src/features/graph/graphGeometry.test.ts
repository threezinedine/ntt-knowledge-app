import { describe, expect, it } from 'vitest';
import { DEFAULT_NODE_COLOR, edgeGeometry, radiusForDegree, typeColors } from './graphGeometry';

describe('radiusForDegree', () => {
  it('grows with links but is bounded', () => {
    expect(radiusForDegree(0)).toBe(7);
    expect(radiusForDegree(4)).toBeGreaterThan(radiusForDegree(1));
    expect(radiusForDegree(10_000)).toBe(26);
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
