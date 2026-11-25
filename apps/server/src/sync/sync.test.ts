import {
  snapshotSchema,
  type ApiErrorBody,
  type GraphNode,
  type HubVersion,
  type ReviewToday,
  type Snapshot,
  type SyncStatus,
} from '@km/core';
import {
  canonicalSnapshotJson,
  readSnapshot,
  replaceWithSnapshot,
  snapshotHash,
  type FetchLike,
} from '@km/engine';
import { createTestApp as createDevice, type TestApp as Device } from '@km/engine/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { base32Decode, hotp, stepAt } from '../auth/totp.js';
import { seedFirstVersion } from '../seed.js';
import { createTestApp, injectFetch, type TestApp as Hub } from '../testing/testApp.js';

// Devices (a web app's or the phone's own copy, run by the engine) sync with
// the one server, the hub.

const HUB_URL = 'http://hub.test:4317';
const SECRET = base32Decode('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP');

let hub: Hub;
let a: Device;
let b: Device;
let fetch: FetchLike;

beforeEach(async () => {
  hub = await createTestApp({ hub: { keepVersions: 3 } });
  fetch = injectFetch(() => hub.app);
  a = await createDevice({ fetch });
  b = await createDevice({ fetch });
});
afterEach(async () => {
  await Promise.all([hub.close(), a.close(), b.close()]);
});

const connect = (t: Device, deviceName: string) =>
  t.request<SyncStatus>('POST', '/api/sync/connect', { hubUrl: HUB_URL, code: '', deviceName });
const status = async (t: Device) => (await t.request<SyncStatus>('GET', '/api/sync/status')).body;
const push = (t: Device, force = false) =>
  t.request<SyncStatus & ApiErrorBody>('POST', '/api/sync/push', { force });
const pull = (t: Device, force = false) =>
  t.request<SyncStatus & ApiErrorBody>('POST', '/api/sync/pull', { force });
const createNode = async (t: Device, title: string, content = '') =>
  (await t.request<GraphNode>('POST', '/api/nodes', { title, content })).body;
const titles = async (t: Device) =>
  (await t.request<GraphNode[]>('GET', '/api/nodes')).body.map((n) => n.title).sort();
const connected = (s: SyncStatus) => {
  if (!s.connected) throw new Error('not connected');
  return s;
};

describe('snapshots', () => {
  it('hash the same data the same way, whatever order the rows come in', async () => {
    await createNode(a, 'One');
    await createNode(a, 'Two');
    const snap = readSnapshot(a.db);
    const reversed: Snapshot = {
      ...snap,
      tables: { ...snap.tables, nodes: [...snap.tables.nodes].reverse() },
    };
    expect(canonicalSnapshotJson(reversed)).toBe(canonicalSnapshotJson(snap));
  });

  it('load into another database as they were, word counts included', async () => {
    const node = await createNode(a, 'Rust', 'one two three');
    const tag = (await a.request<{ id: string }>('POST', '/api/tags', { name: 'Lang' })).body;
    await a.request('PUT', `/api/nodes/${node.id}/tags/${tag.id}`);
    replaceWithSnapshot(b.db, readSnapshot(a.db));
    expect((await b.request<GraphNode>('GET', `/api/nodes/${node.id}`)).body).toEqual(
      (await a.request<GraphNode>('GET', `/api/nodes/${node.id}`)).body,
    );
    expect(b.db.prepare('SELECT content_words FROM nodes').get()).toEqual({ content_words: 3 });
    const hashOf = (t: Device) => snapshotHash(canonicalSnapshotJson(readSnapshot(t.db)));
    expect(hashOf(b)).toBe(hashOf(a));
  });
});

