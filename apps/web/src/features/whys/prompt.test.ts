import { parseWhysText, type NodeEdges } from '@km/core';
import { describe, expect, it } from 'vitest';
import { buildWhysPrompt } from './prompt';

const edges: NodeEdges = {
  outgoing: [
    {
      edge: {
        id: 'e1',
        fromId: 'a',
        toId: 'b',
        name: 'USES',
        props: {},
        createdAt: 0,
        updatedAt: 0,
      },
      neighbor: { id: 'b', type: 'note', title: 'RAM', position: null },
    },
  ],
  incoming: [
    {
      edge: {
        id: 'e2',
        fromId: 'c',
        toId: 'a',
        name: 'PART_OF',
        props: {},
        createdAt: 0,
        updatedAt: 0,
      },
      neighbor: { id: 'c', type: 'note', title: 'CPU', position: null },
    },
  ],
};

const input = {
  title: 'Cache',
  content: 'A cache is fast because it is small.',
  edges,
  sessions: [
    {
      summary: 'Looked at size',
      conclusion: 'Size is\nnot the reason',
      whys: [
        {
          id: 'w',
          question: 'Why does small mean fast?',
          answer: 'Fewer places\nto look',
          takeaway: 'Lookup cost',
          children: [
            { id: 'w2', question: 'Why fewer places?', answer: '', takeaway: '', children: [] },
          ],
        },
      ],
    },
  ],
};

describe('buildWhysPrompt', () => {
  it('gives the AI the topic, the links and the earlier sessions', () => {
    const p = buildWhysPrompt(input, 'en');
    expect(p).toContain('Title: Cache');
    expect(p).toContain('<<<NOTES\nA cache is fast because it is small.\nNOTES>>>');
    expect(p).toContain('- Cache -[USES]-> RAM');
    expect(p).toContain('- CPU -[PART_OF]-> Cache');
    // Earlier sessions in full: every why with my answer, deeper ones indented.
    expect(p).toContain(
      [
        '- Session 1',
        '  Summary: Looked at size',
        '  Conclusion: Size is not the reason',
        '  1. Why does small mean fast?',
        '     My answer: Fewer places to look',
        '     Takeaway: Lookup cost',
        '    1.1. Why fewer places?',
        '       My answer: (not answered)',
      ].join('\n'),
    );
    expect(p).toContain('"deeper"');
    expect(p).toContain('"end"');
    expect(p).toContain('Write in English.');
  });

  it('leaves out empty sections and says when there are no notes', () => {
    const p = buildWhysPrompt({ title: 'X', content: '  ', edges: undefined, sessions: [] }, 'en');
    expect(p).toContain('(no notes yet');
    expect(p).not.toContain('Related notes');
    expect(p).not.toContain('Earlier 5 Whys');
  });

  it('has a Vietnamese version with both command spellings', () => {
    const p = buildWhysPrompt(input, 'vi');
    expect(p).toContain('Tiêu đề: Cache');
    expect(p).toContain('"đào sâu" (hoặc "deeper")');
    expect(p).toContain('"kết thúc" (hoặc "end")');
    expect(p).toContain('Viết bằng tiếng Việt.');
  });

  it('shows the AI a JSON example the app itself accepts', () => {
    for (const lang of ['en', 'vi'] as const) {
      const p = buildWhysPrompt(input, lang);
      const res = parseWhysText(p.slice(p.indexOf('```json')));
      expect(res.ok, lang).toBe(true);
    }
  });
});
