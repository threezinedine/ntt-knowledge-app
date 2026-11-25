import { z } from 'zod';

/**
 * Wikilinks: `[[Title]]` or `[[Title|shown text]]` in a node's markdown links
 * to the node with that title. They are only links in the text: no edge is
 * made. A title that matches no node stays plain text.
 *
 * Mentions are linked automatically (the user's design): plain text equal to
 * another node's title (any case) becomes `[[Title]]`, or `[[Title|text]]`
 * when the case differs, so the text reads the same. Renaming a node rewrites
 * `[[Old]]` to `[[New]]` everywhere. Code, existing links and URLs are left
 * alone.
 */

/** `[[target]]` or `[[target|label]]`, on one line, no brackets inside. */
const WIKILINK = /\[\[([^[\]|\n]+?)(?:\|([^[\]\n]+?))?\]\]/g;

/** Titles this short are never linked automatically ("Go", "AI" would be everywhere). */
export const MIN_AUTOLINK_TITLE = 3;

export interface Wikilink {
  start: number;
  end: number;
  target: string;
  label: string | null;
}

export function parseWikilinks(text: string): Wikilink[] {
  const out: Wikilink[] = [];
  for (const m of text.matchAll(WIKILINK)) {
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      target: (m[1] ?? '').trim(),
      label: m[2]?.trim() ?? null,
    });
  }
  return out;
}

/** Case-insensitive key for matching a link target to a title (runs of spaces count as one). */
export const titleKey = (title: string): string => title.trim().replace(/\s+/g, ' ').toLowerCase();

interface TitledNode {
  id: string;
  title: string;
}

/**
 * Resolves link targets to node ids: the title written exactly first, then
 * any case. Several nodes with that title: the oldest (UUIDv7 ids sort by
 * creation time).
 */
export function createWikilinkResolver(nodes: readonly TitledNode[]) {
  const exact = new Map<string, string>();
  const loose = new Map<string, string>();
  const sorted = [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const n of sorted) {
    const title = n.title.trim();
    if (!exact.has(title)) exact.set(title, n.id);
    const key = titleKey(title);
    if (!loose.has(key)) loose.set(key, n.id);
  }
  return (target: string): string | null =>
    exact.get(target.trim()) ?? loose.get(titleKey(target)) ?? null;
}

/**
 * Ranges of `text` no rewrite may touch. Erring on the side of too much: a
 * missed link costs nothing, a rewrite inside code or a URL breaks it.
 */
const PROTECTED: readonly RegExp[] = [
  // Fenced code: ``` or ~~~ up to the same fence (or the end).
  /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]*\1[ \t]*$|(?![\s\S]))/gm,
  /^(?: {4}|\t).*$/gm, // indented code (and anything indented that far)
  /(`+)[^`\n][\s\S]*?\1/g, // inline code
  WIKILINK,
  /^ {0,3}\[[^\]\n]+\]:.*$/gm, // [ref]: url definitions
  /!?\[[^\]\n]*\](?:\([^)\n]*\)|\[[^\]\n]*\])?/g, // [text](url), [text][ref], [ref], ![alt](src)
  /<!--[\s\S]*?(?:-->|$(?![\s\S]))/g, // HTML comments
  /<\/?[a-z][^>\n]*>/gi, // HTML tags and <https://...> autolinks
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s<>]+/gi, // bare URLs (parentheses included)
  /\bwww\.[^\s<>]+/gi, // www. autolinks
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, // e-mail addresses
];

