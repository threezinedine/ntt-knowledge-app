import type { Edge, LocalGraph } from '@km/core';
import type { PromptLanguage } from '../ai/copyPrompt';

/**
 * The link-check prompt: an AI fact-checks every link of a node's local
 * graph (level 1–3) and replies once with a readable markdown report. The
 * app saves nothing from it; the user reads the report and fixes links.
 * Both languages live here as data (the prompt language is picked apart
 * from the UI language).
 */

/** Tag paths of a node, e.g. "Computer / CPU". */
export type TagPaths = (tagIds: readonly string[]) => string[];

const TEXT = {
  en: {
    intro:
      'You are a careful fact-checker for my personal knowledge graph. Each note has a title, tags and a description, and notes are joined by named, directed links ("A -[NAME]-> B" reads "A NAME B"). Check whether my links are right.',
    scope: '# Scope',
    scopeLine: (title: string, depth: number) =>
      `Starting note: [N1] ${title}. Level ${String(depth)}: every note at most ${String(depth)} link${depth === 1 ? '' : 's'} away from it, in either direction.`,
    counts: (notes: number, links: number) =>
      `${String(notes)} notes, ${String(links)} links to check.`,
    notes: '# Notes',
    start: 'starting note',
    distance: (d: number) => `${String(d)} link${d === 1 ? '' : 's'} away`,
    tags: 'Tags',
    noTags: 'none',
    description: 'Description',
    empty: '(empty)',
    outgoing: 'Outgoing links',
    incoming: 'Incoming links',
    none: '(none)',
    outside: 'outside the scope: context only, do not judge',
    toCheck: '# Links to check',
    noLinks: '(there are no links in this scope)',
    task: '# What to do',
    t1: 'Judge EVERY link L1, L2, … listed above: is the relation true, in that direction, and is its name the right word for it? Give each one verdict:',
    vOk: '✅ Correct',
    vFix: '✏️ Fix: the idea holds but the name or the direction is wrong',
    vBad: '❌ Wrong: the relation does not hold',
    vUnsure: '⚠️ Unsure: you cannot tell from the notes and well-established knowledge',
    t2: 'Base it on my descriptions and on well-established knowledge. If a description contradicts established facts, say so in that link’s reason. Do not invent facts: when you are not sure, say Unsure and what would settle it.',
    t3: 'Links marked "outside the scope" are only there for context: do not judge them.',
    t4: 'Answer in one reply, without asking me anything back. Write in English.',
    format: '# Reply format (markdown)',
    fSummary: '## Summary',
    fSummaryBody:
      'One line with the counts (✅ n · ✏️ n · ❌ n · ⚠️ n), then 1–3 sentences on the main problems.',
    fLinks: '## Links',
    fLinkHead: '### L1 · A -[NAME]-> B: <verdict>',
    fWhy: 'Why: 1–3 sentences.',
    fFix: 'Fix: only for ✏️ ❌ ⚠️: the concrete change (a better name, reverse it, delete it, or what to check).',
    fOrder: 'List every link, in order L1, L2, …',
  },
  vi: {
    intro:
      'Bạn là người kiểm chứng (fact-check) cẩn thận cho đồ thị kiến thức cá nhân của mình. Mỗi ghi chú có tiêu đề, tag và mô tả; các ghi chú nối với nhau bằng liên kết có tên và có hướng ("A -[TÊN]-> B" đọc là "A TÊN B"). Hãy kiểm tra các liên kết của mình có đúng không.',
    scope: '# Phạm vi',
    scopeLine: (title: string, depth: number) =>
      `Ghi chú gốc: [N1] ${title}. Level ${String(depth)}: mọi ghi chú cách nó tối đa ${String(depth)} liên kết, theo cả hai chiều.`,
    counts: (notes: number, links: number) =>
      `${String(notes)} ghi chú, ${String(links)} liên kết cần kiểm tra.`,
    notes: '# Các ghi chú',
    start: 'ghi chú gốc',
    distance: (d: number) => `cách ${String(d)} liên kết`,
    tags: 'Tag',
    noTags: 'không có',
    description: 'Mô tả',
    empty: '(trống)',
    outgoing: 'Liên kết đi ra',
    incoming: 'Liên kết đi vào',
    none: '(không có)',
    outside: 'ngoài phạm vi: chỉ để hiểu bối cảnh, không đánh giá',
    toCheck: '# Các liên kết cần kiểm tra',
    noLinks: '(phạm vi này không có liên kết nào)',
    task: '# Việc cần làm',
    t1: 'Đánh giá TỪNG liên kết L1, L2, … ở trên: quan hệ đó có đúng không, đúng chiều không, và tên liên kết có phải từ đúng cho nó không? Mỗi liên kết một kết luận:',
    vOk: '✅ Đúng',
    vFix: '✏️ Sửa: ý thì đúng nhưng tên hoặc chiều bị sai',
    vBad: '❌ Sai: quan hệ này không đúng',
    vUnsure: '⚠️ Chưa chắc: không kết luận được từ ghi chú và kiến thức phổ biến',
    t2: 'Dựa vào mô tả của mình và kiến thức đã được công nhận rộng rãi. Nếu mô tả mâu thuẫn với kiến thức đó, hãy nói rõ trong lý do của liên kết. Không bịa: khi không chắc, ghi Chưa chắc và nói cần kiểm tra gì.',
    t3: 'Các liên kết ghi "ngoài phạm vi" chỉ để hiểu bối cảnh: không đánh giá chúng.',
    t4: 'Trả lời trong một lượt, không hỏi lại mình. Viết bằng tiếng Việt.',
    format: '# Định dạng trả lời (markdown)',
    fSummary: '## Tóm tắt',
    fSummaryBody:
      'Một dòng đếm số lượng (✅ n · ✏️ n · ❌ n · ⚠️ n), rồi 1–3 câu về các vấn đề chính.',
    fLinks: '## Các liên kết',
    fLinkHead: '### L1 · A -[TÊN]-> B: <kết luận>',
    fWhy: 'Lý do: 1–3 câu.',
    fFix: 'Cách sửa: chỉ với ✏️ ❌ ⚠️: thay đổi cụ thể (tên tốt hơn, đảo chiều, xoá, hoặc cần kiểm tra gì).',
    fOrder: 'Liệt kê đủ mọi liên kết, theo thứ tự L1, L2, …',
  },
} as const;

