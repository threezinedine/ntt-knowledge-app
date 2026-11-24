import { describe, expect, it } from 'vitest';
import {
  answeredWhyDepths,
  createWhySessionInputSchema,
  extractJson,
  flattenWhys,
  parseWhysText,
  whysDepth,
  whysDocument,
  WHYS_MAX_DEPTH,
  WHYS_MAX_ITEMS,
  type CreateWhySessionInput,
  type WhyItemInput,
} from './whys.js';

const doc = {
  format: 'km-whys/1',
  summary: 'Why caches matter',
  conclusion: 'Memory is slower than the CPU',
  whys: [
    {
      question: 'Why is a cache faster?',
      answer: 'It is closer to the core',
      takeaway: 'Distance costs time',
      children: [{ question: 'Why does distance matter?', answer: '', takeaway: '', children: [] }],
    },
    { question: 'Why not make RAM faster?', answer: 'Cost', takeaway: '', children: [] },
  ],
};

describe('answeredWhyDepths', () => {
  interface T {
    answer: string;
    children: T[];
  }
  const why = (answer: string, children: T[] = []): T => ({ answer, children });

  it('lists the depth of answered whys only', () => {
    expect(answeredWhyDepths(doc.whys).sort((a, b) => a - b)).toEqual([1, 1]); // the deeper one is unanswered
    expect(answeredWhyDepths([])).toEqual([]);
  });

  it('keeps the depth of an answered why under an unanswered one', () => {
    const tree = [why('  ', [why('yes', [why('deeper')])])];
    expect(answeredWhyDepths(tree).sort((a, b) => a - b)).toEqual([2, 3]);
  });
});

describe('extractJson', () => {
  it('takes a ```json block out of a chat reply', () => {
    const reply = `Here is the summary:\n\n\`\`\`json\n${JSON.stringify(doc)}\n\`\`\`\n\nGood work!`;
    expect(JSON.parse(extractJson(reply) ?? '')).toEqual(doc);
  });

  it('skips code blocks that are not an object, and falls back to the outer braces', () => {
    expect(extractJson('```\nnot json\n```\n```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(extractJson('Sure! {"a": {"b": 1}} done')).toBe('{"a": {"b": 1}}');
    expect(extractJson('no json here')).toBeNull();
  });
});

describe('parseWhysText', () => {
  it('reads the km-whys/1 format into a session to save', () => {
    const res = parseWhysText(JSON.stringify(doc));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.summary).toBe('Why caches matter');
    expect(res.value.whys[0]?.children[0]?.question).toBe('Why does distance matter?');
    expect(flattenWhys(res.value.whys)).toHaveLength(3);
  });

  it('is lenient where AIs are sloppy: null or missing fields, extra keys, no format', () => {
    const res = parseWhysText(
      JSON.stringify({
        summary: null,
        whys: [{ question: ' Why? ', answer: null, children: null, level: 1, extra: 'x' }],
      }),
    );
    expect(res).toEqual({
      ok: true,
      value: {
        summary: '',
        conclusion: '',
        whys: [{ question: 'Why?', answer: '', takeaway: '', children: [] }],
      },
    });
  });

  it('says what went wrong', () => {
    expect(parseWhysText('hello')).toEqual({ ok: false, error: { kind: 'noJson' } });
    expect(parseWhysText('{"whys": [}')).toEqual({ ok: false, error: { kind: 'invalidJson' } });
    expect(parseWhysText('{"format":"other/2","whys":[]}')).toMatchObject({
      ok: false,
      error: { kind: 'badShape', path: 'format' },
    });
    expect(parseWhysText('{"whys":[]}')).toMatchObject({ error: { kind: 'badShape' } });
    expect(
      parseWhysText('{"whys":[{"question":"ok","children":[{"question":"  "}]}]}'),
    ).toMatchObject({ error: { kind: 'badShape', path: 'whys.0.children.0.question' } });
  });

  it('round-trips an export, ids included', () => {
    const id = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
    const text = whysDocument({
      summary: 's',
      conclusion: 'c',
      whys: [{ id, question: 'Why?', answer: 'a', takeaway: 't', children: [] }],
    });
    expect(parseWhysText(text)).toEqual({
      ok: true,
      value: {
        summary: 's',
        conclusion: 'c',
        whys: [{ id, question: 'Why?', answer: 'a', takeaway: 't', children: [] }],
      },
    });
  });
});

describe('session limits', () => {
  const chain = (n: number): WhyItemInput[] =>
    n === 0 ? [] : [{ question: `Why ${String(n)}?`, children: chain(n - 1) }];

  it('caps depth, size and duplicate ids', () => {
    expect(whysDepth(chain(3) as never)).toBe(3);
    expect(createWhySessionInputSchema.safeParse({ whys: chain(WHYS_MAX_DEPTH) }).success).toBe(
      true,
    );
    expect(createWhySessionInputSchema.safeParse({ whys: chain(WHYS_MAX_DEPTH + 1) }).success).toBe(
      false,
    );
    const many = Array.from({ length: WHYS_MAX_ITEMS + 1 }, () => ({ question: 'Why?' }));
    expect(createWhySessionInputSchema.safeParse({ whys: many }).success).toBe(false);
    const id = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
    expect(
      createWhySessionInputSchema.safeParse({
        whys: [
          { id, question: 'a' },
          { id, question: 'b' },
        ],
      }).success,
    ).toBe(false);
  });

  it('refuses a tree nested thousands deep without overflowing the stack', () => {
    let deep: unknown = [];
    for (let i = 0; i < 5000; i++) deep = [{ question: 'q', children: deep }];
    expect(createWhySessionInputSchema.safeParse({ whys: deep }).success).toBe(false);
    // Built by hand: JSON.stringify itself would overflow on it.
    const n = 5000;
    const text = `{"whys":${'[{"question":"q","children":'.repeat(n)}[]${'}]'.repeat(n)}}`;
    expect(parseWhysText(text)).toEqual({
      ok: false,
      error: { kind: 'badShape', path: 'whys' },
    });
  });

  it('prefers the last JSON block (the reply, not the prompt example in a pasted chat)', () => {
    expect(extractJson('```json\n{"a":1}\n```\nlater\n```json\n{"b":2}\n```')).toBe('{"b":2}');
  });

  it('keeps a typed API input (the size gate must not widen it to unknown)', () => {
    // @ts-expect-error: whys must be a list of whys
    const bad: CreateWhySessionInput = { whys: 42 };
    expect(createWhySessionInputSchema.safeParse(bad).success).toBe(false);
  });

  it('refuses unknown keys at the API boundary', () => {
    expect(
      createWhySessionInputSchema.safeParse({ whys: [{ question: 'a', level: 1 }] }).success,
    ).toBe(false);
  });
});