describe('sync through a hub', () => {
  it('starts disconnected, with a suggested device name', async () => {
    const s = await status(a);
    expect(s.connected).toBe(false);
    expect(!s.connected && s.suggestedName.length).toBeGreaterThan(0);
  });

  it('pushes one device and pulls it into another', async () => {
    await createNode(a, 'From A');
    expect(connected((await connect(a, 'PC A')).body)).toMatchObject({
      localChanged: true,
      synced: null,
      hub: null,
      problem: null,
    });
    const pushed = await push(a);
    expect(pushed.status).toBe(200);
    expect(connected(pushed.body)).toMatchObject({ localChanged: false });
    expect(connected(pushed.body).synced).toMatchObject({ version: 1, deviceName: 'PC A' });

    await connect(b, 'PC B');
    const behind = connected(await status(b));
    expect(behind).toMatchObject({ localChanged: false, synced: null });
    expect(behind.hub?.version).toBe(1);

    expect((await pull(b)).status).toBe(200);
    expect(await titles(b)).toEqual(['From A']);
    expect(connected(await status(b))).toMatchObject({ localChanged: false });
    expect(connected(await status(b)).synced?.version).toBe(1);
  });

  it('refuses to push over a version this device has not pulled, unless forced', async () => {
    await connect(a, 'PC A');
    await connect(b, 'PC B');
    await createNode(a, 'A1');
    await push(a); // v1
    await pull(b);
    await createNode(b, 'B1');
    await push(b); // v2
    await createNode(a, 'A2'); // A edits on top of v1: both sides changed

    const s = connected(await status(a));
    expect(s.localChanged).toBe(true);
    expect(s.hub?.version).toBe(2);

    const refused = await push(a);
    expect(refused.status).toBe(409);
    expect(refused.body.error.reason).toBe('SYNC_BEHIND');

    expect((await push(a, true)).status).toBe(200); // v3: A's data wins
    await pull(b, true);
    expect(await titles(b)).toEqual(['A1', 'A2']);
  });

  it('refuses to pull over changes the hub does not have, unless forced', async () => {
    await connect(a, 'PC A');
    await connect(b, 'PC B');
    await createNode(a, 'A1');
    await push(a);
    await createNode(b, 'Only on B');

    const refused = await pull(b);
    expect(refused.status).toBe(409);
    expect(refused.body.error.reason).toBe('SYNC_LOCAL_CHANGES');
    expect(await titles(b)).toEqual(['Only on B']);

    expect((await pull(b, true)).status).toBe(200);
    expect(await titles(b)).toEqual(['A1']);
  });

  it('pushing unchanged data adds no version', async () => {
    await connect(a, 'PC A');
    await createNode(a, 'Same');
    await push(a);
    await push(a);
    expect(connected(await status(a)).hub?.version).toBe(1);
  });

  it('keeps only the newest versions', async () => {
    await connect(a, 'PC A');
    for (const title of ['1', '2', '3', '4', '5']) {
      await createNode(a, title);
      await push(a);
    }
    const versions = hub.db.prepare('SELECT version FROM hub_versions ORDER BY version').all();
    expect(versions).toEqual([{ version: 3 }, { version: 4 }, { version: 5 }]);
  });

  it('reports an unreachable hub without failing', async () => {
    await connect(a, 'PC A');
    a.db.prepare("UPDATE sync_state SET hub_url = 'http://unreachable:1'").run();
    expect(connected(await status(a))).toMatchObject({ problem: 'HUB_UNREACHABLE', hub: null });
    const res = await push(a);
    expect(res.status).toBe(502);
    expect(res.body.error.reason).toBe('HUB_UNREACHABLE');
  });

  it('something that is not a hub says so', async () => {
    const c = await createDevice({
      fetch: () => Promise.resolve(new Response('<html>nope</html>', { status: 404 })),
    });
    const res = await c.request<ApiErrorBody>('POST', '/api/sync/connect', {
      hubUrl: HUB_URL,
      code: '',
      deviceName: 'X',
    });
    expect(res.status).toBe(502);
    expect(res.body.error.reason).toBe('HUB_NOT_ENABLED');
    await c.close();
  });

  it('push and pull need a connection', async () => {
    const res = await push(a);
    expect(res.status).toBe(409);
    expect(res.body.error.reason).toBe('SYNC_NOT_CONNECTED');
  });

  it('disconnecting forgets the hub', async () => {
    await connect(a, 'PC A');
    expect((await a.request('DELETE', '/api/sync')).status).toBe(204);
    expect((await status(a)).connected).toBe(false);
  });

  it('validates the hub address', async () => {
    const res = await a.request('POST', '/api/sync/connect', {
      hubUrl: 'ftp://x',
      code: '',
      deviceName: 'X',
    });
    expect(res.status).toBe(400);
  });
});

