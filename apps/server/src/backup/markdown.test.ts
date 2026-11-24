import type { Edge, GraphNode, WhySession } from '@km/core';
import { describe, expect, it } from 'vitest';
import { fileStem, fileStems, renderMarkdownExport } from './markdown.js';

const node = (id: string, title: string, extra: Partial<GraphNode> = {}): GraphNode => ({
  id,
  type: 'note',
  title,
  content: '',
  props: {},
  position: null,
  tagIds: [],
  createdAt: Date.UTC(2026, 10, 1),
  updatedAt: Date.UTC(2026, 10, 2),
  ...extra,
});
const edge = (fromId: string, toId: string, name: string): Edge => ({
  id: `${fromId}-${toId}`,
  fromId,
  toId,
  name,
  props: {},
  createdAt: 0,
  updatedAt: 0,
});

describe('file names', () => {
  it('makes titles safe on every OS and for [[links]]', () => {
    expect(fileStem('CPU / GPU: "fast"?')).toBe('CPU _ GPU_ _fast__');
    expect(fileStem('  a   b. ')).toBe('a b');
    expect(fileStem('[[x]] #tag ^ref')).toBe('__x__ _tag _ref');
    expect(fileStem('con')).toBe('con_');
    expect(fileStem('...')).toBe('untitled');
    expect(fileStem('x'.repeat(150))).toHaveLength(100);
  });

  it('keeps names unique, ignoring case', () => {
    const stems = fileStems([node('b', 'Cache'), node('a', 'cache'), node('c', 'CACHE')]);
    expect([...stems]).toEqual([
      ['a', 'cache'],
      ['b', 'Cache (2)'],
      ['c', 'CACHE (3)'],
    ]);
  });
});

describe('renderMarkdownExport', () => {
  const cpu = node('cpu', 'CPU', {
    content: '# CPU\n\nRuns "instructions".\n',
    tagIds: ['t1', 'gone'],
    props: { cores: 8 },
  });
  const cache = node('cache', 'Cache');
  const session: WhySession = {
    id: 's',
    nodeId: 'cpu',
    summary: 'Looked at speed',
    conclusion: 'Latency matters',
    whys: [
      {
        id: 'w1',
        question: 'Why is it fast?',
        answer: 'Pipelines\nand caches',
        takeaway: 'Overlap work',
        children: [{ id: 'w2', question: 'Why caches?', answer: '', takeaway: '', children: [] }],
      },
    ],
    createdAt: Date.UTC(2026, 10, 20),
    updatedAt: 0,
  };
  const files = renderMarkdownExport({
    nodes: [cache, cpu],
    edges: [edge('cpu', 'cache', 'USES'), edge('cpu', 'deleted', 'X')],
    tagPath: new Map([['t1', 'Computer/Hardware']]),
    whys: new Map([['cpu', [session]]]),
  });
  const cpuFile = files.find((f) => f.name === 'CPU.md')?.content ?? '';

  it('writes front matter with tags, props and links as wiki links', () => {
    expect(cpuFile).toContain(
      [
        '---',
        'id: "cpu"',
        'title: "CPU"',
        'type: "note"',
        'created: "2026-11-01T00:00:00.000Z"',
        'updated: "2026-11-02T00:00:00.000Z"',
        'tags: ["Computer/Hardware"]',
        'props: {"cores":8}',
        'links:',
        '  - { relation: "USES", to: "[[Cache]]" }',
        '---',
        '',
        '# CPU',
        '',
        'Runs "instructions".',
      ].join('\n'),
    );
    expect(files.find((f) => f.name === 'Cache.md')?.content).toContain(
      'backlinks:\n  - { relation: "USES", from: "[[CPU]]" }',
    );
  });

  it('appends the 5 Whys as nested lists', () => {
    expect(cpuFile).toContain(
      [
        '## 5 Whys',
        '',
        '### Session 1 · 2026-11-20',
        '',
        'Looked at speed',
        '',
        '**Conclusion:** Latency matters',
        '',
        '1. **Why is it fast?**',
        '   Pipelines',
        '   and caches',
        '   → _Overlap work_',
        '   1. **Why caches?**',
        '      _(no answer)_',
      ].join('\n'),
    );
    expect(cpuFile.endsWith('_(no answer)_\n')).toBe(true);
  });

  it('skips links to nodes that are not exported', () => {
    expect(cpuFile).not.toContain('"X"');
  });
});
