import { z } from 'zod';
import { idSchema } from './schemas/common.js';

/**
 * EXP and levels per field of knowledge. A field is a tag; its EXP comes
 * from the nodes tagged with it or with any tag below it (each node counted
 * once per field). A node is worth a base amount plus a capped bonus for how
 * much it says, so writing more pays, but padding a note doesn't run away,
 * plus a capped bonus for its answered 5 Whys, more the deeper they dig.
 *
 * The numbers live in a server-side config file (see `levelConfigSchema`):
 * whoever runs the server tunes them; the app has no API to change them.
 */

/** Level 1 starts at 0 EXP; level n+1 needs 25·n·(n+1) in total (50, 150, 300, …). */
export const DEFAULT_LEVEL_THRESHOLDS: readonly number[] = Array.from(
  { length: 29 },
  (_, i) => 25 * (i + 1) * (i + 2),
);

export const levelConfigSchema = z.strictObject({
  /** EXP every node tagged with the field earns. */
  expPerNode: z.number().int().nonnegative().default(10),
  /** One bonus EXP per this many words of content... */
  wordsPerExp: z.number().int().positive().default(20),
  /** ...up to this much bonus per node. */
  maxContentExpPerNode: z.number().int().nonnegative().default(50),
  /**
   * EXP for an answered top-level 5 Whys question; each level deeper earns
   * twice its parent's (depth d: expPerWhy · 2^(d-1)). Unanswered whys earn 0.
   */
  expPerWhy: z.number().int().nonnegative().default(5),
  /** ...up to this much per node, all its sessions together. */
  maxWhysExpPerNode: z.number().int().nonnegative().default(200),
  /**
   * Total EXP needed to reach level 2, 3, ... (strictly increasing). Level 1
   * starts at 0; the last entry reaches the top level.
   */
  levelThresholds: z
    .array(z.number().int().positive())
    .min(1)
    .refine((t) => t.every((v, i) => i === 0 || v > (t[i - 1] ?? 0)), {
      message: 'levelThresholds must be strictly increasing',
    })
    .default([...DEFAULT_LEVEL_THRESHOLDS]),
});
export type LevelConfigInput = z.input<typeof levelConfigSchema>;
export type LevelConfig = z.output<typeof levelConfigSchema>;

export const DEFAULT_LEVEL_CONFIG: LevelConfig = levelConfigSchema.parse({});

/** Words in markdown content: runs of letters/digits (Vietnamese syllables count one each). */
export function countWords(content: string): number {
  return content.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0;
}

/** A node's worth, from its content's word count (see `countWords`). */
export function nodeExp(words: number, config: LevelConfig): number {
  const bonus = Math.floor(words / config.wordsPerExp);
  return config.expPerNode + Math.min(config.maxContentExpPerNode, bonus);
}

/**
 * A node's 5 Whys EXP, from the depth of each answered why in all its
 * sessions (see `answeredWhyDepths`): doubles per level, capped per node.
 */
export function whysExp(depths: readonly number[], config: LevelConfig): number {
  let total = 0;
  for (const depth of depths) {
    total += config.expPerWhy * 2 ** (depth - 1);
    if (total >= config.maxWhysExpPerNode) return config.maxWhysExpPerNode;
  }
  return total;
}

export interface LevelProgress {
  level: number;
  /** Total EXP at which the current level started. */
  levelStartExp: number;
  /** Total EXP for the next level; null at the top level. */
  nextLevelExp: number | null;
}

export function levelFor(exp: number, config: LevelConfig): LevelProgress {
  const thresholds = config.levelThresholds;
  let reached = 0;
  while (reached < thresholds.length && exp >= (thresholds[reached] ?? Infinity)) reached++;
  return {
    level: reached + 1,
    levelStartExp: reached === 0 ? 0 : (thresholds[reached - 1] ?? 0),
    nextLevelExp: thresholds[reached] ?? null,
  };
}

export interface ExpTag {
  id: string;
  parentId: string | null;
}
export interface ExpNode {
  /** `countWords(content)`, cached by the server. */
  words: number;
  tagIds: readonly string[];
  /** Depth of every answered why in the node's sessions (`answeredWhyDepths`). */
  whyDepths: readonly number[];
}

/**
 * Per tag: EXP from the distinct nodes tagged with it or a descendant, and
 * how many such nodes there are. Tags without nodes are included with 0.
 */
export function computeTagExp(
  tags: readonly ExpTag[],
  nodes: readonly ExpNode[],
  config: LevelConfig,
): Map<string, { exp: number; nodeCount: number }> {
  const parentOf = new Map(tags.map((t) => [t.id, t.parentId]));
  const out = new Map(tags.map((t) => [t.id, { exp: 0, nodeCount: 0 }]));
  for (const node of nodes) {
    const fields = new Set<string>();
    for (const tagId of node.tagIds) {
      // Walk up to the root; `fields` doubles as the cycle guard.
      for (let id: string | null = tagId; id !== null && !fields.has(id);) {
        if (!parentOf.has(id)) break; // unknown or deleted tag
        fields.add(id);
        id = parentOf.get(id) ?? null;
      }
    }
    if (fields.size === 0) continue;
    const exp = nodeExp(node.words, config) + whysExp(node.whyDepths, config);
    for (const id of fields) {
      const entry = out.get(id);
      if (entry) {
        entry.exp += exp;
        entry.nodeCount += 1;
      }
    }
  }
  return out;
}

export const tagExpSchema = z.object({
  tagId: idSchema,
  exp: z.number().int().nonnegative(),
  nodeCount: z.number().int().nonnegative(),
  level: z.number().int().positive(),
  levelStartExp: z.number().int().nonnegative(),
  nextLevelExp: z.number().int().positive().nullable(),
});
export type TagExp = z.infer<typeof tagExpSchema>;

/** GET /api/exp */
export const expSnapshotSchema = z.object({
  maxLevel: z.number().int().positive(),
  tags: z.array(tagExpSchema),
});
export type ExpSnapshot = z.infer<typeof expSnapshotSchema>;

export function expSnapshot(
  tags: readonly ExpTag[],
  nodes: readonly ExpNode[],
  config: LevelConfig,
): ExpSnapshot {
  const totals = computeTagExp(tags, nodes, config);
  return {
    maxLevel: config.levelThresholds.length + 1,
    tags: tags.map((t) => {
      const { exp, nodeCount } = totals.get(t.id) ?? { exp: 0, nodeCount: 0 };
      return { tagId: t.id, exp, nodeCount, ...levelFor(exp, config) };
    }),
  };
}
