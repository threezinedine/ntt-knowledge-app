// @vitest-environment node
import { configure, migrate, readSnapshot, canonicalSnapshotJson, type Database } from '@km/engine';
import { createTestApp, type TestApp } from '@km/engine/testing';
import sqlite3InitModule, { type Sqlite3Static } from '@sqlite.org/sqlite-wasm';
import { beforeAll, describe, expect, it } from 'vitest';
import { wasmDatabase } from './wasmDatabase';

// The browser runs the engine on SQLite WebAssembly through this adapter; the
// engine's own tests run on node:sqlite. The same work on both must leave the
// same data, byte for byte.

let sqlite3: Sqlite3Static;
beforeAll(async () => {
  sqlite3 = await sqlite3InitModule();
});

const wasmDb = (): Database => {
  const db = wasmDatabase(sqlite3, new sqlite3.oo1.DB(':memory:'));
  configure(db);
  migrate(db);
  return db;
};

/** Ids in creation order, the same on every run. */
const ids = () => {
  let n = 0;
  return () => `00000000-0000-7000-8000-${String(++n).padStart(12, '0')}`;
};

async function workOn(t: TestApp): Promise<void> {
  const post = async (url: string, body: unknown) => {
    const res = await t.request<{ id: string }>('POST', url, body);
    expect(res.status, url).toBe(201);
    return res.body;
  };
  const a = await post('/api/nodes', { title: 'CPU', content: 'Runs code. Fast.' });
  t.tick();
  const b = await post('/api/nodes', { title: 'Cache', position: { x: 10.5, y: -3 } });
  t.tick();
  await post('/api/edges', { fromId: a.id, toId: b.id, name: 'contains', props: { w: 1 } });
  const tag = await post('/api/tags', { name: 'Hardware' });
  expect((await t.request('PUT', `/api/nodes/${a.id}/tags/${tag.id}`)).status).toBe(200);
  await post(`/api/nodes/${a.id}/whys`, { whys: [{ question: 'Why?', answer: 'Because.' }] });
  t.tick();
  expect((await t.request('PATCH', `/api/nodes/${a.id}`, { title: 'CPU core' })).status).toBe(200);
  expect(
    (
      await t.request('PATCH', '/api/nodes/positions', {
        items: [{ id: a.id, position: { x: 1, y: 2 } }],
      })
    ).status,
  ).toBe(204);
  t.tick();
  expect((await t.request('DELETE', `/api/nodes/${b.id}`)).status).toBe(204);
  expect((await t.request<unknown[]>('GET', '/api/nodes?q=cpu')).body).toHaveLength(1);
  expect((await t.request<{ tags: unknown[] }>('GET', '/api/exp')).body.tags).toHaveLength(1);
}

describe('the engine on SQLite WebAssembly', () => {
  it('leaves exactly the data node:sqlite does', async () => {
    const node = await createTestApp({ newId: ids() });
    const wasm = await createTestApp({ newId: ids(), db: wasmDb() });
    await workOn(node);
    await workOn(wasm);
    expect(canonicalSnapshotJson(readSnapshot(wasm.db))).toBe(
      canonicalSnapshotJson(readSnapshot(node.db)),
    );
    await Promise.all([node.close(), wasm.close()]);
  });

  it('rolls back a failed transaction and reports it', async () => {
    const wasm = await createTestApp({ db: wasmDb() });
    const res = await wasm.request('POST', '/api/edges', {
      fromId: '00000000-0000-7000-8000-000000000001',
      toId: '00000000-0000-7000-8000-000000000002',
      name: 'nothing there',
    });
    expect(res.status).toBe(404);
    expect(wasm.db.isTransaction).toBe(false);
    await wasm.close();
  });

  it('binds like node:sqlite: unknown names and mixed binding are errors', () => {
    const db = wasmDb();
    expect(db.prepare('SELECT :a AS a').get({ a: 1 })).toEqual({ a: 1 });
    expect(() => db.prepare('SELECT :a AS a').get({ a: 1, zz: 2 })).toThrow(/Unknown named/);
    expect(() => db.prepare('SELECT :a AS a, ? AS b').get({ a: 'x' }, 'y')).toThrow(/together/);
    expect(db.prepare('SELECT ? AS a, ? AS b').get(1, 'two')).toEqual({ a: 1, b: 'two' });
    db.close();
  });
});