describe('the hub', () => {
  const pair = (t: Device, code = '', readOnly = false) =>
    t.request<{ token: string } & ApiErrorBody>('POST', '/api/hub/pair', {
      code,
      name: 'Phone',
      readOnly,
    });
  const asDevice = (token: string) => ({ authorization: `Bearer ${token}` });

  it('needs a device token for everything but pairing', async () => {
    const res = await hub.app.inject({ method: 'GET', url: '/api/hub/head' });
    expect(res.statusCode).toBe(401);
    expect(res.json<ApiErrorBody>().error.reason).toBe('HUB_DENIED');
    const bad = await hub.app.inject({
      method: 'GET',
      url: '/api/hub/head',
      headers: asDevice('x'),
    });
    expect(bad.statusCode).toBe(401);
  });

  it('pairs only with the authenticator code when sign-in is on', async () => {
    const guarded = await createTestApp({
      hub: { keepVersions: 10 },
      auth: { totpSecret: SECRET },
    });
    expect((await pair(guarded, '000000')).status).toBe(401);
    const code = hotp(SECRET, stepAt(1_700_000_000_000));
    const ok = await pair(guarded, code);
    expect(ok.status).toBe(201);
    // The token works without any session cookie.
    const head = await guarded.app.inject({
      method: 'GET',
      url: '/api/hub/head',
      headers: asDevice(ok.body.token),
    });
    expect(head.json()).toEqual({ head: null });
    await guarded.close();
  });

  it('a read-only device may pull but not push', async () => {
    const { token } = (await pair(hub, '', true)).body;
    const res = await hub.app.inject({
      method: 'POST',
      url: '/api/hub/versions',
      headers: asDevice(token),
      payload: { baseVersion: null, snapshot: readSnapshot(a.db) },
    });
    expect(res.statusCode).toBe(403);
  });

  it('refuses a card that points at a missing node', async () => {
    const { token } = (await pair(hub)).body;
    const snapshot = readSnapshot(a.db);
    snapshot.tables.review_cards.push({
      id: 'card',
      kind: 'dig',
      node_id: 'missing',
      other_node_id: null,
      step: 1,
      due_at: 0,
      created_at: 0,
      updated_at: 0,
      deleted_at: null,
    });
    const res = await hub.app.inject({
      method: 'POST',
      url: '/api/hub/versions',
      headers: asDevice(token),
      payload: { baseVersion: null, snapshot },
    });
    expect(res.statusCode).toBe(400);
  });

  it('refuses a snapshot that would not load', async () => {
    const { token } = (await pair(hub)).body;
    const snapshot = readSnapshot(a.db);
    snapshot.tables.node_layouts.push({ node_id: 'missing', pos_x: 1, pos_y: 2, updated_at: 1 });
    const res = await hub.app.inject({
      method: 'POST',
      url: '/api/hub/versions',
      headers: asDevice(token),
      payload: { baseVersion: null, snapshot },
    });
    expect(res.statusCode).toBe(400);
    expect(hub.db.prepare('SELECT COUNT(*) AS n FROM hub_versions').get()).toEqual({ n: 0 });
  });

  it('gzips what it sends when asked to', async () => {
    await connect(a, 'PC A');
    await createNode(a, 'Zip');
    await push(a);
    const { token } = (await pair(hub)).body;
    const res = await hub.app.inject({
      method: 'GET',
      url: '/api/hub/latest',
      headers: { ...asDevice(token), 'accept-encoding': 'gzip' },
    });
    expect(res.headers['content-encoding']).toBe('gzip');
    const head = (await status(a)) as { hub: HubVersion };
    expect(head.hub.version).toBe(1);
  });
});

