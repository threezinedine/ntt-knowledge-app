import { describe, expect, it } from 'vitest';
import { IN_MEMORY, migrate, openDatabase, transaction } from './database.js';
import { migrations } from './migrations.js';

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
