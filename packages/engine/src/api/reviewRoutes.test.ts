import type { GraphNode, ReviewToday } from '@km/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canonicalSnapshotJson, readSnapshot } from '../repositories/snapshotRepository.js';
import { createTestApp, type TestApp } from '../testing/testApp.js';

const DAY = 86_400_000;
let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.close();
});

const node = async (title: string, content = '') =>
  (await t.request<GraphNode>('POST', '/api/nodes', { title, content })).body;
const q = (question: string, answer: string, children: unknown[] = []) => ({
  question,
  answer,
  children,
});
/** 3 answered whys, 3 levels deep: well-dug. */
const digDeep = (id: string) =>
  t.request('POST', `/api/nodes/${id}/whys`, {
    whys: [q('a', 'yes', [q('b', 'yes', [q('c', 'yes')])])],
  });
const today = async (query = '') =>
  (await t.request<ReviewToday>('GET', `/api/review${query}`)).body;
const answer = (body: unknown) => t.request('POST', '/api/review/answer', body);
const digTitles = (r: ReviewToday) =>
  r.cards.filter((c) => c.kind === 'dig').map((c) => c.node.title);

describe('GET /api/review: dig deeper', () => {
  it('offers shallow nodes, lowest EXP first, up to the limit', async () => {
    await node('Long', 'word '.repeat(400)); // 10 + 20 for its words
    await node('Short');
    const deep = await node('Deep');
    await digDeep(deep.id);
    // Two answered whys, three deep: still shallow (needs both). 10 + 10 + 20 EXP.
    const half = await node('Half');
    await t.request('POST', `/api/nodes/${half.id}/whys`, {
      whys: [q('a', '', [q('b', 'yes', [q('c', 'yes')])])],
    });

    const r = await today();
    expect(digTitles(r)).toEqual(['Short', 'Long', 'Half']);
    const card = r.cards.find((c) => c.node.title === 'Half');
    expect(card?.node).toMatchObject({ answeredWhys: 2, maxDepth: 3 });

    expect(digTitles(await today('?dig=1'))).toEqual(['Short']);
    expect((await today('?dig=1')).more.dig).toBe(2);
  });

  it('Done climbs the ladder (1, 3, 7… days), Again starts over', async () => {
    const n = await node('N');
    expect((await answer({ kind: 'dig', nodeId: n.id, result: 'done' })).status).toBeLessThan(300);
    expect(digTitles(await today())).toEqual([]); // due tomorrow

    t.tick(DAY);
    const back = (await today()).cards[0];
    expect(back).toMatchObject({ kind: 'dig', step: 1 });
    await answer({ kind: 'dig', nodeId: n.id, result: 'done' }); // step 1 → 3 days
    t.tick(2 * DAY);
    expect(digTitles(await today())).toEqual([]);
    t.tick(DAY);
    expect((await today()).cards[0]).toMatchObject({ step: 2 });

    await answer({ kind: 'dig', nodeId: n.id, result: 'again' });
    t.tick(DAY);
    expect((await today()).cards[0]).toMatchObject({ step: 0 });
  });

  it('drops a node once it is well-dug, or deleted', async () => {
    const a = await node('A');
    const b = await node('B');
    await digDeep(a.id);
    await t.request('DELETE', `/api/nodes/${b.id}`);
    expect(digTitles(await today())).toEqual([]);
  });
});

describe('GET /api/review: link suggestions', () => {
  it('pairs well-dug nodes that are not linked, the same pairs all day', async () => {
    const ids: string[] = [];
    for (const title of ['P', 'Q', 'R']) {
      const n = await node(title);
      await digDeep(n.id);
      ids.push(n.id);
    }
    const [p = '', qq = '', r = ''] = ids;
    await t.request('POST', '/api/edges', { fromId: p, toId: qq, name: 'REL' });

    const first = await today('?link=5');
    const pairs = first.cards.flatMap((c) =>
      c.kind === 'link' ? [[c.node.title, c.other.title].sort().join('-')] : [],
    );
    expect(pairs.sort()).toEqual(['P-R', 'Q-R']); // P-Q are linked
    expect(await today('?link=5')).toEqual(first); // stable on refetch

    // Answered pairs wait for their day; linking one removes it.
    await answer({ kind: 'link', nodeId: r, otherNodeId: p, result: 'done' });
    await t.request('POST', '/api/edges', { fromId: r, toId: qq, name: 'REL' });
    expect((await today('?link=5')).cards.filter((c) => c.kind === 'link')).toEqual([]);
    t.tick(DAY);
    const again = (await today('?link=5')).cards.filter((c) => c.kind === 'link');
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ step: 1 });
  });
});

