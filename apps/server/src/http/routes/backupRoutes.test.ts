import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ApiErrorBody, BackupResult, GraphNode, MarkdownExportResult, Tag } from '@km/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../../testing/testApp.js';

let t: TestApp;
let dir: string;

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'km-backup-test-'));
  t = await createTestApp({ backupDir: dir });
});
afterEach(async () => {
  await t.close();
  rmSync(dir, { recursive: true, force: true });
});

const backupNow = () => t.request<BackupResult & ApiErrorBody>('POST', '/api/backups');
const exportNow = () =>
  t.request<MarkdownExportResult & ApiErrorBody>('POST', '/api/exports/markdown');

describe('backup API', () => {
  it('writes a copy of the database to the backup folder, without sign-in sessions', async () => {
    await t.request('POST', '/api/nodes', { title: 'Keep me', content: 'Data' });
    t.db
      .prepare(
        `INSERT INTO sessions (id, token_hash, expires_at, read_only, created_at, updated_at)
         VALUES ('s1', 'hash', 9999999999999, 0, 1, 1)`,
      )
      .run();

    const res = await backupNow();
    expect(res.status).toBe(201);
    expect(res.body.dir).toBe(dir);
    expect(res.body.file).toBe('km-2023-11-14T22-13-20-000Z.sqlite'); // the test clock
    expect(res.body.sizeBytes).toBeGreaterThan(0);
    expect(readdirSync(dir)).toEqual([res.body.file]);

    const copy = new DatabaseSync(join(dir, res.body.file), { readOnly: true });
    try {
      expect(copy.prepare('SELECT title FROM nodes').all()).toEqual([{ title: 'Keep me' }]);
      expect(copy.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 0 });
    } finally {
      copy.close();
    }
    // The live database still has its session.
    expect(t.db.prepare('SELECT COUNT(*) AS n FROM sessions').get()).toEqual({ n: 1 });
  });

  it('never overwrites an earlier backup', async () => {
    const a = (await backupNow()).body;
    const b = (await backupNow()).body; // same clock tick
    expect(b.file).not.toBe(a.file);
    expect(readdirSync(dir).sort()).toEqual([a.file, b.file].sort());
  });

  it('says so when the folder cannot be written', async () => {
    const blocked = join(dir, 'a-file');
    writeFileSync(blocked, 'not a folder');
    const t2 = await createTestApp({ backupDir: join(blocked, 'sub') });
    try {
      const res = await t2.request<ApiErrorBody>('POST', '/api/backups');
      expect(res.status).toBe(500);
      expect(res.body.error).toMatchObject({ code: 'INTERNAL_ERROR', reason: 'BACKUP_FAILED' });
    } finally {
      await t2.close();
    }
  });

  it('has no backup routes when no folder is configured', async () => {
    const t2 = await createTestApp();
    try {
      expect((await t2.request('POST', '/api/backups')).status).toBe(404);
    } finally {
      await t2.close();
    }
  });
});

describe('markdown export API', () => {
  it('writes one .md per node into exports/<time>/', async () => {
    const tag = (await t.request<Tag>('POST', '/api/tags', { name: 'Hardware' })).body;
    const cpu = (
      await t.request<GraphNode>('POST', '/api/nodes', {
        title: 'CPU',
        content: 'Runs code.',
        tagIds: [tag.id],
      })
    ).body;
    const cache = (await t.request<GraphNode>('POST', '/api/nodes', { title: 'Cache' })).body;
    await t.request('POST', '/api/edges', { fromId: cpu.id, toId: cache.id, name: 'USES' });
    await t.request('POST', `/api/nodes/${cpu.id}/whys`, {
      summary: 'Why fast',
      whys: [{ question: 'Why?', answer: 'Because' }],
    });

    const res = await exportNow();
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      dir: join(dir, 'exports', '2023-11-14T22-13-20-000Z'),
      files: 2,
    });
    expect(readdirSync(res.body.dir).sort()).toEqual(['CPU.md', 'Cache.md']);
    const md = readFileSync(join(res.body.dir, 'CPU.md'), 'utf8');
    expect(md).toContain('tags: ["Hardware"]');
    expect(md).toContain('  - { relation: "USES", to: "[[Cache]]" }');
    expect(md).toContain('Runs code.');
    expect(md).toContain('## 5 Whys');
    expect(md).toContain('1. **Why?**\n   Because');

    // A second export the same moment goes to its own folder.
    const again = (await exportNow()).body;
    expect(again.dir).not.toBe(res.body.dir);
  });
});