/** Notes as [N1], [N2], … (the starting note is N1) and links to check as L1, L2, … */
export function labelGraph(graph: LocalGraph) {
  const noteLabel = new Map(graph.nodes.map((n, i) => [n.id, `N${String(i + 1)}`]));
  const linkLabel = new Map(graph.edges.map((e, i) => [e.id, `L${String(i + 1)}`]));
  return { noteLabel, linkLabel };
}

export function buildLinkCheckPrompt(
  graph: LocalGraph,
  tagPaths: TagPaths,
  lang: PromptLanguage,
): string {
  const x = TEXT[lang];
  const { noteLabel, linkLabel } = labelGraph(graph);
  const title = new Map(graph.nodes.map((n) => [n.id, n.title]));
  const ref = (id: string) => `[${noteLabel.get(id) ?? '?'}] ${title.get(id) ?? '?'}`;
  const root = graph.nodes[0];
  const lines: string[] = [
    x.intro,
    '',
    x.scope,
    x.scopeLine(root?.title ?? '', graph.depth),
    x.counts(graph.nodes.length, graph.edges.length),
    '',
    x.notes,
  ];

  for (const node of graph.nodes) {
    const outLines: string[] = [];
    const inLines: string[] = [];
    for (const e of graph.edges) {
      if (e.fromId === node.id)
        outLines.push(`- -[${e.name}]-> ${ref(e.toId)} (${linkLabel.get(e.id) ?? ''})`);
      if (e.toId === node.id && e.fromId !== node.id) {
        inLines.push(`- ${ref(e.fromId)} -[${e.name}]-> (${linkLabel.get(e.id) ?? ''})`);
      }
    }
    for (const b of graph.boundary) {
      if (b.edge.fromId === node.id)
        outLines.push(`- -[${b.edge.name}]-> ${b.outside.title} (${x.outside})`);
      if (b.edge.toId === node.id)
        inLines.push(`- ${b.outside.title} -[${b.edge.name}]-> (${x.outside})`);
    }
    const tags = tagPaths(node.tagIds);
    lines.push(
      '',
      `## ${ref(node.id)} (${node.distance === 0 ? x.start : x.distance(node.distance)})`,
      `${x.tags}: ${tags.length ? tags.join(', ') : x.noTags}`,
      `${x.description}:`,
      `<<<${noteLabel.get(node.id) ?? ''}`,
      node.content.trim() || x.empty,
      `${noteLabel.get(node.id) ?? ''}>>>`,
      `${x.outgoing}:`,
      ...(outLines.length ? outLines : [x.none]),
      `${x.incoming}:`,
      ...(inLines.length ? inLines : [x.none]),
    );
  }

  lines.push('', x.toCheck);
  if (graph.edges.length === 0) lines.push(x.noLinks);
  for (const e of graph.edges) lines.push(`- ${linkLine(e, linkLabel, ref)}`);

  lines.push(
    '',
    x.task,
    `1. ${x.t1}`,
    `   - ${x.vOk}`,
    `   - ${x.vFix}`,
    `   - ${x.vBad}`,
    `   - ${x.vUnsure}`,
    `2. ${x.t2}`,
    `3. ${x.t3}`,
    `4. ${x.t4}`,
    '',
    x.format,
    x.fSummary,
    x.fSummaryBody,
    x.fLinks,
    x.fLinkHead,
    x.fWhy,
    x.fFix,
    '',
    x.fOrder,
  );
  return lines.join('\n');
}

function linkLine(
  e: Edge,
  linkLabel: ReadonlyMap<string, string>,
  ref: (id: string) => string,
): string {
  return `${linkLabel.get(e.id) ?? ''}: ${ref(e.fromId)} -[${e.name}]-> ${ref(e.toId)}`;
}