describe('review cards through the hub', () => {
  const answer = (t: Device, nodeId: string) =>
    t.request('POST', '/api/review/answer', { kind: 'dig', nodeId, result: 'done' });

  it('a push with cards hashes the same on the hub, and a pull restores them', async () => {
    await connect(a, 'PC A');
    await connect(b, 'PC B');
    const n = await createNode(a, 'Shallow');
    await answer(a, n.id);
    expect((await push(a)).status).toBe(200);
    const after = connected(await status(a));
    expect(after.localChanged).toBe(false); // the hub's hash is the device's own
    expect(after.hub?.hash).toBe(snapshotHash(canonicalSnapshotJson(readSnapshot(a.db))));

    expect((await pull(b)).status).toBe(200);
    expect(b.db.prepare('SELECT COUNT(*) AS n FROM review_cards').get()).toEqual({ n: 1 });
    // Done today: not due on the other device either.
    const today = (await b.request<ReviewToday>('GET', '/api/review')).body;
    expect(today.cards).toEqual([]);
    expect(connected(await status(b)).localChanged).toBe(false);
  });

  it('a snapshot from before review cards (no such key) reads and hashes as it was', async () => {
    await createNode(a, 'Old');
    const json = canonicalSnapshotJson(readSnapshot(a.db));
    expect(json).not.toContain('review_cards'); // what every older version looks like
    const parsed = snapshotSchema.parse(JSON.parse(json));
    expect(parsed.tables.review_cards).toEqual([]);
    expect(canonicalSnapshotJson(parsed)).toBe(json);
  });
});

