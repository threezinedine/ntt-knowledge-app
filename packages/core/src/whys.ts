import { z } from 'zod';
import { entityMetaShape, idSchema } from './schemas/common.js';

/**
 * "5 Whys" critique sessions. Each node can have several sessions: the user
 * runs one in any AI chat (the app builds the prompt), the AI asks one "why"
 * at a time about the node's notes, the user answers, and on "end" the AI
 * returns the session as JSON in the `km-whys/1` format, which is pasted
 * back and saved. A session is a tree: a child digs deeper into its parent's
 * answer, a sibling challenges another point.
 *
 * Stored as one row per session with the tree as JSON; every why has its
 * own id. Answered whys earn EXP by depth (see `whysExp` in exp.ts).
 */

export const WHYS_FORMAT = 'km-whys/1';
export const WHY_QUESTION_MAX = 2_000;
export const WHY_ANSWER_MAX = 20_000;
export const WHY_TAKEAWAY_MAX = 2_000;
export const WHY_SUMMARY_MAX = 10_000;
/** Whys in one session, all levels together. */
export const WHYS_MAX_ITEMS = 300;
/** Levels in one session (1 = only top-level whys). */
export const WHYS_MAX_DEPTH = 30;

export interface WhyItem {
  id: string;
  question: string;
  /** The user's own answer; '' if it was left unanswered. */
  answer: string;
  /** One-line point of this why, written by the AI at the end. */
  takeaway: string;
  /** Deeper whys about this one's answer. */
  children: WhyItem[];
}

/** As sent to the API: ids may be left out (the server assigns them). */
export interface WhyItemInput {
  id?: string | undefined;
  question: string;
  answer?: string | undefined;
  takeaway?: string | undefined;
  children?: WhyItemInput[] | undefined;
}

export type WhyItemData = Omit<WhyItem, 'id' | 'children'> & {
  id?: string | undefined;
  children: WhyItemData[];
};

const questionSchema = z.string().trim().min(1).max(WHY_QUESTION_MAX);
const answerSchema = z.string().trim().max(WHY_ANSWER_MAX);
const takeawaySchema = z.string().trim().max(WHY_TAKEAWAY_MAX);
const summarySchema = z.string().trim().max(WHY_SUMMARY_MAX);

export const whyItemSchema: z.ZodType<WhyItem> = z.object({
  id: idSchema,
  question: questionSchema,
  answer: answerSchema,
  takeaway: takeawaySchema,
  get children() {
    return z.array(whyItemSchema);
  },
});

export const whyItemInputSchema: z.ZodType<WhyItemData, WhyItemInput> = z.strictObject({
  id: idSchema.optional(),
  question: questionSchema,
  answer: answerSchema.default(''),
  takeaway: takeawaySchema.default(''),
  get children() {
    return z.array(whyItemInputSchema).default([]);
  },
});

interface Tree {
  id?: string | undefined;
  children: Tree[];
}

/** Every why in the tree, depth-first (parents before children). Iterative. */
export function flattenWhys<T extends Tree>(items: readonly T[]): T[] {
  const out: T[] = [];
  const stack: T[] = [...items].reverse();
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    out.push(item);
    for (let i = item.children.length - 1; i >= 0; i--) stack.push(item.children[i] as T);
  }
  return out;
}

/** Levels in the tree: 0 when empty, 1 when there are only top-level whys. Iterative. */
export function whysDepth(items: readonly Tree[]): number {
  let max = 0;
  const stack = items.map((item) => ({ item, depth: 1 }));
  for (let top = stack.pop(); top !== undefined; top = stack.pop()) {
    max = Math.max(max, top.depth);
    for (const child of top.item.children) stack.push({ item: child, depth: top.depth + 1 });
  }
  return max;
}

/**
 * The depth (1 = top level) of every why the user answered, for EXP. An
 * unanswered why earns nothing, but its answered children keep their depth.
 * Iterative.
 */
export function answeredWhyDepths(items: readonly AnswerTree[]): number[] {
  const out: number[] = [];
  const stack = items.map((item) => ({ item, depth: 1 }));
  for (let top = stack.pop(); top !== undefined; top = stack.pop()) {
    if (top.item.answer.trim() !== '') out.push(top.depth);
    for (const child of top.item.children) stack.push({ item: child, depth: top.depth + 1 });
  }
  return out;
}
interface AnswerTree {
  answer: string;
  children: readonly AnswerTree[];
}

/**
 * Size and depth of a tree that is not validated yet (parsed JSON), without
 * recursion: zod walks `children` recursively, so a tree nested thousands
 * deep must be refused before it gets there, or the stack overflows.
 */
export function rawTreeProblem(raw: unknown): string | null {
  if (!Array.isArray(raw)) return null; // the schema says what's wrong
  let count = 0;
  const stack: { list: unknown[]; depth: number }[] = [{ list: raw, depth: 1 }];
  for (let top = stack.pop(); top !== undefined; top = stack.pop()) {
    if (top.list.length > 0 && top.depth > WHYS_MAX_DEPTH) {
      return `At most ${String(WHYS_MAX_DEPTH)} levels`;
    }
    for (const item of top.list) {
      if (++count > WHYS_MAX_ITEMS) return `At most ${String(WHYS_MAX_ITEMS)} whys`;
      const children: unknown =
        item !== null && typeof item === 'object'
          ? (item as { children?: unknown }).children
          : null;
      if (Array.isArray(children)) stack.push({ list: children, depth: top.depth + 1 });
    }
  }
  return null;
}

