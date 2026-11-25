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
import type { SettingsRepository } from './settingsRepository.js';

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
 * Each day has a quota (6 dig, 2 link by default): answers given today use
 * it up, and cards picked earlier but not answered yet are kept first.
 */
export function createReviewRepository(
  { db, now, newId }: RepoContext,
  deps: { exp: ExpRepository; nodes: NodeRepository; settings: SettingsRepository },
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

  /**
   * The day's picked cards, on this device only (device_settings, never
   * synced: a pick isn't data, and syncing it would show as a change every
   * day). Just ids: whether each is still due is checked on every read.
   */
  interface Deck {
    day: number;
    dig: string[];
    link: string[];
  }
  const DECK_KEY = 'reviewDeck';
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  function readDeck(): Deck {
    try {
      const raw = JSON.parse(deps.settings.get(DECK_KEY) ?? 'null') as Partial<Deck> | null;
      return {
        day: typeof raw?.day === 'number' ? raw.day : 0,
        dig: strings(raw?.dig),
        link: strings(raw?.link),
      };
    } catch {
      return { day: 0, dig: [], link: [] };
    }
  }
  function writeDeck(next: Deck, previous: Deck): void {
    if (JSON.stringify(next) !== JSON.stringify(previous)) {
      deps.settings.set(DECK_KEY, JSON.stringify(next));
    }
  }

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
      const day = dayStart(ts);
      const nodes = reviewNodes(config);
      const cards = selectCards.all() as unknown as CardRow[];
      const digCard = new Map<string, CardRow>();
      const linkCard = new Map<string, CardRow>();
      // Answered today (Done or Again): these use up the day's quota.
      const answeredToday = { dig: 0, link: 0 };
      for (const card of cards) {
        if (card.updated_at >= day) answeredToday[card.kind]++;
        if (card.kind === 'dig') digCard.set(card.node_id, card);
        else if (card.other_node_id !== null) {
          linkCard.set(pairKey(card.node_id, card.other_node_id), card);
        }
      }
      const isDue = (card: CardRow | undefined) => card === undefined || card.due_at <= ts;
      // Cards picked earlier (the day before, or earlier today) and not
      // answered since stay first; new ones only fill what's left of the quota.
      const deck = readDeck();

      // Dig deeper: shallow nodes that are due (or never reviewed), lowest EXP first.
      const digEligible = (id: string) => {
        const n = nodes.get(id);
        return n !== undefined && !isWellDug(n) && isDue(digCard.get(id));
      };
      const digQuota = Math.max(0, query.dig - answeredToday.dig);
      const digIds = deck.dig.filter(digEligible).slice(0, digQuota);
      const ranked = [...nodes.values()]
        .filter((n) => digEligible(n.id))
        .sort((a, b) => a.exp - b.exp || a.title.localeCompare(b.title) || (a.id < b.id ? -1 : 1));
      for (const n of ranked) {
        if (digIds.length >= digQuota) break;
        if (!digIds.includes(n.id)) digIds.push(n.id);
      }
      const dig: ReviewCard[] = digIds.map((id) => ({
        kind: 'dig',
        node: nodes.get(id) as ReviewNode,
        step: digCard.get(id)?.step ?? 0,
      }));

      // Link: pairs of well-dug nodes that aren't linked yet. Kept ones first,
      // then ones asked before and due again, then random new pairs.
      const linked = new Set(
        (selectEdges.all() as { from_id: string; to_id: string }[]).map((e) =>
          pairKey(e.from_id, e.to_id),
        ),
      );
      const deep = [...nodes.values()].filter(isWellDug);
      const deepIds = new Set(deep.map((n) => n.id));
      const candidate = (a: string, b: string) =>
        a !== b && deepIds.has(a) && deepIds.has(b) && !linked.has(pairKey(a, b));
      const linkEligible = (key: string) => {
        const [a = '', b = ''] = key.split('|');
        return candidate(a, b) && isDue(linkCard.get(key));
      };
      const linkQuota = Math.max(0, query.link - answeredToday.link);
      const linkKeys = deck.link.filter(linkEligible).slice(0, linkQuota);
      const seen = new Set(linkKeys);
      const dueAgain = [...linkCard.entries()]
        .filter(([key, c]) => c.due_at <= ts && linkEligible(key) && !seen.has(key))
        .sort(([, a], [, b]) => a.due_at - b.due_at || (a.id < b.id ? -1 : 1))
        .map(([key]) => key);
      for (const key of dueAgain) {
        if (linkKeys.length >= linkQuota) break;
        seen.add(key);
        linkKeys.push(key);
      }
      // New pairs: drawn at random (seeded by the day, so stable on refetch),
      // each pair from nodes not used yet today when there are enough.
      const random = seededRandom(String(day));
      const pool = [...deep].sort((a, b) => (a.id < b.id ? -1 : 1));
      const used = new Set(linkKeys.flatMap((key) => key.split('|')));
      const isNew = (key: string, a: string, b: string) =>
        !seen.has(key) && candidate(a, b) && !linkCard.has(key);
      const maxAttempts = 50 * Math.max(1, linkQuota);
      for (let attempt = 0; attempt < maxAttempts && linkKeys.length < linkQuota; attempt++) {
        if (pool.length < 2) break;
        const a = pool[Math.floor(random() * pool.length)] as ReviewNode;
        const b = pool[Math.floor(random() * pool.length)] as ReviewNode;
        const key = pairKey(a.id, b.id);
        if (!isNew(key, a.id, b.id)) continue;
        // First half of the attempts: only nodes not in a card yet (varied cards).
        if (attempt < maxAttempts / 2 && (used.has(a.id) || used.has(b.id))) continue;
        seen.add(key);
        used.add(a.id).add(b.id);
        linkKeys.push(key);
      }
      // Random draws can miss the last few unlinked pairs of a dense graph: scan for them.
      for (let i = 0; i < pool.length && linkKeys.length < linkQuota; i++) {
        for (let j = i + 1; j < pool.length && linkKeys.length < linkQuota; j++) {
          const a = pool[i] as ReviewNode;
          const b = pool[j] as ReviewNode;
          const key = pairKey(a.id, b.id);
          if (!isNew(key, a.id, b.id)) continue;
          seen.add(key);
          linkKeys.push(key);
        }
      }
      const link: ReviewCard[] = linkKeys.map((key) => {
        const [a = '', b = ''] = key.split('|'); // smaller id first, as stored
        return {
          kind: 'link',
          node: nodes.get(a) as ReviewNode,
          other: nodes.get(b) as ReviewNode,
          step: linkCard.get(key)?.step ?? 0,
        };
      });

      writeDeck({ day, dig: digIds, link: linkKeys }, deck);
      return {
        cards: [...dig, ...link],
        answeredToday,
        more: {
          dig: Math.max(0, ranked.length - dig.length),
          // Links are suggestions, not a backlog: only ones asked before and due again count.
          link: dueAgain.filter((key) => !linkKeys.includes(key)).length,
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
