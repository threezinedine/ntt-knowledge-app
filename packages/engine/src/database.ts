import { migrations } from './migrations.js';

/**
 * The SQLite surface the engine needs, in node:sqlite's shape. On the server
 * it is node:sqlite's DatabaseSync itself; in the browser and the phone app,
 * an adapter over SQLite compiled to WebAssembly (apps/web/src/local).
 */
export type SqlValue = string | number | bigint | null | Uint8Array;
export type SqlParams = Record<string, SqlValue>;

export interface SqlStatement {
  run(...params: SqlValue[]): { changes: number | bigint };
  run(named: SqlParams, ...params: SqlValue[]): { changes: number | bigint };
  get(...params: SqlValue[]): unknown;
  get(named: SqlParams, ...params: SqlValue[]): unknown;
  all(...params: SqlValue[]): unknown[];
  all(named: SqlParams, ...params: SqlValue[]): unknown[];
}

export interface Database {
  prepare(sql: string): SqlStatement;
  exec(sql: string): void;
  /** Inside BEGIN … COMMIT. */
  readonly isTransaction: boolean;
  close(): void;
}

/** Settings every connection needs. */
export function configure(db: Database): void {
  db.exec('PRAGMA foreign_keys = ON;');
}

export function migrate(db: Database): void {
  const current = userVersion(db);
  if (current > migrations.length) {
    throw new Error(
      `Database schema v${String(current)} is newer than this build supports (v${String(migrations.length)}).`,
    );
  }
  for (let version = current; version < migrations.length; version++) {
    const sql = migrations[version];
    if (sql === undefined) continue;
    transaction(db, () => {
      db.exec(sql);
      // PRAGMA does not accept bound parameters; `version` is a trusted integer.
      db.exec(`PRAGMA user_version = ${String(version + 1)};`);
    });
  }
}

export function userVersion(db: Database): number {
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
