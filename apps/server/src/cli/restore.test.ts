import { execFile, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBackup } from '../backup/backup.js';
import { openDatabase } from '../db/database.js';

const execFileAsync = promisify(execFile);
const SCRIPT = fileURLToPath(new URL('./restore.ts', import.meta.url));
let work: string;
let dbPath: string;
let dir: string;

/** The real command in its own process, against a throwaway database and folder. */
function restore(...args: string[]) {
  const res = spawnSync(process.execPath, ['--import', 'tsx', SCRIPT, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      KM_DB_PATH: dbPath,
      KM_BACKUP_DIR: dir,
      KM_PORT: '1', // nothing listens on port 1: "the server is stopped"
      KM_ENV_FILE: join(work, 'no.env'),
    },
  });
  return { code: res.status, out: `${res.stdout}${res.stderr}` };
}

function titles(path: string): string[] {
  const db = openDatabase(path);
  try {
    return (db.prepare('SELECT title FROM nodes ORDER BY title').all() as { title: string }[]).map(
      (r) => r.title,
    );
  } finally {
    db.close();
  }
}

function addNode(path: string, title: string): void {
  const db = openDatabase(path);
  try {
    db.prepare(
      "INSERT INTO nodes (id, type, title, created_at, updated_at) VALUES (?, 'note', ?, 1, 1)",
    ).run(title, title);
  } finally {
    db.close();
  }
}

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), 'km-restore-test-'));
  dbPath = join(work, 'km.sqlite');
  dir = join(work, 'backups');
});
afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe('npm run backup:restore', () => {
  it('lists backups, restores one, and keeps the replaced data as a backup', () => {
    addNode(dbPath, 'Old');
    const db = openDatabase(dbPath);
    const saved = createBackup(db, dir, Date.UTC(2026, 0, 1));
    db.close();
    addNode(dbPath, 'New');

    const list = restore();
    expect(list.code).toBe(0);
    expect(list.out).toContain(`1. ${saved.file}`);

    const res = restore('1', '--yes');
    expect(res.code, res.out).toBe(0);
    expect(res.out).toContain('Restored');
    expect(titles(dbPath)).toEqual(['Old']);
    const kept = readdirSync(dir).filter((f) => f.startsWith('km-before-restore-'));
    expect(kept).toHaveLength(1);
    expect(titles(join(dir, kept[0] ?? ''))).toEqual(['New', 'Old']);
  }, 30_000);

  it('refuses a file that is not a database, and changes nothing', () => {
    addNode(dbPath, 'Safe');
    const junk = join(work, 'junk.sqlite');
    writeFileSync(junk, 'not sqlite');
    const res = restore(junk, '--yes');
    expect(res.code).toBe(1);
    expect(res.out).toMatch(/not a Knowledge Manager database|damaged/);
    expect(titles(dbPath)).toEqual(['Safe']);
    expect(existsSync(dir)).toBe(false);
  }, 30_000);

  it('refuses while something has the database open (a server, even in another container)', () => {
    addNode(dbPath, 'Live');
    const db = openDatabase(dbPath);
    createBackup(db, dir, Date.UTC(2026, 0, 1));
    // `db` stays open and idle, like a running server between requests.
    try {
      const res = restore('1', '--yes');
      expect(res.code).toBe(1);
      expect(res.out).toContain('is in use (is the server running?)');
    } finally {
      db.close();
    }
    expect(titles(dbPath)).toEqual(['Live']);
  }, 30_000);

  it('still restores when the current database is damaged, keeping its files', () => {
    addNode(dbPath, 'Good');
    const db = openDatabase(dbPath);
    createBackup(db, dir, Date.UTC(2026, 0, 1));
    db.close();
    writeFileSync(dbPath, 'this is not a database any more');

    const res = restore('1', '--yes');
    expect(res.code, res.out).toBe(0);
    expect(res.out).toContain('saved as they are');
    expect(titles(dbPath)).toEqual(['Good']);
    const raw = readdirSync(dir).find((f) => f.endsWith('-raw.sqlite')) ?? '';
    expect(readFileSync(join(dir, raw), 'utf8')).toBe('this is not a database any more');
  }, 30_000);

  it('rejects unknown options instead of taking them as a file', () => {
    const res = restore('1', '-y');
    expect(res.code).toBe(1);
    expect(res.out).toContain('Unknown option -y');
  }, 30_000);

  it('refuses while a server answers on the configured port', async () => {
    addNode(dbPath, 'Live');
    const db = openDatabase(dbPath);
    createBackup(db, dir, Date.UTC(2026, 0, 1));
    db.close();
    // Any HTTP answer on KM_HOST:KM_PORT, even an error, means something serves there.
    const server = createServer((_req, res) => {
      res.statusCode = 503;
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = String((server.address() as AddressInfo).port);
    try {
      const { stdout, stderr } = await execFileAsync(
        process.execPath,
        ['--import', 'tsx', SCRIPT, '1', '--yes'],
        {
          env: {
            ...process.env,
            KM_DB_PATH: dbPath,
            KM_BACKUP_DIR: dir,
            KM_PORT: port,
            KM_ENV_FILE: join(work, 'no.env'),
          },
        },
      ).catch((e: unknown) => e as { stdout: string; stderr: string });
      expect(`${stdout}${stderr}`).toContain('A server answers at');
    } finally {
      server.close();
    }
    expect(titles(dbPath)).toEqual(['Live']);
  }, 30_000);

  it('refuses an unknown number', () => {
    const res = restore('7', '--yes');
    expect(res.code).toBe(1);
    expect(res.out).toContain('There is no backup number 7');
  }, 30_000);
});
