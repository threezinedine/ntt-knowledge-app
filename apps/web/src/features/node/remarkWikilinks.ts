import { parseWikilinks } from '@km/core';

/** The bits of an mdast tree this plugin reads and writes. */
interface MdNode {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
  data?: { hProperties?: Record<string, string> };
}

/** Where a wikilink to `id` points: the node's page. */
export const wikilinkHref = (id: string) => `/nodes/${id}`;

/**
 * remark plugin: `[[Title]]` / `[[Title|text]]` in plain text become links to
 * that node's page (class `wikilink`). A title that matches no node stays as
 * written. Code is never touched: its text isn't a `text` node.
 */
export function remarkWikilinks(resolve: (target: string) => string | null) {
  const split = (value: string): MdNode[] => {
    const out: MdNode[] = [];
    let last = 0;
    for (const link of parseWikilinks(value)) {
      const id = resolve(link.target);
      if (id === null) continue;
      if (link.start > last) out.push({ type: 'text', value: value.slice(last, link.start) });
      out.push({
        type: 'link',
        url: wikilinkHref(id),
        data: { hProperties: { className: 'wikilink' } },
        children: [{ type: 'text', value: link.label ?? link.target }],
      });
      last = link.end;
    }
    if (last === 0) return [{ type: 'text', value }];
    if (last < value.length) out.push({ type: 'text', value: value.slice(last) });
    return out;
  };
  const walk = (node: MdNode) => {
    if (!node.children) return;
    node.children = node.children.flatMap((child) => {
      if (child.type === 'text' && child.value?.includes('[[')) return split(child.value);
      // Not inside a link: a link can't hold another.
      if (child.type !== 'link' && child.type !== 'linkReference') walk(child);
      return [child];
    });
  };
  return () => (tree: MdNode) => {
    walk(tree);
  };
}
