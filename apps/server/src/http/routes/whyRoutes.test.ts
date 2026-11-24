import { flattenWhys, type ApiErrorBody, type GraphNode, type WhySession } from '@km/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../testing/testApp.js';

let t: TestApp;
let node: GraphNode;

beforeEach(async () => {
  t = await createTestApp();
  node = (await t.request<GraphNode>('POST', '/api/nodes', { title: 'Caches' })).body;
});
afterEach(async () => {
  await t.close();
});

const session = {
  summary: 'Why caches matter',
  conclusion: 'Memory is slower than the CPU',
  whys: [
    {
      question: 'Why is a cache faster?',
      answer: 'It is closer to the core',
      takeaway: 'Distance costs time',
      children: [{ question: 'Why does distance matter?' }],
    },
    { question: 'Why not make RAM faster?', answer: 'Cost' },
  ],
};

const create = (body: unknown = session, nodeId = node.id) =>
  t.request<WhySession & ApiErrorBody>('POST', `/api/nodes/${nodeId}/whys`, body);
const list = (nodeId = node.id) =>
  t.request<WhySession[] & ApiErrorBody>('GET', `/api/nodes/${nodeId}/whys`);

describe('5 Whys API', () => {
  it('creates a session with ids for every why, and lists it', async () => {
    const res = await create();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      nodeId: node.id,
      summary: 'Why caches matter',
      whys: [
        {
          question: 'Why is a cache faster?',
          takeaway: 'Distance costs time',
          children: [{ question: 'Why does distance matter?', answer: '', takeaway: '' }],
        },
        { question: 'Why not make RAM faster?', children: [] },
      ],
    });
    const ids = [res.body.whys[0]?.id, res.body.whys[0]?.children[0]?.id, res.body.whys[1]?.id];
    expect(new Set(ids).size).toBe(3);
    expect((await list()).body).toEqual([res.body]);
  });

  it('lists newest first and only for that node', async () => {
    const first = await create();
    t.tick();
    const second = await create({ whys: [{ question: 'Why again?' }] });
    const other = (await t.request<GraphNode>('POST', '/api/nodes', { title: 'Other' })).body;
    await create(undefined, other.id);
    expect((await list()).body.map((s) => s.id)).toEqual([second.body.id, first.body.id]);
  });

  it('gives new ids on create, even when the pasted JSON had some', async () => {
    const a = (await create()).body;
    const b = (await create({ whys: a.whys })).body;
    expect(b.whys[0]?.id).not.toBe(a.whys[0]?.id);
  });

  it('edits fields and replaces the tree, keeping the ids it is sent', async () => {
    const created = (await create()).body;
    t.tick(5);
    const first = created.whys[0];
    if (!first) throw new Error('no why');
    const res = await t.request<WhySession>('PATCH', `/api/whys/${created.id}`, {
      conclusion: 'Latency, not bandwidth',
      whys: [{ ...first, answer: 'Shorter wires', children: [{ question: 'New deeper why?' }] }],
    });
    expect(res.status).toBe(200);
    expect(res.body.summary).toBe('Why caches matter'); // left as is
    expect(res.body.conclusion).toBe('Latency, not bandwidth');
    expect(res.body.whys).toHaveLength(1);
    expect(res.body.whys[0]).toMatchObject({ id: first.id, answer: 'Shorter wires' });
    expect(res.body.whys[0]?.children[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.updatedAt).toBeGreaterThan(created.updatedAt);
    expect((await list()).body[0]).toEqual(res.body);
  });

  it('does not let a session take over the why ids of another one', async () => {
    const a = (await create()).body;
    const b = (await create({ whys: [{ question: 'Why B?' }] })).body;
    // B edited with A's JSON pasted in (Copy JSON → Edit JSON → Apply → Save).
    const res = await t.request<WhySession>('PATCH', `/api/whys/${b.id}`, { whys: a.whys });
    expect(res.status).toBe(200);
    const aIds = new Set(flattenWhys(a.whys).map((w) => w.id));
    const bIds = flattenWhys(res.body.whys).map((w) => w.id);
    expect(bIds).toHaveLength(3);
    expect(bIds.filter((id) => aIds.has(id))).toEqual([]);
  });

  it('400s (not 500s) on a tree nested thousands deep', async () => {
    // Built by hand: JSON.stringify itself would overflow on it.
    const n = 5000;
    const payload = `{"whys":${'[{"question":"q","children":'.repeat(n)}[]${'}]'.repeat(n)}}`;
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/nodes/${node.id}/whys`,
      headers: { 'content-type': 'application/json' },
      payload,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<ApiErrorBody>().error.code).toBe('VALIDATION_ERROR');
  });

  it('does not bump updatedAt for a patch that changes nothing', async () => {
    const created = (await create()).body;
    t.tick(5);
    const res = await t.request<WhySession>('PATCH', `/api/whys/${created.id}`, {
      summary: created.summary,
    });
    expect(res.body.updatedAt).toBe(created.updatedAt);
  });

  it('deletes a session (tombstone), then 404s', async () => {
    const created = (await create()).body;
    expect((await t.request('DELETE', `/api/whys/${created.id}`)).status).toBe(204);
    expect((await list()).body).toEqual([]);
    expect((await t.request('DELETE', `/api/whys/${created.id}`)).status).toBe(404);
    expect((await t.request('PATCH', `/api/whys/${created.id}`, { summary: 'x' })).status).toBe(
      404,
    );
  });

  it('goes away with its node', async () => {
    const created = (await create()).body;
    expect((await t.request('DELETE', `/api/nodes/${node.id}`)).status).toBe(204);
    expect((await list()).status).toBe(404);
    expect((await t.request('PATCH', `/api/whys/${created.id}`, { summary: 'x' })).status).toBe(
      404,
    );
  });

  it('404s for an unknown node', async () => {
    const missing = '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b';
    expect((await list(missing)).status).toBe(404);
    expect((await create(session, missing)).status).toBe(404);
  });

  it('validates at the boundary', async () => {
    const bad = [
      {},
      { whys: [] },
      { whys: [{ question: '   ' }] },
      { whys: [{ question: 'ok', extra: 1 }] },
      { whys: [{ question: 'ok' }], format: 'km-whys/1' },
      { whys: [{ question: 'x'.repeat(2001) }] },
    ];
    for (const body of bad) {
      const res = await create(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    const created = (await create()).body;
    const empty = await t.request<ApiErrorBody>('PATCH', `/api/whys/${created.id}`, { whys: [] });
    expect(empty.status).toBe(400);
  });
});
