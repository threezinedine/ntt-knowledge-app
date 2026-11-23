import { describe, expect, it } from 'vitest';
import { pushAway, type Circle, type PushOptions } from './collide';

const at = (x: number, y: number, r = 10): Circle => ({ x, y, r });
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);
const ORIGIN = { x: 0, y: 0 };
/** Collisions only, to check the geometry exactly. */
const HARD: PushOptions = { gap: 20, reach: 0, softness: 0 };
const SOFT: PushOptions = { gap: 20, reach: 100, softness: 0.5 };

describe('pushAway', () => {
  it('leaves dots alone when there is room', () => {
    const out = pushAway(new Map([['d', at(0, 0)]]), new Map([['a', at(200, 0)]]), SOFT);
    expect(out.size).toBe(0);
  });

  it('pushes an overlapping dot straight away, just far enough', () => {
    const out = pushAway(new Map([['d', at(0, 0)]]), new Map([['a', at(30, 0)]]), HARD);
    expect(out.get('a')).toEqual({ x: 40, y: 0 }); // 10 + 10 + 20
  });

  it('eases nearby dots aside, more the closer they are', () => {
    const near = pushAway(new Map([['d', at(0, 0)]]), new Map([['a', at(60, 0)]]), SOFT);
    const nearer = pushAway(new Map([['d', at(0, 0)]]), new Map([['a', at(45, 0)]]), SOFT);
    // Reach ends at 10 + 10 + 100 = 120: halfway out from 60 is 90.
    expect(near.get('a')).toEqual({ x: 90, y: 0 });
    expect((nearer.get('a')?.x ?? 0) - 45).toBeGreaterThan(90 - 60);
  });

  it('a pushed dot shoves the neighbour it now overlaps, not the whole cluster', () => {
    const origins = new Map([
      ['a', at(30, 0)],
      ['b', at(60, 0)],
      ['c', at(60, 200)], // far from everything
    ]);
    const out = pushAway(new Map([['d', at(0, 0)]]), origins, HARD);
    const a = out.get('a');
    const b = out.get('b');
    expect(a).toEqual({ x: 40, y: 0 });
    // b moves along, keeping the 30 it had from a before the drag.
    expect(b?.x).toBeCloseTo(70);
    expect(out.has('c')).toBe(false);
  });

  it('returns dots to their origin once the dragged one has moved on', () => {
    const origins = new Map([['a', at(30, 0)]]);
    expect(pushAway(new Map([['d', at(0, 0)]]), origins, SOFT).size).toBe(1);
    expect(pushAway(new Map([['d', at(-300, 0)]]), origins, SOFT).size).toBe(0);
  });

  it('never moves the dragged dots, and copes with dots exactly on top', () => {
    const dragged = new Map([['d', at(0, 0)]]);
    const out = pushAway(
      dragged,
      new Map([
        ['a', at(0, 0)],
        ['d', at(0, 0)],
      ]),
      HARD,
    );
    expect(out.has('d')).toBe(false);
    expect(dist(out.get('a') ?? ORIGIN, ORIGIN)).toBeCloseTo(40);
  });

  it('keeps every dot clear of several dragged dots', () => {
    const dragged = new Map([
      ['d1', at(0, 0)],
      ['d2', at(90, 0)],
    ]);
    const out = pushAway(dragged, new Map([['a', at(30, 5)]]), SOFT);
    const a = out.get('a');
    expect(a).toBeDefined();
    for (const d of dragged.values()) {
      expect(dist(a ?? ORIGIN, d)).toBeGreaterThanOrEqual(40 - 1e-9);
    }
  });

  it('leaves clusters the user built tight as tight as they were', () => {
    const origins = new Map([
      ['a', at(30, 0)],
      ['b', at(65, 0)], // 35 from a: already closer than 40
      ['c', at(85, 0)], // 20 from b
      ['e', at(400, 0)], // a crowded pair far away
      ['f', at(410, 0)],
    ]);
    const out = pushAway(new Map([['d', at(0, 0)]]), origins, HARD);
    const pos = (id: string) => out.get(id) ?? origins.get(id) ?? ORIGIN;
    expect(dist(pos('a'), pos('b'))).toBeCloseTo(35);
    expect(dist(pos('b'), pos('c'))).toBeCloseTo(20);
    expect(out.has('e') || out.has('f')).toBe(false);
  });
});
