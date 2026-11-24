import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { configure, migrate, migrations, userVersion, type Database } from '@km/engine';

export type { Database } from '@km/engine';
export { migrate, transaction } from '@km/engine';

export const IN_MEMORY = ':memory:';

/** Opens (creating if needed) the database and brings the schema up to date. */
export function openDatabase(path: string): Database {
  if (path !== IN_MEMORY) mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);
  configure(db);
  db.exec('PRAGMA busy_timeout = 5000;');
  if (path !== IN_MEMORY) db.exec('PRAGMA journal_mode = WAL;');

  const current = userVersion(db);
  if (path !== IN_MEMORY && current > 0 && current < migrations.length) {
    backup(db, `${path}.backup-v${String(current)}-${String(Date.now())}`);
  }
  migrate(db);
  return db;
}

/** Consistent point-in-time copy (works under WAL), taken before schema upgrades. */
export function backup(db: Database, targetPath: string): void {
  db.exec(`VACUUM INTO '${targetPath.replaceAll("'", "''")}'`);
}