/** Ids unique within the session (size and depth: `rawTreeProblem`). */
function checkTree(items: readonly Tree[], ctx: z.RefinementCtx): void {
  const ids = flattenWhys(items)
    .map((w) => w.id)
    .filter((id): id is string => id !== undefined);
  if (new Set(ids).size !== ids.length) {
    ctx.addIssue({ code: 'custom', message: 'Why ids must be unique' });
  }
}

// The gate starts from `unknown`; the cast gives the API input its real type
// back, so web callers are still checked at compile time.
const whysTreeInputSchema = z
  .unknown()
  // `abort`: a failed gate must stop here, before the pipe recurses.
  .refine((raw) => rawTreeProblem(raw) === null, {
    abort: true,
    error: (issue) => rawTreeProblem(issue.input) ?? 'Too large',
  })
  .pipe(z.array(whyItemInputSchema).min(1).superRefine(checkTree)) as unknown as z.ZodType<
  WhyItemData[],
  WhyItemInput[]
>;

export const whySessionSchema = z.object({
  ...entityMetaShape,
  nodeId: idSchema,
  summary: z.string(),
  /** Root cause / what the session concluded. */
  conclusion: z.string(),
  whys: z.array(whyItemSchema),
});
export type WhySession = z.infer<typeof whySessionSchema>;

/** POST /api/nodes/:id/whys */
export const createWhySessionInputSchema = z.strictObject({
  summary: summarySchema.default(''),
  conclusion: summarySchema.default(''),
  whys: whysTreeInputSchema,
});
export type CreateWhySessionInput = z.input<typeof createWhySessionInputSchema>;
export type CreateWhySessionData = z.output<typeof createWhySessionInputSchema>;

/** PATCH /api/whys/:id; `whys` replaces the whole tree. */
export const updateWhySessionInputSchema = z.strictObject({
  summary: summarySchema.optional(),
  conclusion: summarySchema.optional(),
  whys: whysTreeInputSchema.optional(),
});
export type UpdateWhySessionInput = z.input<typeof updateWhySessionInputSchema>;
export type UpdateWhySessionData = z.output<typeof updateWhySessionInputSchema>;

// ---------- the pasted JSON (km-whys/1) ----------

/** AIs write `null` or leave fields out; both mean empty. */
const looseText = z
  .string()
  .nullish()
  .transform((v) => v ?? '');

interface LooseWhy {
  id?: string | undefined;
  question: string;
  answer: string;
  takeaway: string;
  children: LooseWhy[];
}

// Unknown keys are dropped, not refused: an AI may add its own.
const looseWhySchema: z.ZodType<LooseWhy> = z.object({
  id: idSchema.optional().catch(undefined),
  question: z.string(),
  answer: looseText,
  takeaway: looseText,
  get children() {
    return z
      .array(looseWhySchema)
      .nullish()
      .transform((v) => v ?? []);
  },
});

const looseDocumentSchema = z.object({
  format: z.literal(WHYS_FORMAT).optional(),
  summary: looseText,
  conclusion: looseText,
  whys: z.array(looseWhySchema),
});

export type WhysParseError =
  /** Nothing that looks like a JSON object. */
  | { kind: 'noJson' }
  /** Looks like JSON but doesn't parse. */
  | { kind: 'invalidJson' }
  /** Parses, but isn't a km-whys/1 session (or breaks a limit). */
  | { kind: 'badShape'; path: string };

export type WhysParseResult =
  { ok: true; value: CreateWhySessionData } | { ok: false; error: WhysParseError };

/**
 * The JSON part of an AI reply: the last ```json (or bare ```) block that
 * holds an object (a whole pasted chat must not yield the prompt's example),
 * else everything from the first `{` to the last `}`.
 */
export function extractJson(text: string): string | null {
  let found: string | null = null;
  for (const match of text.matchAll(/```[a-zA-Z]*\s*\n([\s\S]*?)```/g)) {
    const body = (match[1] ?? '').trim();
    if (body.startsWith('{')) found = body;
  }
  if (found !== null) return found;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  return start !== -1 && end > start ? text.slice(start, end + 1) : null;
}

const issuePath = (issue: z.core.$ZodIssue | undefined): string =>
  issue ? issue.path.map(String).join('.') : '';

/** Reads a pasted AI reply (or an edited export) into a session to save. */
export function parseWhysText(text: string): WhysParseResult {
  const json = extractJson(text);
  if (json === null) return { ok: false, error: { kind: 'noJson' } };
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { ok: false, error: { kind: 'invalidJson' } };
  }
  // Before zod recurses into it (see rawTreeProblem).
  const tree: unknown =
    raw !== null && typeof raw === 'object' ? (raw as { whys?: unknown }).whys : null;
  if (rawTreeProblem(tree) !== null) {
    return { ok: false, error: { kind: 'badShape', path: 'whys' } };
  }
  const loose = looseDocumentSchema.safeParse(raw);
  if (!loose.success) {
    return { ok: false, error: { kind: 'badShape', path: issuePath(loose.error.issues[0]) } };
  }
  const { summary, conclusion, whys } = loose.data;
  const strict = createWhySessionInputSchema.safeParse({ summary, conclusion, whys });
  if (!strict.success) {
    return { ok: false, error: { kind: 'badShape', path: issuePath(strict.error.issues[0]) } };
  }
  return { ok: true, value: strict.data };
}

/** A saved session as km-whys/1 JSON (ids kept, so editing it keeps them). */
export function whysDocument(session: Pick<WhySession, 'summary' | 'conclusion' | 'whys'>): string {
  return JSON.stringify(
    {
      format: WHYS_FORMAT,
      summary: session.summary,
      conclusion: session.conclusion,
      whys: session.whys,
    },
    null,
    2,
  );
}
