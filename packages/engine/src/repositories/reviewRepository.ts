import {
  digStats,
  isWellDug,
  nextReview,
  nodeTotalExp,
  type LevelConfig,
  type ReviewAnswerInput,
  type ReviewCard,
  type ReviewKind,
  type ReviewNode,
  type ReviewQuery,
  type ReviewToday,
} from '@km/core';
import { transaction } from '../database.js';
import { nextTimestamp, type RepoContext } from './context.js';
import type { ExpRepository } from './expRepository.js';
import type { NodeRepository } from './nodeRepository.js';

export type ReviewRepository = ReturnType<typeof createReviewRepository>;

/** Midnight (this device's time zone) of the day `ms` falls in, plus `days` days. */
export function dayStart(ms: number, days = 0): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** Same seed, same numbers: today's link suggestions don't change on every refetch. */
function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A link card's two nodes, in the order they're stored (smaller id first). */
const pairOf = (a: string, b: string): [string, string] => (a < b ? [a, b] : [b, a]);
const pairKey = (a: string, b: string) => pairOf(a, b).join('|');

interface CardRow {
  id: string;
  kind: ReviewKind;
  node_id: string;
  other_node_id: string | null;
  step: number;
  due_at: number;
  updated_at: number;
}

/**
 * Spaced repetition (see @km/core review.ts): which cards are due today, and
 * answering one. Cards are only stored once answered; until then every
 * shallow node, and every unlinked pair of well-dug nodes, is a new card.
 */
