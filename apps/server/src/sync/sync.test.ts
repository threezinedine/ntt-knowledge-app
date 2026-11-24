import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  ApiErrorBody,
  GraphNode,
  HubVersion,
  PhoneView,
  Snapshot,
  SyncStatus,
} from '@km/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { base32Decode, hotp, stepAt } from '../auth/totp.js';
import { createBackup } from '../backup/backup.js';
import {
  canonicalSnapshotJson,
  readSnapshot,
  replaceWithSnapshot,
  snapshotHash,
} from '../repositories/snapshotRepository.js';
import { createTestApp, injectFetch, type TestApp } from '../testing/testApp.js';
import { PULL_BACKUP_PREFIX } from './syncService.js';

const HUB_URL = 'http://hub.test:4317';
const SECRET = base32Decode('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP');

let hub: TestApp;
let a: TestApp;
let b: TestApp;
let dir: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'km-sync-'));
  hub = await createTestApp({ hub: { keepVersions: 3 } });
  const fetch = injectFetch(() => hub.app);
  a = await createTestApp({ fetch, backupDir: join(dir, 'a') });
  b = await createTestApp({ fetch, backupDir: join(dir, 'b') });
});
afterEach(async () => {
  await Promise.all([hub.close(), a.close(), b.close()]);
  rmSync(dir, { recursive: true, force: true });
});

const connect = (t: TestApp, deviceName: string) =>
  t.request<SyncStatus>('POST', '/api/sync/connect', { hubUrl: HUB_URL, code: '', deviceName });
const status = async (t: TestApp) => (await t.request<SyncStatus>('GET', '/api/sync/status')).body;
const push = (t: TestApp, force = false) =>
  t.request<SyncStatus & ApiErrorBody>('POST', '/api/sync/push', { force });
const pull = (t: TestApp, force = false) =>
  t.request<SyncStatus & ApiErrorBody>('POST', '/api/sync/pull', { force });
const createNode = async (t: TestApp, title: string, content = '') =>
  (await t.request<GraphNode>('POST', '/api/nodes', { title, content })).body;
const titles = async (t: TestApp) =>
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
    const hashOf = (t: TestApp) => snapshotHash(canonicalSnapshotJson(readSnapshot(t.db)));
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

  it('refuses to pull over changes the hub does not have; forced, it keeps a backup', async () => {
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
    const backups = readdirSync(join(dir, 'b')).filter((f) => f.startsWith(PULL_BACKUP_PREFIX));
    expect(backups).toHaveLength(1);
    const copy = new DatabaseSync(join(dir, 'b', backups[0] ?? ''));
    expect(copy.prepare('SELECT title FROM nodes').all()).toEqual([{ title: 'Only on B' }]);
    copy.close();
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

  it('a server without KM_HUB=on is not a hub', async () => {
    const plain = await createTestApp();
    const c = await createTestApp({ fetch: injectFetch(() => plain.app) });
    const res = await c.request<ApiErrorBody>('POST', '/api/sync/connect', {
      hubUrl: HUB_URL,
      code: '',
      deviceName: 'X',
    });
    expect(res.status).toBe(502);
    expect(res.body.error.reason).toBe('HUB_NOT_ENABLED');
    await Promise.all([plain.close(), c.close()]);
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
  const pair = (t: TestApp, code = '', readOnly = false) =>
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
      auth: { totpSecret: SECRET, sessionTtlMs: 60_000, secureCookie: false },
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

  it('serves the newest version as the phone app shows it', async () => {
    await connect(a, 'PC A');
    const node = await createNode(a, 'Seen on the phone', 'word word');
    await push(a);
    const { token } = (await pair(hub, '', true)).body;
    const res = await hub.app.inject({
      method: 'GET',
      url: '/api/hub/latest/view',
      headers: asDevice(token),
    });
    expect(res.statusCode).toBe(200);
    const view = res.json<PhoneView>();
    expect(view.head.version).toBe(1);
    expect(view.nodes.map((n) => n.id)).toEqual([node.id]);
    expect(view.graph.nodes.map((n) => n.title)).toEqual(['Seen on the phone']);
    expect(view.exp.tags).toEqual([]);
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

describe('backups', () => {
  it('leave out the hub token', async () => {
    await connect(a, 'PC A');
    const result = createBackup(a.db, join(dir, 'bk'), Date.now());
    const copy = new DatabaseSync(join(result.dir, result.file));
    expect(copy.prepare('SELECT COUNT(*) AS n FROM sync_state').get()).toEqual({ n: 0 });
    copy.close();
    expect(existsSync(join(result.dir, result.file))).toBe(true);
  });
});

describe('sync review fixes', () => {
  it('a pull refuses an edit that lands while the hub is answering', async () => {
    let pause: (() => Promise<void>) | null = null;
    const inner = injectFetch(() => hub.app);
    const c = await createTestApp({
      backupDir: join(dir, 'c'),
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
    const broken = await createTestApp({
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
      auth: { totpSecret: SECRET, sessionTtlMs: 60_000, secureCookie: false },
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

  it('a read-only session can’t push or pull', async () => {
    const t = await createTestApp({
      auth: { totpSecret: SECRET, sessionTtlMs: 60_000, secureCookie: false },
    });
    const login = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { code: hotp(SECRET, stepAt(1_700_000_000_000)), readOnly: true },
    });
    const cookie = login.cookies.find((c) => c.name === 'km_session');
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/sync/push',
      payload: {},
      cookies: { km_session: cookie?.value ?? '' },
    });
    expect(res.statusCode).toBe(403);
    await t.close();
  });
});
