import type { Edge } from '@km/core';
import { mixColors, tint, vivid } from '../tags/colors';

/**
 * Experimental: colour the graph by tags. The n biggest dots (most links, or
 * most EXP) take the mix of their tags' colours, and that colour spreads to
 * every linked dot, ring by ring, as a paler tint each step. The big dots
 * show it at full strength (and stand out), so it's clear whose colour a pale
 * dot carries. Where colours from two big dots meet they blend, the nearer one
 * counting more. Dots no colour reaches keep their usual one.
 */
export interface TagColoringInput {
  nodeIds: readonly string[];
  edges: readonly Edge[];
  /** Node id → its tags' colours (already resolved, uncoloured tags left out). */
  tagColors: ReadonlyMap<string, readonly string[]>;
  /** Node id → how big it is (links or EXP); bigger first. */
  score: ReadonlyMap<string, number>;
  /** How many big dots get a colour. */
  hubs: number;
  /** Strength left after each step away (0–1). */
  fade: number;
  /** How many steps away the colour still reaches. */
  reach: number;
}

/** The big dots that get a colour: only ones with a coloured tag, biggest first (ties by id). */
export function pickHubs(
  input: Pick<TagColoringInput, 'nodeIds' | 'tagColors' | 'score' | 'hubs'>,
) {
  return input.nodeIds
    .filter((id) => (input.tagColors.get(id)?.length ?? 0) > 0)
    .sort((a, b) => (input.score.get(b) ?? 0) - (input.score.get(a) ?? 0) || (a < b ? -1 : 1))
    .slice(0, Math.max(0, input.hubs));
}

export interface TagColoringResult {
  /** Node id → colour, for every dot a hub's colour reaches (the rest are left out). */
  colors: Map<string, string>;
  /** The big dots themselves (drawn so they stand out). */
  hubs: Set<string>;
}

export function tagColoring(input: TagColoringInput): TagColoringResult {
  const neighbours = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const list = neighbours.get(a) ?? [];
    list.push(b);
    neighbours.set(a, list);
  };
  for (const { fromId, toId } of input.edges) {
    if (fromId === toId) continue;
    link(fromId, toId);
    link(toId, fromId);
  }

  const hubs = pickHubs(input);
  const hubColor = new Map<string, string>();
  for (const id of hubs) {
    const color = mixColors((input.tagColors.get(id) ?? []).map((c) => ({ color: c, weight: 1 })));
    if (color !== null) hubColor.set(id, vivid(color));
  }

  // Per dot: every hub colour that reaches it, with its strength there.
  const reached = new Map<string, { color: string; weight: number }[]>();
  for (const [hub, color] of hubColor) {
    let ring = [hub];
    const seen = new Set(ring);
    for (let step = 1; step <= input.reach && ring.length > 0; step++) {
      const weight = input.fade ** step;
      const next: string[] = [];
      for (const id of ring) {
        for (const n of neighbours.get(id) ?? []) {
          if (seen.has(n)) continue;
          seen.add(n);
          next.push(n);
          const list = reached.get(n) ?? [];
          list.push({ color, weight });
          reached.set(n, list);
        }
      }
      ring = next;
    }
  }

  const out = new Map(hubColor); // a hub keeps its own colour, nearby hubs don't tint it
  for (const [id, parts] of reached) {
    if (out.has(id)) continue;
    const blended = mixColors(parts);
    if (blended === null) continue;
    // As strong as the nearest hub's colour is here: paler further out.
    const strength = Math.max(...parts.map((p) => p.weight));
    out.set(id, tint(blended, strength));
  }
  return { colors: out, hubs: new Set(hubColor.keys()) };
}
