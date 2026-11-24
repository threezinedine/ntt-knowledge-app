import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { IN_MEMORY, migrate, openDatabase, transaction } from './database.js';
import { migrations } from '@km/engine';

describe('database', () => {
  it('applies all migrations and records the version', () => {
    const db = openDatabase(IN_MEMORY);
    const { user_version } = db.prepare('PRAGMA user_version').get() as { user_version: number };
    expect(user_version).toBe(migrations.length);
    migrate(db); // idempotent
    db.close();
  });

  it('refuses to open a database from a newer build', () => {
    const db = openDatabase(IN_MEMORY);
    db.exec(`PRAGMA user_version = ${migrations.length + 1}`);
    expect(() => {
      migrate(db);
    }).toThrow(/newer than this build/);
    db.close();
  });

  it('rolls back a failed transaction', () => {
    const db = openDatabase(IN_MEMORY);
    db.exec('CREATE TABLE t (x INTEGER)');
    expect(() =>
      transaction(db, () => {
        db.exec('INSERT INTO t VALUES (1)');
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(db.prepare('SELECT COUNT(*) AS n FROM t').get()).toEqual({ n: 0 });
    db.close();
  });

  it('enforces JSON validity on props', () => {
    const db = openDatabase(IN_MEMORY);
    expect(() => {
      db.exec(
        "INSERT INTO nodes (id, type, title, props, created_at, updated_at) VALUES ('x', 'note', 't', 'not json', 0, 0)",
      );
    }).toThrow(/CHECK constraint/);
    db.close();
  });
});

describe('backup before migrate', () => {
  it('copies a file database at its old version before upgrading it', () => {
    const dir = mkdtempSync(join(tmpdir(), "km-backup-'quote-"));
    try {
      const path = join(dir, 'km.sqlite');
      const v1 = new DatabaseSync(path);
      v1.exec(migrations[0] ?? '');
      v1.exec(
        "INSERT INTO nodes (id, type, title, created_at, updated_at) VALUES ('n', 'note', 'N', 1, 1)",
      );
      v1.exec('PRAGMA user_version = 1;');
      v1.close();

      openDatabase(path).close();

      const backups = readdirSync(dir).filter((f) => f.startsWith('km.sqlite.backup-v1-'));
      expect(backups).toHaveLength(1);
      const copy = new DatabaseSync(join(dir, backups[0] ?? ''), { readOnly: true });
      expect(copy.prepare('PRAGMA user_version').get()).toEqual({ user_version: 1 });
      expect(copy.prepare('SELECT COUNT(*) AS n FROM nodes').get()).toEqual({ n: 1 });
      copy.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not back up a brand-new or already-current database', () => {
    const dir = mkdtempSync(join(tmpdir(), 'km-backup-'));
    try {
      const path = join(dir, 'km.sqlite');
      openDatabase(path).close(); // new → migrated, no backup
      openDatabase(path).close(); // current → nothing to do
      expect(readdirSync(dir).filter((f) => f.includes('backup'))).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
