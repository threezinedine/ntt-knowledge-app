import { describe, expect, it } from 'vitest';
import { localDistances, localGraphQuerySchema, splitLocalEdges } from './localGraph.js';

// a -> b -> c -> d, e -> a, x (alone), self-loop on b
const edges = [
  { fromId: 'a', toId: 'b' },
  { fromId: 'b', toId: 'c' },
  { fromId: 'c', toId: 'd' },
  { fromId: 'e', toId: 'a' },
  { fromId: 'b', toId: 'b' },
];

describe('localDistances', () => {
  it('follows links both ways, up to the depth', () => {
    expect([...localDistances('a', edges, 1)]).toEqual([
      ['a', 0],
      ['b', 1],
      ['e', 1],
    ]);
    expect(Object.fromEntries(localDistances('a', edges, 2))).toEqual({ a: 0, b: 1, e: 1, c: 2 });
    expect(Object.fromEntries(localDistances('d', edges, 3))).toEqual({ d: 0, c: 1, b: 2, a: 3 });
  });

  it('is just the root when nothing links to it', () => {
    expect([...localDistances('x', edges, 3)]).toEqual([['x', 0]]);
  });
});

describe('splitLocalEdges', () => {
  it('keeps links with both ends inside to check, and one-end links as boundary', () => {
    const inside = localDistances('a', edges, 1); // a, b, e
    const { inner, boundary } = splitLocalEdges(inside, edges);
    expect(inner).toEqual([edges[0], edges[3], edges[4]]);
    expect(boundary).toEqual([edges[1]]); // b -> c; c -> d touches nothing inside
  });
});

describe('localGraphQuerySchema', () => {
  it('takes depth 1–3 from the query string, default 1', () => {
    expect(localGraphQuerySchema.parse({})).toEqual({ depth: 1 });
    expect(localGraphQuerySchema.parse({ depth: '3' })).toEqual({ depth: 3 });
    expect(localGraphQuerySchema.safeParse({ depth: '4' }).success).toBe(false);
    expect(localGraphQuerySchema.safeParse({ depth: '0' }).success).toBe(false);
    expect(localGraphQuerySchema.safeParse({ depth: '1', x: '1' }).success).toBe(false);
  });
});
