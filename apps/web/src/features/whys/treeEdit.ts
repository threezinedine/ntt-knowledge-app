import { newId, type WhyItem } from '@km/core';

/** Pure edits of a session's why tree (by why id); unknown ids change nothing. */

export const emptyWhy = (): WhyItem => ({
  id: newId(),
  question: '',
  answer: '',
  takeaway: '',
  children: [],
});

type Patch = Partial<Pick<WhyItem, 'question' | 'answer' | 'takeaway'>>;

function mapTree(items: readonly WhyItem[], fn: (list: WhyItem[]) => WhyItem[]): WhyItem[] {
  return fn(items.map((w) => ({ ...w, children: mapTree(w.children, fn) })));
}

export function updateWhy(items: readonly WhyItem[], id: string, patch: Patch): WhyItem[] {
  return mapTree(items, (list) => list.map((w) => (w.id === id ? { ...w, ...patch } : w)));
}

/** A deeper why under `id`, last among its children. */
export function addChild(items: readonly WhyItem[], id: string, child: WhyItem): WhyItem[] {
  return mapTree(items, (list) =>
    list.map((w) => (w.id === id ? { ...w, children: [...w.children, child] } : w)),
  );
}

/** A why at the same level, right after `id`. */
export function addSiblingAfter(
  items: readonly WhyItem[],
  id: string,
  sibling: WhyItem,
): WhyItem[] {
  return mapTree(items, (list) => list.flatMap((w) => (w.id === id ? [w, sibling] : [w])));
}

/** Removes `id` with everything under it. */
export function removeWhy(items: readonly WhyItem[], id: string): WhyItem[] {
  return mapTree(items, (list) => list.filter((w) => w.id !== id));
}
