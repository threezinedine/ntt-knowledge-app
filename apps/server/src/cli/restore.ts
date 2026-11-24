/* eslint-disable no-console -- a terminal tool: printing is its job */
/**
 * `npm run backup:restore`: puts a backup back in place of the database.
 * Only from the terminal and only while the server is stopped, so nobody can
 * overwrite the data from a browser and no running server holds the file.
 *
 *   npm run backup:restore                     list the backups (newest first)
 *   npm run backup:restore -- 1                restore the newest (number from the list)
 *   npm run backup:restore -- km-2026-….sqlite restore that file (name or path)
 *   … -- --yes                                 don't ask before replacing
 *
 * Before replacing, the current database is saved too
 * (km-before-restore-….sqlite), so a restore can itself be undone; if it is
 * too damaged to copy cleanly, its files are copied as they are.
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { DatabaseSync } from 'node:sqlite';
import { BACKUP_PREFIX, BACKUP_SUFFIX, createBackup, stamp } from '../backup/backup.js';
import { backupDir, loadConfig } from '../config.js';
import { migrations } from '../db/migrations.js';
import { DEFAULT_ENV_FILE, loadEnvFile } from '../envFile.js';

loadEnvFile(process.env.KM_ENV_FILE ?? DEFAULT_ENV_FILE);
const config = loadConfig(process.env);
const dir = backupDir(config);
const dbPath = resolve(config.KM_DB_PATH);
const BEFORE_RESTORE = `${BACKUP_PREFIX}before-restore-`;

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const USAGE =
  'Usage: npm run backup:restore [-- <number or file> [--yes]]\n' +
  '  (no arguments: list the backups)';
const args = process.argv.slice(2);
const yes = args.includes('--yes');
const unknown = args.filter((a) => a.startsWith('-') && a !== '--yes');
if (unknown.length) fail(`Unknown option ${unknown.join(', ')}.\n${USAGE}`);
const targets = args.filter((a) => !a.startsWith('-'));
if (targets.length > 1) fail(`Give one backup, not ${String(targets.length)}.\n${USAGE}`);
const target = targets[0];

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

/** Newest first, by the time in the name (a sync client may rewrite mtimes). */
function listBackups(): { file: string; size: number }[] {
  if (!existsSync(dir)) return [];
  const timeOf = (f: string) =>
    f.slice(f.startsWith(BEFORE_RESTORE) ? BEFORE_RESTORE.length : BACKUP_PREFIX.length);
  return readdirSync(dir)
    .filter((f) => f.startsWith(BACKUP_PREFIX) && f.endsWith(BACKUP_SUFFIX))
    .map((file) => ({ file, size: statSync(join(dir, file)).size }))
    .sort((a, b) =>
      timeOf(a.file) < timeOf(b.file) ? 1 : timeOf(a.file) > timeOf(b.file) ? -1 : 0,
    );
}

const backups = listBackups();
if (target === undefined) {
  console.log(`\nBackups in ${dir}:\n`);
  if (backups.length === 0) {
    console.log('  (none yet: run "Backup Now" from the app\'s command palette)');
  }
  backups.forEach((b, i) => {
    console.log(`  ${String(i + 1).padStart(3)}. ${b.file}   ${mb(b.size)}`);
  });
  console.log('\nRestore one with:  npm run backup:restore -- <number or file name>\n');
  process.exit(0);
}

// 1. Which file. A path is read from where the command was typed (npm runs
//    this in apps/server), a bare name from the backup folder.
const picked = /^\d+$/.test(target) ? backups[Number(target) - 1]?.file : target;
if (picked === undefined) {
  fail(`There is no backup number ${target}. Run without arguments to list them.`);
}
const typedFrom = process.env.INIT_CWD ?? process.cwd();
const source = [resolve(typedFrom, picked), join(dir, picked)].find((p) => existsSync(p));
if (source === undefined) fail(`Not found: ${picked} (looked in ${typedFrom} and ${dir}).`);
if (resolve(source) === dbPath) fail('That is the database itself, not a backup.');

