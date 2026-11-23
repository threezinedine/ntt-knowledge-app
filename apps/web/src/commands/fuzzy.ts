/**
 * Small VS Code-like fuzzy matcher: the query's characters must appear in
 * order; word starts and runs score higher. Vietnamese diacritics are folded,
 * so "do thi" finds "Đồ thị". Indices refer to the original text (highlights).
 */

export interface FuzzyMatch {
  score: number;
  /** Indices in the original text of the matched characters. */
  indices: number[];
}

const COMBINING_MARKS = /\p{M}/gu;

/** Folds one character: lower case, no diacritics, đ → d. May return ''. */
function foldChar(c: string): string {
  return c.normalize('NFD').replace(COMBINING_MARKS, '').replace(/đ/gi, 'd').toLowerCase();
}

export function fold(text: string): string {
  return Array.from(text, foldChar).join('');
}

const WORD_SEPARATOR = /[\s\-_./:()[\]]/;

export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = fold(query).replace(/\s+/g, '');
  if (q === '') return { score: 0, indices: [] };

  // Folded text, code point by code point (as the highlighter renders it),
  // remembering each folded char's original index.
  const points = Array.from(text);
  const chars: string[] = [];
  const origin: number[] = [];
  points.forEach((c, i) => {
    const folded = foldChar(c);
    if (folded.length === 1) {
      chars.push(folded);
      origin.push(i);
    }
  });

  const isWordStart = (pos: number) => {
    if (pos === 0) return true;
    const prevOrigin = origin[pos - 1] ?? 0;
    const prev = points.slice(prevOrigin, origin[pos]).join('');
    const here = points[origin[pos] ?? 0] ?? '';
    return (
      WORD_SEPARATOR.test(prev) || (here !== here.toLowerCase() && prev === prev.toLowerCase())
    );
  };

  // Greedy, but prefer the next word start where the query char also matches.
  const indices: number[] = [];
  let score = 0;
  let pos = 0;
  let last = -2;
  for (const qc of q) {
    let found = -1;
    for (let p = pos; p < chars.length; p++) {
      if (chars[p] !== qc) continue;
      if (found === -1) found = p;
      if (p === last + 1) {
        found = p; // keep runs together
        break;
      }
      if (isWordStart(p)) {
        found = p;
        break;
      }
    }
    if (found === -1) return null;
    score += 1;
    if (found === last + 1) score += 4;
    if (isWordStart(found)) score += 6;
    if (found === 0) score += 4;
    score -= Math.min(found - last - 1, 5) * 0.1;
    indices.push(origin[found] ?? found);
    last = found;
    pos = found + 1;
  }
  return { score, indices };
}

/** Matches, best first; ties keep the input order. */
export function fuzzyFilter<T>(
  items: readonly T[],
  query: string,
  text: (item: T) => string,
): { item: T; match: FuzzyMatch }[] {
  const out: { item: T; match: FuzzyMatch; order: number }[] = [];
  items.forEach((item, order) => {
    const match = fuzzyMatch(query, text(item));
    if (match) out.push({ item, match, order });
  });
  return out
    .sort((a, b) => b.match.score - a.match.score || a.order - b.order)
    .map(({ item, match }) => ({ item, match }));
}