describe('sync review fixes', () => {
  it('a pull refuses an edit that lands while the hub is answering', async () => {
    let pause: (() => Promise<void>) | null = null;
    const inner = injectFetch(() => hub.app);
    const c = await createDevice({
      fetch: async (url, init) => {
        if (url.endsWith('/api/hub/latest') && pause) await pause();
        return inner(url, init);
      },
    });
    await connect(a, 'PC A');
    await createNode(a, 'From A');
    await push(a);
    await connect(c, 'PC C');
    await pull(c);
    await createNode(a, 'Newer');
    await push(a);

    pause = async () => {
      await createNode(c, 'Typed meanwhile');
    };
    const res = await pull(c);
    expect(res.status).toBe(409);
    expect(res.body.error.reason).toBe('SYNC_LOCAL_CHANGES');
    expect(await titles(c)).toEqual(['From A', 'Typed meanwhile']);
    await c.close();
  });

  it('data that is exactly the hub’s newest version counts as synced', async () => {
    await connect(a, 'PC A');
    await createNode(a, 'Same');
    await push(a);
    replaceWithSnapshot(b.db, readSnapshot(a.db)); // e.g. restored from a backup
    const s = connected((await connect(b, 'PC B')).body);
    expect(s).toMatchObject({ localChanged: false });
    expect(s.synced?.version).toBe(1);
  });

  it('disconnecting and reconnecting leave no old token working', async () => {
    await connect(a, 'PC A');
    const first = a.db.prepare('SELECT token FROM sync_state').get() as { token: string };
    await connect(a, 'PC A again');
    const second = a.db.prepare('SELECT token FROM sync_state').get() as { token: string };
    const head = (token: string) =>
      hub.app.inject({
        method: 'GET',
        url: '/api/hub/head',
        headers: { authorization: `Bearer ${token}` },
      });
    expect((await head(first.token)).statusCode).toBe(401);
    expect((await head(second.token)).statusCode).toBe(200);
    await a.request('DELETE', '/api/sync');
    expect((await head(second.token)).statusCode).toBe(401);
  });

  it('a hub error without a reason is a state, not a failed status', async () => {
    const broken = await createDevice({
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { code: 'INTERNAL_ERROR', message: 'x' } }), {
            status: 500,
          }),
        ),
    });
    broken.db
      .prepare(
        "INSERT INTO sync_state (id, hub_url, device_name, token, updated_at) VALUES (1, 'http://h', 'X', 't', 1)",
      )
      .run();
    const res = await broken.request<SyncStatus>('GET', '/api/sync/status');
    expect(res.status).toBe(200);
    expect(connected(res.body).problem).toBe('HUB_ERROR');
    await broken.close();
  });

  it('refuses a pull in a format this version can’t read', async () => {
    await connect(a, 'PC A');
    await createNode(a, 'X');
    await push(a);
    hub.db.prepare("UPDATE hub_versions SET format = 'km-snapshot/99'").run();
    const raw = hub.db.prepare('SELECT snapshot FROM hub_versions').get() as {
      snapshot: Uint8Array;
    };
    const { gunzipSync, gzipSync } = await import('node:zlib');
    const json = gunzipSync(raw.snapshot).toString().replace('km-snapshot/1', 'km-snapshot/99');
    hub.db.prepare('UPDATE hub_versions SET snapshot = ?').run(gzipSync(json));
    await connect(b, 'PC B');
    const res = await pull(b);
    expect(res.status).toBe(502);
    expect(res.body.error.reason).toBe('HUB_INCOMPATIBLE');
  });

  it('a push based on a version number the hub reused for other data is refused', async () => {
    await connect(a, 'PC A');
    await createNode(a, 'X');
    await push(a);
    hub.db.prepare("UPDATE hub_versions SET hash = 'other'").run(); // a restored hub
    await createNode(a, 'Y');
    const res = await push(a);
    expect(res.status).toBe(409);
    expect(res.body.error.reason).toBe('SYNC_BEHIND');
  });

  it('an empty pairing code doesn’t spend the owner’s wrong-code budget', async () => {
    const guarded = await createTestApp({
      hub: { keepVersions: 10 },
      auth: { totpSecret: SECRET },
    });
    for (let i = 0; i < 12; i++) {
      const res = await guarded.request('POST', '/api/hub/pair', { code: '', name: 'X' });
      expect(res.status).toBe(401);
    }
    const ok = await guarded.request('POST', '/api/hub/pair', {
      code: hotp(SECRET, stepAt(1_700_000_000_000)),
      name: 'X',
    });
    expect(ok.status).toBe(201);
    await guarded.close();
  });

  it('a pull-only device (the phone) pulls but never pushes', async () => {
    await connect(a, 'PC A');
    await createNode(a, 'For the phone');
    await push(a);
    const phone = await createDevice({ fetch, readOnly: true });
    expect((await connect(phone, 'Phone')).status).toBe(200);
    expect((await pull(phone)).status).toBe(200);
    expect(await titles(phone)).toEqual(['For the phone']);
    expect((await push(phone)).status).toBe(403);
    // Its own copy can't be edited either.
    expect((await phone.request('POST', '/api/nodes', { title: 'x' })).status).toBe(403);
    await phone.close();
  });

  it('a server with a graph from before makes it the first version', async () => {
    const old = await createTestApp();
    replaceWithSnapshot(old.db, readSnapshot(a.db));
    await createNode(a, 'Old note');
    replaceWithSnapshot(old.db, readSnapshot(a.db));
    expect(seedFirstVersion(old.db)?.version).toBe(1);
    expect(seedFirstVersion(old.db)).toBeNull(); // only once
    await old.close();
  });

  it('gives devices the level table', async () => {
    const res = await hub.request<{ levelConfig: { expPerNode: number } }>(
      'GET',
      '/api/hub/config',
    );
    expect(res.status).toBe(200);
    expect(res.body.levelConfig.expPerNode).toBe(10);
  });
});
