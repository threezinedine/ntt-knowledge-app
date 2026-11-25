import { describe, expect, it } from 'vitest';
import {
  createWikilinkResolver,
  linkMentions,
  parseWikilinks,
  renameWikilinks,
  wikilinkPairs,
  wikilinkSyncInputSchema,
} from './wikilinks.js';

describe('parseWikilinks', () => {
  it('reads targets and labels', () => {
    expect(parseWikilinks('See [[Redis]] and [[ Kafka | the log ]].')).toEqual([
      { start: 4, end: 13, target: 'Redis', label: null },
      { start: 18, end: 39, target: 'Kafka', label: 'the log' },
    ]);
    expect(parseWikilinks('[[]] [[a\nb]] [single]')).toEqual([]);
  });
});

describe('createWikilinkResolver', () => {
  it('prefers the exact title, then any case, then the oldest node', () => {
    const resolve = createWikilinkResolver([
      { id: '02', title: 'Redis' },
      { id: '01', title: 'redis' },
      { id: '03', title: 'Kafka' },
      { id: '00', title: 'Kafka' },
    ]);
    expect(resolve('Redis')).toBe('02');
    expect(resolve('redis')).toBe('01');
    expect(resolve('REDIS')).toBe('01'); // any case: the oldest of both
    expect(resolve(' Kafka ')).toBe('00');
    expect(resolve('Nope')).toBeNull();
  });
});

describe('linkMentions', () => {
  it('links whole-word mentions, any case, keeping the text as written', () => {
    expect(linkMentions('Redis is fast; I like redis.', ['Redis'])).toBe(
      '[[Redis]] is fast; I like [[Redis|redis]].',
    );
    expect(linkMentions('Redistribute, PreRedis', ['Redis'])).toBe('Redistribute, PreRedis');
  });

  it('works with Vietnamese letters', () => {
    expect(linkMentions('Học máy là gì? học máy!', ['Học máy'])).toBe(
      '[[Học máy]] là gì? [[Học máy|học máy]]!',
    );
    // "máy" inside a longer word is not a mention.
    expect(linkMentions('máyvi', ['máy'])).toBe('máyvi');
  });

  it('takes the longest title where two overlap', () => {
    expect(linkMentions('Redis cluster setup', ['Redis', 'Redis cluster'])).toBe(
      '[[Redis cluster]] setup',
    );
  });

  it('leaves code, links and URLs alone', () => {
    const text = [
      'Use `Redis` here, [Redis](https://redis.io), <https://x.io/Redis>,',
      'https://example.com/Redis, [[Redis]] and ![Redis](r.png).',
      '```',
      'Redis in a fence',
      '```',
      'Redis outside.',
    ].join('\n');
    expect(linkMentions(text, ['Redis'])).toBe(text.replace('Redis outside', '[[Redis]] outside'));
  });

  it('skips titles too short or with brackets, and does nothing without titles', () => {
    expect(linkMentions('Go and AI', ['Go', 'AI'])).toBe('Go and AI');
    expect(linkMentions('a [b] c', ['[b]'])).toBe('a [b] c');
    expect(linkMentions('text', [])).toBe('text');
  });
});

describe('linkMentions on tricky markdown', () => {
  const titles = ['Redis', 'Redis Cluster', 'Tiếng'];
  const unchanged = [
    'See [Redis][1].\n\n[1]: https://redis.io',
    '[redis]: https://redis.io',
    '    redis-cli ping Redis',
    'www.redis.io and me@redis.io',
    'https://en.wikipedia.org/wiki/(x)/redis',
    '<!-- Redis --> <span title="Redis">x</span>',
    '| db | x |\n|---|---|\n| redis | 1 |',
    'redis-cli and redis.conf',
    // NFD: "Tiếng" as base letters plus combining accents, inside a longer word.
    'Tiếngs',
  ];
  it.each(unchanged)('leaves %j alone', (text) => {
    expect(linkMentions(text, titles)).toBe(text);
  });

  it('does not cut a decomposed (NFD) Vietnamese word before its accents', () => {
    const tieng = `Tie${String.fromCodePoint(0x302, 0x301)}ng Vie${String.fromCodePoint(0x323, 0x302)}t`;
    expect(linkMentions(tieng, ['Tie'])).toBe(tieng);
  });

  it('never links across a line break', () => {
    expect(linkMentions('Notes on Redis\nCluster here', titles)).toBe(
      'Notes on [[Redis]]\nCluster here',
    );
  });

  it('in a table, links only what needs no label', () => {
    expect(linkMentions('| Redis | redis |', ['Redis'])).toBe('| [[Redis]] | redis |');
    const noLeadingPipe = 'db | x\n---|---\nredis | 1';
    expect(linkMentions(noLeadingPipe, ['Redis'])).toBe(noLeadingPipe);
    // A pipe inside code or an existing link doesn't count.
    expect(linkMentions('`a|b` redis', ['Redis'])).toBe('`a|b` [[Redis|redis]]');
  });

  it('a shorter title still matches next to a protected part', () => {
    expect(linkMentions('`Redis` Cluster', ['Redis Cluster', 'Cluster'])).toBe(
      '`Redis` [[Cluster]]',
    );
  });

  it('matches titles with runs of spaces', () => {
    expect(linkMentions('about Foo  Bar', ['Foo  Bar'])).toBe('about [[Foo  Bar]]');
  });

  const samples = [
    'Redis and redis, Redis Cluster\nredis cluster',
    '| redis | Redis |',
    'Tiếng Việt, tiếng việt',
    'x [[Redis|redis]] y redis',
    'Notes on Redis\nCluster here',
  ];
  it.each(samples)('is idempotent on %j', (text) => {
    const once = linkMentions(text, titles);
    expect(linkMentions(once, titles)).toBe(once);
  });
});

describe('renameWikilinks', () => {
  it('rewrites links to the old title, keeping labels', () => {
    expect(renameWikilinks('[[Redis]], [[redis|the cache]], [[Kafka]]', 'Redis', 'Valkey')).toBe(
      '[[Valkey]], [[Valkey|the cache]], [[Kafka]]',
    );
  });

  it('leaves code and plain text alone', () => {
    const text = 'Redis, `[[Redis]]`';
    expect(renameWikilinks(text, 'Redis', 'Valkey')).toBe(text);
  });

  it('refuses a new title that cannot sit in a link', () => {
    expect(renameWikilinks('[[Redis]]', 'Redis', 'a|b')).toBe('[[Redis]]');
  });
});

describe('wikilinkPairs', () => {
  it('resolves links to node pairs, once each, not to itself, not inside code', () => {
    const nodes = [
      { id: '01', title: 'Redis', content: 'See [[Kafka]], [[kafka|again]], [[Redis]], [[Nope]].' },
      { id: '02', title: 'Kafka', content: '`[[Redis]]` in code; [[Redis|the cache]] for real.' },
      { id: '03', title: 'Plain', content: 'no links' },
    ];
    expect(wikilinkPairs(nodes)).toEqual([
      { fromId: '01', toId: '02' },
      { fromId: '02', toId: '01' },
    ]);
  });
});

describe('wikilinkSyncInputSchema', () => {
  it('takes whether the node was just created, nothing else', () => {
    expect(wikilinkSyncInputSchema.safeParse({ created: true }).success).toBe(true);
    expect(wikilinkSyncInputSchema.safeParse({ created: false }).success).toBe(true);
    expect(wikilinkSyncInputSchema.safeParse({}).success).toBe(false);
    expect(wikilinkSyncInputSchema.safeParse({ created: true, x: 1 }).success).toBe(false);
  });
});
