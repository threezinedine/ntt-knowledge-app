import type { Edge, GraphNode, WhyItem, WhySession } from '@km/core';

/**
 * Markdown export: one file per node, readable without this app (Obsidian,
 * VS Code, any editor). Front matter (YAML; every string written as a JSON
 * string, which YAML reads as-is) holds the id, type, dates, tag paths,
 * props and links as [[wiki links]] to the other files; the body is the
 * node's content, then its 5 Whys sessions.
 */

export interface ExportInput {
  nodes: readonly GraphNode[];
  edges: readonly Edge[];
  /** Tag id → path, e.g. "Computer/CPU". */
  tagPath: ReadonlyMap<string, string>;
  /** Node id → its sessions, oldest first. */
  whys: ReadonlyMap<string, readonly WhySession[]>;
}

export interface ExportFile {
  /** File name, unique (case-insensitively) within the export. */
  name: string;
  content: string;
}

/** Device names Windows reserves, also with an extension ("nul.txt"). */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
const NAME_MAX = 100;

/** A title as a file name that works on Windows, macOS and Linux (no extension). */
export function fileStem(title: string): string {
  let stem = title
    // Path separators, characters Windows forbids, and ones that break [[links]].
    .replace(/[\\/:*?"<>|#^[\]]|\p{Cc}/gu, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  if (stem.length > NAME_MAX) stem = stem.slice(0, NAME_MAX).trimEnd();
  if (stem === '') stem = 'untitled';
  if (WINDOWS_RESERVED.test(stem)) stem = `_${stem}`;
  return stem;
}

/** Node id → unique file stem; same titles get " (2)", " (3)", … in id order. */
export function fileStems(nodes: readonly Pick<GraphNode, 'id' | 'title'>[]): Map<string, string> {
  const taken = new Set<string>();
  const out = new Map<string, string>();
  for (const node of [...nodes].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const base = fileStem(node.title);
    let stem = base;
    for (let n = 2; taken.has(stem.toLowerCase()); n++) stem = `${base} (${String(n)})`;
    taken.add(stem.toLowerCase());
    out.set(node.id, stem);
  }
  return out;
}

const str = (s: string) => JSON.stringify(s);
const iso = (ms: number) => new Date(ms).toISOString();

function whyLines(items: readonly WhyItem[], indent: string): string[] {
  return items.flatMap((w, i) => {
    const marker = `${String(i + 1)}. `;
    const pad = `${indent}${' '.repeat(marker.length)}`;
    const block = (text: string) => text.split('\n').map((l) => (l ? `${pad}${l}` : ''));
    return [
      `${indent}${marker}**${w.question.replace(/\s*\n\s*/g, ' ')}**`,
      ...(w.answer ? block(w.answer) : [`${pad}_(no answer)_`]),
      ...(w.takeaway ? [`${pad}→ _${w.takeaway.replace(/\s*\n\s*/g, ' ')}_`] : []),
      ...whyLines(w.children, pad),
    ];
  });
}

export function renderMarkdownExport(input: ExportInput): ExportFile[] {
  const stems = fileStems(input.nodes);
  const link = (id: string) => str(`[[${stems.get(id) ?? id}]]`);
  return input.nodes.map((node) => {
    const out = input.edges.filter((e) => e.fromId === node.id && stems.has(e.toId));
    const inc = input.edges.filter((e) => e.toId === node.id && stems.has(e.fromId));
    const tags = node.tagIds.flatMap((id) => {
      const path = input.tagPath.get(id);
      return path === undefined ? [] : [path];
    });
    const front = [
      '---',
      `id: ${str(node.id)}`,
      `title: ${str(node.title)}`,
      `type: ${str(node.type)}`,
      `created: ${str(iso(node.createdAt))}`,
      `updated: ${str(iso(node.updatedAt))}`,
      `tags: [${tags.map(str).join(', ')}]`,
      ...(Object.keys(node.props).length ? [`props: ${JSON.stringify(node.props)}`] : []),
      ...(out.length
        ? ['links:', ...out.map((e) => `  - { relation: ${str(e.name)}, to: ${link(e.toId)} }`)]
        : []),
      ...(inc.length
        ? [
            'backlinks:',
            ...inc.map((e) => `  - { relation: ${str(e.name)}, from: ${link(e.fromId)} }`),
          ]
        : []),
      '---',
    ];
    const body = [node.content.trim()];
    const sessions = input.whys.get(node.id) ?? [];
    if (sessions.length) {
      body.push('', '## 5 Whys');
      sessions.forEach((s, i) => {
        body.push('', `### Session ${String(i + 1)} · ${iso(s.createdAt).slice(0, 10)}`);
        if (s.summary) body.push('', s.summary);
        if (s.conclusion) body.push('', `**Conclusion:** ${s.conclusion}`);
        body.push('', ...whyLines(s.whys, ''));
      });
    }
    return {
      name: `${stems.get(node.id) ?? node.id}.md`,
      content: `${[...front, '', ...body].join('\n').trimEnd()}\n`,
    };
  });
}
