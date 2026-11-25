import { z } from 'zod';
import { idSchema } from './schemas/common.js';

/**
 * Spaced repetition, built around how deeply a node has been dug into with
 * 5 Whys:
 *
 * - A **shallow** node (few answered whys, or not dug deep) gets a "dig
 *   deeper" card: run another 5 Whys round on it. Lowest-EXP nodes first.
 * - Two **well-dug** nodes that aren't linked yet make a "link" card: is
 *   there a relation between them?
 *
 * The user answers a card with Done or Again. Done moves it one step up the
 * fixed ladder (`REVIEW_STEPS_DAYS`), Again puts it back at the start. Review
 * progress is part of the graph's data, so it syncs through the hub.
 */

/** Days until a card comes back, by step: Done climbs one step, Again restarts. */
export const REVIEW_STEPS_DAYS: readonly number[] = [1, 3, 7, 14, 30, 60, 120];

/** Well-dug = at least this many answered whys... */
export const DEEP_MIN_WHYS = 3;
/** ...and at least one answered this deep (1 = a top-level why). */
export const DEEP_MIN_DEPTH = 3;

/** Answered whys of a node, from the depth of each (`answeredWhyDepths`). */
export function digStats(depths: readonly number[]): { answeredWhys: number; maxDepth: number } {
  return { answeredWhys: depths.length, maxDepth: depths.reduce((m, d) => Math.max(m, d), 0) };
}

export function isWellDug(stats: { answeredWhys: number; maxDepth: number }): boolean {
  return stats.answeredWhys >= DEEP_MIN_WHYS && stats.maxDepth >= DEEP_MIN_DEPTH;
}

export const REVIEW_KINDS = ['dig', 'link'] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];
export const REVIEW_RESULTS = ['done', 'again'] as const;
export type ReviewResult = (typeof REVIEW_RESULTS)[number];

/** Where a card goes after an answer: its next step and in how many days it's due. */
export function nextReview(step: number, result: ReviewResult): { step: number; days: number } {
  const last = REVIEW_STEPS_DAYS.length - 1;
  if (result === 'again') return { step: 0, days: REVIEW_STEPS_DAYS[0] ?? 1 };
  const at = Math.min(Math.max(0, step), last);
  return { step: Math.min(at + 1, last), days: REVIEW_STEPS_DAYS[at] ?? 1 };
}

export interface ReviewNode {
  id: string;
  title: string;
  exp: number;
  answeredWhys: number;
  maxDepth: number;
}

/** One card of today's review. */
export type ReviewCard =
  | { kind: 'dig'; node: ReviewNode; step: number }
  | { kind: 'link'; node: ReviewNode; other: ReviewNode; step: number };

/** GET /api/review */
export interface ReviewToday {
  cards: ReviewCard[];
  /** How many more are due beyond the ones shown. */
  more: { dig: number; link: number };
}

export const reviewQuerySchema = z.strictObject({
  dig: z.coerce.number().int().min(0).max(50).default(5),
  link: z.coerce.number().int().min(0).max(20).default(2),
});
export type ReviewQuery = z.output<typeof reviewQuerySchema>;

/** POST /api/review/answer */
export const reviewAnswerInputSchema = z
  .strictObject({
    kind: z.enum(REVIEW_KINDS),
    nodeId: idSchema,
    otherNodeId: idSchema.nullable().default(null),
    result: z.enum(REVIEW_RESULTS),
  })
  .refine((v) => (v.kind === 'link') === (v.otherNodeId !== null), {
    message: 'A link card names two nodes, a dig card one',
    path: ['otherNodeId'],
  })
  .refine((v) => v.otherNodeId !== v.nodeId, {
    message: 'A link card needs two different nodes',
    path: ['otherNodeId'],
  });
export type ReviewAnswerInput = z.input<typeof reviewAnswerInputSchema>;