// 2. Nothing may have the database open. The lock is the real test (it also
//    sees a server in another container on the same volume); the health check
//    catches a server whose files live elsewhere than this .env says.
function databaseInUse(path: string): boolean {
  if (!existsSync(path)) return false;
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(path);
  } catch {
    return false; // can't even open it: nobody else is using it either
  }
  try {
    db.exec('PRAGMA busy_timeout = 0; PRAGMA locking_mode = EXCLUSIVE;');
    db.exec('BEGIN EXCLUSIVE; COMMIT;');
    return false;
  } catch (error) {
    // A damaged file fails differently; that's for the backup step below.
    return /locked|busy/i.test(String(error));
  } finally {
    db.close();
  }
}
if (databaseInUse(dbPath)) {
  fail(
    `${dbPath} is in use (is the server running?). Stop it first (Ctrl+C in its ` +
      'terminal, or `docker compose stop`), then run this again.',
  );
}
const host = ['0.0.0.0', '::', ''].includes(config.KM_HOST) ? '127.0.0.1' : config.KM_HOST;
const url = `http://${host.includes(':') ? `[${host}]` : host}:${String(config.KM_PORT)}/api/health`;
try {
  await fetch(url, { signal: AbortSignal.timeout(1500) });
  // Any HTTP answer means something is serving there.
  fail(`A server answers at ${url}. Stop it first, then run this again.`);
} catch (error) {
  if (error instanceof Error && error.name === 'TimeoutError') {
    fail(
      `Couldn't tell whether the server at ${url} is stopped (no answer in time). Stop it and retry.`,
    );
  }
  // Connection refused: nothing is running. Good.
}

// 3. It must be a database this build can open.
try {
  const check = new DatabaseSync(source, { readOnly: true });
  try {
    const ok = check.prepare('PRAGMA quick_check').get() as { quick_check: string } | undefined;
    if (ok?.quick_check !== 'ok') {
      fail(`${source} is damaged (quick_check: ${String(ok?.quick_check)}).`);
    }
    const v = check.prepare('PRAGMA user_version').get() as { user_version: number } | undefined;
    const version = v?.user_version ?? 0;
    if (version < 1 || version > migrations.length) {
      fail(
        `${source} has schema v${String(version)}; this build supports v1–v${String(migrations.length)}.`,
      );
    }
    check.prepare('SELECT COUNT(*) FROM nodes').get();
  } finally {
    check.close();
  }
} catch (error) {
  fail(`${source} is not a Knowledge Manager database: ${String(error)}`);
}

// 4. Ask.
if (!yes) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `\nReplace the database\n  ${dbPath}\nwith\n  ${source}\n? The current data is saved first. Type "yes": `,
  );
  rl.close();
  if (answer.trim().toLowerCase() !== 'yes') fail('Nothing changed.');
}

// 5. Save what is there now: a clean copy if it can be read, else its files
//    as they are (a damaged database is exactly when people restore).
if (existsSync(dbPath)) {
  let saved: string;
  try {
    const current = new DatabaseSync(dbPath);
    try {
      saved = createBackup(current, dir, Date.now(), BEFORE_RESTORE).file;
    } finally {
      current.close();
    }
  } catch (error) {
    mkdirSync(dir, { recursive: true });
    const base = join(dir, `${BEFORE_RESTORE}${stamp(Date.now())}-raw${BACKUP_SUFFIX}`);
    for (const extra of ['', '-wal', '-shm']) {
      if (existsSync(`${dbPath}${extra}`)) copyFileSync(`${dbPath}${extra}`, `${base}${extra}`);
    }
    saved = basename(base);
    console.log(`\nThe current database could not be copied cleanly (${String(error)}).`);
    console.log('Its files were saved as they are instead.');
  }
  console.log(`\nThe current database was saved as ${saved} in ${dir}`);
}

// 6. Replace it: copy next to it first, then swap in one step, so an
//    interrupted copy never leaves a half-written database.
const incoming = `${dbPath}.restoring`;
copyFileSync(source, incoming);
for (const extra of ['-wal', '-shm']) rmSync(`${dbPath}${extra}`, { force: true });
renameSync(incoming, dbPath);
console.log(
  `Restored ${source}\n  → ${dbPath}\n\nStart the server again and sign in (sessions are not kept in backups).\n`,
);
