import { DatabaseSync } from 'node:sqlite';
import { configure, migrate, type Database } from '../database.js';

/** A fresh, migrated in-memory database (node:sqlite) for the engine's tests. */
export function memoryDb(): Database {
  const db = new DatabaseSync(':memory:');
  configure(db);
  migrate(db);
  return db;
}
