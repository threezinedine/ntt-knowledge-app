import type { Edge, LocalGraph, LocalGraphNode } from '@km/core';
import { describe, expect, it } from 'vitest';
import { buildLinkCheckPrompt } from './prompt';

const node = (id: string, title: string, distance: number, content = ''): LocalGraphNode => ({
  id,
  type: 'note',
  title,
  content,
  props: {},
  position: null,
  tagIds: id === 'cpu' ? ['t1'] : [],
  distance,
  createdAt: 0,
  updatedAt: 0,
});
const edge = (id: string, fromId: string, toId: string, name: string): Edge => ({
  id,
  fromId,
  toId,
  name,
  props: {},
  createdAt: 0,
  updatedAt: 0,
});

const graph: LocalGraph = {
  rootId: 'cpu',
  depth: 1,
  nodes: [
    node('cpu', 'CPU', 0, 'Runs instructions.'),
    node('cache', 'Cache', 1, 'Small and fast.'),
    node('comp', 'Compiler', 1),
  ],
  edges: [edge('e1', 'cpu', 'cache', 'USES'), edge('e2', 'comp', 'cpu', 'TARGETS')],
  boundary: [
    { edge: edge('e3', 'cache', 'mem', 'PART_OF'), outside: { id: 'mem', title: 'Memory' } },
  ],
};
const tagPaths = (ids: readonly string[]) => (ids.includes('t1') ? ['Computer / Hardware'] : []);

describe('buildLinkCheckPrompt', () => {
  const p = buildLinkCheckPrompt(graph, tagPaths, 'en');

  it('states the scope and counts', () => {
    expect(p).toContain('Starting note: [N1] CPU. Level 1: every note at most 1 link away');
    expect(p).toContain('3 notes, 2 links to check.');
  });

  it('gives every note its title, tags, full description and links both ways', () => {
    expect(p).toContain(
      [
        '## [N1] CPU (starting note)',
        'Tags: Computer / Hardware',
        'Description:',
        '<<<',
        'Runs instructions.',
        '>>>',
        'Outgoing links:',
        '- -[USES]-> [N2] Cache (L1)',
        'Incoming links:',
        '- [N3] Compiler -[TARGETS]-> (L2)',
      ].join('\n'),
    );
    expect(p).toContain('## [N3] Compiler (1 link away)\nTags: none\nDescription:\n<<<\n(empty)');
  });

  it('marks links leaving the scope as context only, and lists the ones to check', () => {
    expect(p).toContain('- -[PART_OF]-> Memory (outside the scope: context only, do not judge)');
    expect(p).toContain(
      '# Links to check\n- L1: [N1] CPU -[USES]-> [N2] Cache\n- L2: [N3] Compiler',
    );
    expect(p).toContain('Answer in one reply, without asking me anything back. Write in English.');
    expect(p).toContain('### L1 · A -[NAME]-> B: <verdict>');
  });

  it('says so when there is nothing to check', () => {
    const alone: LocalGraph = { ...graph, nodes: [node('cpu', 'CPU', 0)], edges: [], boundary: [] };
    expect(buildLinkCheckPrompt(alone, tagPaths, 'en')).toContain(
      '# Links to check\n(there are no links in this scope)',
    );
  });

  it('has a Vietnamese version', () => {
    const vi = buildLinkCheckPrompt(graph, tagPaths, 'vi');
    expect(vi).toContain('Ghi chú gốc: [N1] CPU. Level 1');
    expect(vi).toContain('3 ghi chú, 2 liên kết cần kiểm tra.');
    expect(vi).toContain('ngoài phạm vi: chỉ để hiểu bối cảnh');
    expect(vi).toContain('Viết bằng tiếng Việt.');
  });
});