describe('link suggestions are varied', () => {
  it("today's cards don't all share one node when there are enough to pick from", async () => {
    for (let i = 0; i < 8; i++) await digDeep((await node(`D${String(i)}`)).id);
    const links = (await today('?link=3')).cards.flatMap((c) =>
      c.kind === 'link' ? [[c.node.id, c.other.id]] : [],
    );
    expect(links).toHaveLength(3);
    const ids = links.flat();
    expect(new Set(ids).size).toBe(ids.length); // pairwise disjoint
    // New pairs are suggestions, not a backlog: nothing "more waiting" for links.
    expect((await today('?link=3')).more.link).toBe(0);
  });

  it('still finds the one unlinked pair in a densely linked graph', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 12; i++) {
      const n = await node(`L${String(i)}`);
      await digDeep(n.id);
      ids.push(n.id);
    }
    // Link every pair but the last two.
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (i === ids.length - 2 && j === ids.length - 1) continue;
        await t.request('POST', '/api/edges', { fromId: ids[i], toId: ids[j], name: 'REL' });
      }
    }
    const links = (await today('?link=2')).cards.filter((c) => c.kind === 'link');
    expect(links).toHaveLength(1);
  });
});

describe('review cards and deletes', () => {
  it("a node's cards are tombstoned with it", async () => {
    const a = await node('A');
    const b = await node('B');
    await answer({ kind: 'dig', nodeId: a.id, result: 'done' });
    await answer({ kind: 'link', nodeId: a.id, otherNodeId: b.id, result: 'again' });
    await t.request('DELETE', `/api/nodes/${a.id}`);
    expect(
      t.db.prepare('SELECT COUNT(*) AS n FROM review_cards WHERE deleted_at IS NULL').get(),
    ).toEqual({ n: 0 });
  });

  it('a link pair stored the wrong way round is refused by the database', async () => {
    const [x, y] = [(await node('X')).id, (await node('Y')).id].sort();
    expect(() =>
      t.db
        .prepare(
          `INSERT INTO review_cards (id, kind, node_id, other_node_id, step, due_at, created_at, updated_at)
           VALUES ('r', 'link', ?, ?, 0, 0, 0, 0)`,
        )
        .run(y ?? '', x ?? ''),
    ).toThrow(/smaller id first/);
  });
});

describe('POST /api/review/answer', () => {
  it('validates the card', async () => {
    const a = await node('A');
    const b = await node('B');
    expect((await answer({ kind: 'link', nodeId: a.id, result: 'done' })).status).toBe(400);
    expect(
      (await answer({ kind: 'dig', nodeId: a.id, otherNodeId: b.id, result: 'done' })).status,
    ).toBe(400);
    expect(
      (await answer({ kind: 'link', nodeId: a.id, otherNodeId: a.id, result: 'done' })).status,
    ).toBe(400);
    expect((await answer({ kind: 'dig', nodeId: a.id, result: 'maybe' })).status).toBe(400);
    expect(
      (await answer({ kind: 'dig', nodeId: crypto.randomUUID(), result: 'done' })).status,
    ).toBe(404);
  });

  it('is refused on a read-only device', async () => {
    const ro = await createTestApp({ readOnly: true });
    const res = await ro.request('POST', '/api/review/answer', {
      kind: 'dig',
      nodeId: crypto.randomUUID(),
      result: 'done',
    });
    expect(res.status).toBe(403);
    await ro.close();
  });
});

describe('review cards in snapshots', () => {
  it('are left out while there are none, so older versions keep their hash', async () => {
    const n = await node('N');
    const before = canonicalSnapshotJson(readSnapshot(t.db));
    expect(before).not.toContain('review_cards');
    await answer({ kind: 'dig', nodeId: n.id, result: 'done' });
    const after = canonicalSnapshotJson(readSnapshot(t.db));
    expect(after).toContain('"review_cards":[{');
  });
});