export function createReviewRepository(
  { db, now, newId }: RepoContext,
  deps: { exp: ExpRepository; nodes: NodeRepository },
) {
  const selectTitles = db.prepare('SELECT id, title FROM nodes WHERE deleted_at IS NULL');
  const selectEdges = db.prepare('SELECT from_id, to_id FROM edges WHERE deleted_at IS NULL');
  const selectCards = db.prepare(
    `SELECT id, kind, node_id, other_node_id, step, due_at, updated_at
       FROM review_cards WHERE deleted_at IS NULL`,
  );
  const selectCard = db.prepare(
    `SELECT id, kind, node_id, other_node_id, step, due_at, updated_at
       FROM review_cards
      WHERE deleted_at IS NULL AND kind = ? AND node_id = ? AND IFNULL(other_node_id, '') = ?`,
  );
  const insertCard = db.prepare(
    `INSERT INTO review_cards (id, kind, node_id, other_node_id, step, due_at, created_at, updated_at)
     VALUES (:id, :kind, :node_id, :other_node_id, :step, :due_at, :ts, :ts)`,
  );
  const updateCard = db.prepare(
    'UPDATE review_cards SET step = :step, due_at = :due_at, updated_at = :ts WHERE id = :id',
  );

  /** Every live node with what review needs to know about it. */
  function reviewNodes(config: LevelConfig): Map<string, ReviewNode> {
    const titles = new Map(
      (selectTitles.all() as { id: string; title: string }[]).map((r) => [r.id, r.title]),
    );
    const out = new Map<string, ReviewNode>();
    for (const node of deps.exp.nodes()) {
      const title = titles.get(node.id);
      if (title === undefined) continue;
      out.set(node.id, {
        id: node.id,
        title,
        exp: nodeTotalExp(node, config),
        ...digStats(node.whyDepths),
      });
    }
    return out;
  }

  return {
    today(query: ReviewQuery, config: LevelConfig): ReviewToday {
      const ts = now();
      const nodes = reviewNodes(config);
      const cards = selectCards.all() as unknown as CardRow[];
      const digCard = new Map<string, CardRow>();
      const linkCard = new Map<string, CardRow>();
      for (const card of cards) {
        if (card.kind === 'dig') digCard.set(card.node_id, card);
        else if (card.other_node_id !== null) {
          linkCard.set(pairKey(card.node_id, card.other_node_id), card);
        }
      }
      const isDue = (card: CardRow | undefined) => card === undefined || card.due_at <= ts;

      // Dig deeper: shallow nodes that are due (or never reviewed), lowest EXP first.
      const shallow = [...nodes.values()]
        .filter((n) => !isWellDug(n) && isDue(digCard.get(n.id)))
        .sort((a, b) => a.exp - b.exp || a.title.localeCompare(b.title) || (a.id < b.id ? -1 : 1));
      const dig: ReviewCard[] = shallow
        .slice(0, query.dig)
        .map((node) => ({ kind: 'dig', node, step: digCard.get(node.id)?.step ?? 0 }));

      // Link: pairs of well-dug nodes that aren't linked yet. Ones asked
      // before and due again come first, then today's random new pairs.
      const linked = new Set(
        (selectEdges.all() as { from_id: string; to_id: string }[]).map((e) =>
          pairKey(e.from_id, e.to_id),
        ),
      );
      const deep = [...nodes.values()].filter(isWellDug);
      const deepIds = new Set(deep.map((n) => n.id));
      const candidate = (a: string, b: string) =>
        a !== b && deepIds.has(a) && deepIds.has(b) && !linked.has(pairKey(a, b));
      const pairs: [ReviewNode, ReviewNode, CardRow | undefined][] = [];
      const seen = new Set<string>();
      const dueAgain = [...linkCard.values()]
        .filter((c) => c.due_at <= ts && c.other_node_id !== null)
        .sort((a, b) => a.due_at - b.due_at || (a.id < b.id ? -1 : 1));
      for (const card of dueAgain) {
        const other = card.other_node_id ?? '';
        if (!candidate(card.node_id, other)) continue;
        const a = nodes.get(card.node_id);
        const b = nodes.get(other);
        if (!a || !b) continue;
        seen.add(pairKey(a.id, b.id));
        pairs.push([a, b, card]);
      }
      const dueAgainCount = pairs.length;
      // New pairs: drawn at random (seeded by the day, so stable on refetch),
      // each pair from nodes not used yet today when there are enough.
      const random = seededRandom(String(dayStart(ts)));
      const pool = [...deep].sort((a, b) => (a.id < b.id ? -1 : 1));
      // Nodes already in a card today, so new pairs bring in other ones.
      const used = new Set(pairs.flatMap(([a, b]) => [a.id, b.id]));
      const maxAttempts = 50 * Math.max(1, query.link);
      for (let attempt = 0; attempt < maxAttempts && pairs.length < query.link; attempt++) {
        if (pool.length < 2) break;
        const a = pool[Math.floor(random() * pool.length)] as ReviewNode;
        const b = pool[Math.floor(random() * pool.length)] as ReviewNode;
        const key = pairKey(a.id, b.id);
        if (seen.has(key) || !candidate(a.id, b.id) || linkCard.has(key)) continue;
        // First half of the attempts: only nodes not in a card yet (varied cards).
        if (attempt < maxAttempts / 2 && (used.has(a.id) || used.has(b.id))) continue;
        seen.add(key);
        used.add(a.id).add(b.id);
        pairs.push([a, b, undefined]);
      }
      // Random draws can miss the last few unlinked pairs of a dense graph: scan for them.
      for (let i = 0; i < pool.length && pairs.length < query.link; i++) {
        for (let j = i + 1; j < pool.length && pairs.length < query.link; j++) {
          const a = pool[i] as ReviewNode;
          const b = pool[j] as ReviewNode;
          const key = pairKey(a.id, b.id);
          if (seen.has(key) || !candidate(a.id, b.id) || linkCard.has(key)) continue;
          seen.add(key);
          pairs.push([a, b, undefined]);
        }
      }
      const link: ReviewCard[] = pairs.slice(0, query.link).map(([a, b, card]) => {
        const [first] = pairOf(a.id, b.id);
        const [node, other] = first === a.id ? [a, b] : [b, a];
        return { kind: 'link', node, other, step: card?.step ?? 0 };
      });

      return {
        cards: [...dig, ...link],
        more: {
          dig: Math.max(0, shallow.length - dig.length),
          // Links are suggestions, not a backlog: only ones asked before and due again count.
          link: Math.max(0, dueAgainCount - Math.min(dueAgainCount, link.length)),
        },
      };
    },

    /** Done: one step up the ladder. Again: back to the start. Due at the start of that day. */
    answer(input: ReviewAnswerInput & { otherNodeId: string | null }): void {
      deps.nodes.getOrThrow(input.nodeId);
      if (input.otherNodeId !== null) deps.nodes.getOrThrow(input.otherNodeId);
      const [nodeId, otherId] =
        input.otherNodeId === null ? [input.nodeId, null] : pairOf(input.nodeId, input.otherNodeId);
      transaction(db, () => {
        const card = selectCard.get(input.kind, nodeId, otherId ?? '') as CardRow | undefined;
        const next = nextReview(card?.step ?? 0, input.result);
        const dueAt = dayStart(now(), next.days);
        if (card) {
          updateCard.run({
            id: card.id,
            step: next.step,
            due_at: dueAt,
            ts: nextTimestamp(now, card.updated_at),
          });
        } else {
          insertCard.run({
            id: newId(),
            kind: input.kind,
            node_id: nodeId,
            other_node_id: otherId,
            step: next.step,
            due_at: dueAt,
            ts: now(),
          });
        }
      });
    },
  };
}
