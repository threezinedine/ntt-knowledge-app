import {
  SNAPSHOT_FORMAT,
  SNAPSHOT_KEYS,
  SNAPSHOT_TABLES,
  snapshotRowSchemas,
  type Snapshot,
  type SnapshotTable,
} from '@km/core';
import { transaction, type Database } from '../database.js';
import { sha256Hex } from '../sha256.js';
import { backfillContentWords } from './expRepository.js';

/** Column names of a snapshot table, in the order they appear in its JSON. */
const columns = (table: SnapshotTable): string[] => Object.keys(snapshotRowSchemas[table].shape);

type Row = Record<string, unknown>;

const compareRows =
  (keys: readonly string[]) =>
  (a: Row, b: Row): number => {
    for (const key of keys) {
      const x = String(a[key]);
      const y = String(b[key]);
      if (x !== y) return x < y ? -1 : 1;
    }
    return 0;
  };

/**
 * The one JSON text of a snapshot: tables in a fixed order, rows sorted by
 * primary key, columns in schema order. Equal data gives equal text (and
 * hash) on every machine, whatever order the rows were read or sent in.
 */
export function canonicalSnapshotJson(snapshot: Snapshot): string {
  const tables: Record<string, Row[]> = {};
  for (const table of SNAPSHOT_TABLES) {
    const cols = columns(table);
    tables[table] = (snapshot.tables[table] as Row[])
      .map((row) => Object.fromEntries(cols.map((c) => [c, row[c]])))
      .sort(compareRows(SNAPSHOT_KEYS[table]));
  }
  return JSON.stringify({ format: snapshot.format, tables });
}

export function snapshotHash(canonicalJson: string): string {
  return sha256Hex(canonicalJson);
}

/** No rows at all: a new, untouched database. */
export function isEmptySnapshot(snapshot: Snapshot): boolean {
  return SNAPSHOT_TABLES.every((t) => snapshot.tables[t].length === 0);
}

/**
 * A cheap stand-in for the snapshot's hash: row count and sum of updated_at
 * per table. Every write bumps a row's updated_at strictly upward (or adds or
 * tombstones rows; nothing deletes them), so any change moves it. Only a
 * replace deletes rows, and the caller forgets its cache after one. Two
 * writes to one row in the same millisecond can slip past it; that only
 * delays the status display (push and pull always read the data itself).
 */
export function snapshotFingerprint(db: Database): string {
  return SNAPSHOT_TABLES.map((table) => {
    const row = db.prepare(`SELECT COUNT(*) AS n, TOTAL(updated_at) AS s FROM ${table}`).get() as {
      n: number;
      s: number;
    };
    return `${String(row.n)}:${String(row.s)}`;
  }).join('|');
}

/** Everything a snapshot carries, read in one transaction (a consistent picture). */
export function readSnapshot(db: Database): Snapshot {
  return transaction(db, () => {
    const tables = {} as Record<SnapshotTable, unknown[]>;
    for (const table of SNAPSHOT_TABLES) {
      tables[table] = db
        .prepare(
          `SELECT ${columns(table).join(', ')} FROM ${table} ORDER BY ${SNAPSHOT_KEYS[table].join(', ')}`,
        )
        .all();
    }
    return { format: SNAPSHOT_FORMAT, tables } as Snapshot;
  });
}

/**
 * Replaces this database's graph with the snapshot's, all or nothing. Foreign
 * keys are checked at commit, so the order rows arrive in doesn't matter and a
 * snapshot that points at missing rows changes nothing.
 *
 * The removed tasks (all tombstoned since migration 4, not part of snapshots)
 * are dropped too: they reference nodes and tags that may no longer exist.
 */
export function replaceWithSnapshot(db: Database, snapshot: Snapshot): void {
  transaction(db, () => {
    db.exec('PRAGMA defer_foreign_keys = ON');
    db.exec('DELETE FROM task_tags; DELETE FROM tasks;');
    for (const table of [...SNAPSHOT_TABLES].reverse()) db.exec(`DELETE FROM ${table}`);
    for (const table of SNAPSHOT_TABLES) {
      const cols = columns(table);
      const insert = db.prepare(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => `:${c}`).join(', ')})`,
      );
      for (const row of snapshot.tables[table] as Row[]) {
        insert.run(row as Record<string, string | number | null>);
      }
    }
    // Word counts are derived, not synced: count them again.
    backfillContentWords(db);
  });
}