/** `text` with every protected character replaced by NUL: same length, nothing to match there. */
function maskProtected(text: string): string {
  const chars = text.split('');
  for (const re of PROTECTED) {
    for (const m of text.matchAll(re)) chars.fill('\0', m.index, m.index + m[0].length);
  }
  return chars.join('');
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Can this title be put inside `[[...]]` and found in text? */
const linkableTitle = (title: string) =>
  title.trim().length >= MIN_AUTOLINK_TITLE && !/[[\]|\n]/.test(title);

/** Part of a word: letters (with their combining accents), digits, `_`. */
const WORD = String.raw`[\p{L}\p{M}\p{N}_]`;

/**
 * Turns plain mentions of `titles` in `text` into wikilinks. Whole words only
 * (`redis-cli`, `redis.conf` and `Redistribute` aren't mentions of Redis), any
 * case, the longest title first where two overlap, never across a line break.
 * Idempotent: running it again changes nothing.
 */
export function linkMentions(text: string, titles: readonly string[]): string {
  const byKey = new Map<string, string>();
  for (const t of titles) {
    const title = t.trim();
    if (!linkableTitle(title)) continue;
    const key = titleKey(title);
    if (!byKey.has(key) || title === byKey.get(key)) byKey.set(key, title);
  }
  if (byKey.size === 0) return text;
  const alternatives = [...byKey.values()]
    .sort((a, b) => b.length - a.length)
    .map((t) => escapeRegExp(t).replace(/\s+/g, String.raw`[ \t]+`));
  const re = new RegExp(
    `(?<!${WORD}|${WORD}[-.])(?:${alternatives.join('|')})(?!${WORD}|[-.]${WORD})`,
    'giu',
  );
  const masked = maskProtected(text);
  let out = '';
  let last = 0;
  // Start of the line a match is on, found walking forward (linear overall).
  let lineStart = 0;
  let nextBreak = text.indexOf('\n'); // -1: none left
  for (const m of masked.matchAll(re)) {
    const start = m.index;
    const end = start + m[0].length;
    const title = byKey.get(titleKey(m[0]));
    if (title === undefined) continue;
    while (nextBreak !== -1 && nextBreak < start) {
      lineStart = nextBreak + 1;
      nextBreak = text.indexOf('\n', lineStart);
    }
    // A `|` splits table cells (with or without a leading pipe), so on a line
    // with one outside code and links, only links without a label go there.
    const lineEnd = nextBreak === -1 ? text.length : nextBreak;
    if (m[0] !== title && masked.slice(lineStart, lineEnd).includes('|')) continue;
    out += text.slice(last, start) + (m[0] === title ? `[[${title}]]` : `[[${title}|${m[0]}]]`);
    last = end;
  }
  return last === 0 ? text : out + text.slice(last);
}

/**
 * `[[Old]]` / `[[Old|label]]` (any case) become `[[New]]` / `[[New|label]]`.
 * Links inside code are left alone, like everything else there.
 */
export function renameWikilinks(text: string, oldTitle: string, newTitle: string): string {
  const oldKey = titleKey(oldTitle);
  const target = newTitle.trim();
  if (oldKey === '' || !linkableTarget(target)) return text;
  // Protected minus the wikilinks themselves: what is left is code, URLs and the like.
  const masked = maskProtected(text.replace(WIKILINK, (m) => '\u0001'.repeat(m.length)));
  let out = '';
  let last = 0;
  for (const link of parseWikilinks(text)) {
    if (titleKey(link.target) !== oldKey || masked[link.start] === '\0') continue;
    const label = link.label === null ? '' : `|${link.label}`;
    out += `${text.slice(last, link.start)}[[${target}${label}]]`;
    last = link.end;
  }
  return last === 0 ? text : out + text.slice(last);
}

const linkableTarget = (title: string) => title !== '' && !/[[\]|\n]/.test(title);

/**
 * POST /api/nodes/:id/wikilinks: link this node in once it is settled.
 * `created`: it was just made with this title (its mentions elsewhere get
 * linked). Otherwise the engine knows whether it was renamed since.
 */
export const wikilinkSyncInputSchema = z.strictObject({
  created: z.boolean(),
});
export type WikilinkSyncInput = z.output<typeof wikilinkSyncInputSchema>;

/** What changed: the nodes whose content was rewritten. */
export interface WikilinkSyncResult {
  changedIds: string[];
}
