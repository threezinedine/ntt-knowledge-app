import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrations } from './migrations.js';

export type Database = DatabaseSync;

export const IN_MEMORY = ':memory:';

/** Opens (creating if needed) the database and brings the schema up to date. */
export function openDatabase(path: string): Database {
  if (path !== IN_MEMORY) mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  if (path !== IN_MEMORY) db.exec('PRAGMA journal_mode = WAL;');

  migrate(db);
  return db;
}

export function migrate(db: Database): void {
  const current = userVersion(db);
  if (current > migrations.length) {
    throw new Error(
      `Database schema v${current} is newer than this build supports (v${migrations.length}).`,
    );
  }
  for (let version = current; version < migrations.length; version++) {
    const sql = migrations[version];
    if (sql === undefined) continue;
    transaction(db, () => {
      db.exec(sql);
      // PRAGMA does not accept bound parameters; `version` is a trusted integer.
      db.exec(`PRAGMA user_version = ${version + 1};`);
    });
  }
}

function userVersion(db: Database): number {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
  return row?.user_version ?? 0;
}

/**
 * Runs `fn` inside a transaction. Nested calls join the outer transaction
 * (SQLite has no real nesting), so repositories can compose freely.
 */
export function transaction<T>(db: Database, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
