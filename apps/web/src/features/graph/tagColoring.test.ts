import type { Edge } from '@km/core';
import { describe, expect, it } from 'vitest';
import { hexToRgb, mixColors, vivid } from '../tags/colors';
import { pickHubs, tagColoring, type TagColoringInput } from './tagColoring';

const edge = (fromId: string, toId: string): Edge => ({
  id: `${fromId}-${toId}`,
  fromId,
  toId,
  name: 'rel',
  props: {},
  createdAt: 0,
  updatedAt: 0,
});

const GREY = '#808080';
const base = (over: Partial<TagColoringInput>): TagColoringInput => ({
  nodeIds: [],
  edges: [],
  tagColors: new Map(),
  score: new Map(),
  hubs: 1,
  fade: 0.5,
  reach: 3,
  ...over,
});

describe('pickHubs', () => {
  it('takes the n biggest dots that have a coloured tag, ties by id', () => {
    const hubs = pickHubs({
      nodeIds: ['a', 'b', 'c', 'd'],
      tagColors: new Map([
        ['a', ['#ff0000']],
        ['b', ['#ff0000']],
        ['c', []],
        ['d', ['#ff0000']],
      ]),
      score: new Map([
        ['a', 1],
        ['b', 5],
        ['c', 9], // biggest, but nothing to colour it with
        ['d', 5],
      ]),
      hubs: 2,
    });
    expect(hubs).toEqual(['b', 'd']);
  });
});

describe('tagColoring', () => {
  it('a hub is the mix of its tags; the colour fades along links, both directions', () => {
    // a → hub ← (nothing) and hub → b → c → d → e (reach 3 stops before e)
    const { colors, hubs } = tagColoring(
      base({
        nodeIds: ['hub', 'a', 'b', 'c', 'd', 'e', 'alone'],
        edges: [edge('a', 'hub'), edge('hub', 'b'), edge('b', 'c'), edge('c', 'd'), edge('d', 'e')],
        tagColors: new Map([['hub', ['#ff0000', '#0000ff']]]),
        score: new Map([['hub', 2]]),
      }),
    );
    const purple = mixColors([
      { color: '#ff0000', weight: 1 },
      { color: '#0000ff', weight: 1 },
    ]);
    expect(colors.get('hub')).toBe(vivid(purple ?? '')); // at full strength, so it stands out
    expect([...hubs]).toEqual(['hub']);
    // Further out = paler: less colourful (max − min channel) and lighter.
    const chroma = (id: string) => {
      const rgb = hexToRgb(colors.get(id) ?? GREY);
      return Math.max(...rgb) - Math.min(...rgb);
    };
    expect(chroma('hub')).toBeGreaterThan(chroma('b'));
    expect(chroma('b')).toBeGreaterThan(chroma('c'));
    expect(colors.get('a')).toBe(colors.get('b')); // one step either way
    expect(chroma('c')).toBeGreaterThan(chroma('d'));
    expect(colors.has('e')).toBe(false);
    expect(colors.has('alone')).toBe(false);
  });

  it('where two hubs meet the colours blend, the nearer counting more', () => {
    // red — x — y — blue: x is nearer red, y nearer blue.
    const { colors } = tagColoring(
      base({
        nodeIds: ['red', 'x', 'y', 'blue'],
        edges: [edge('red', 'x'), edge('x', 'y'), edge('y', 'blue')],
        tagColors: new Map([
          ['red', ['#ff0000']],
          ['blue', ['#0000ff']],
        ]),
        score: new Map([
          ['red', 1],
          ['blue', 1],
        ]),
        hubs: 2,
        fade: 0.8,
      }),
    );
    expect(colors.get('red')).toBe('#ff0000'); // hubs aren't tinted by each other
    expect(colors.get('blue')).toBe('#0000ff');
    const [xr, , xb] = hexToRgb(colors.get('x') ?? GREY);
    const [yr, , yb] = hexToRgb(colors.get('y') ?? GREY);
    expect(xr).toBeGreaterThan(xb);
    expect(yb).toBeGreaterThan(yr);
  });
});
