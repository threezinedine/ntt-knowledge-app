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
 * Before replacing, the current database is backed up too
 * (km-before-restore-….sqlite), so a restore can itself be undone.
 */
import { copyFileSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { DatabaseSync } from 'node:sqlite';
import { BACKUP_PREFIX, BACKUP_SUFFIX, createBackup } from '../backup/backup.js';
import { backupDir, loadConfig } from '../config.js';
import { migrations } from '../db/migrations.js';
import { DEFAULT_ENV_FILE, loadEnvFile } from '../envFile.js';

loadEnvFile(process.env.KM_ENV_FILE ?? DEFAULT_ENV_FILE);
const config = loadConfig(process.env);
const dir = backupDir(config);
const dbPath = config.KM_DB_PATH;
const args = process.argv.slice(2);
const yes = args.includes('--yes');
const target = args.find((a) => a !== '--yes');

function fail(message: string): never {
  console.error(`\n${message}\n`);
  process.exit(1);
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

function listBackups(): { file: string; size: number; mtime: Date }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith(BACKUP_PREFIX) && f.endsWith(BACKUP_SUFFIX))
    .map((file) => {
      const s = statSync(join(dir, file));
      return { file, size: s.size, mtime: s.mtime };
    })
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime() || (a.file < b.file ? 1 : -1));
}

const backups = listBackups();
if (target === undefined) {
  console.log(`\nBackups in ${dir}:\n`);
  if (backups.length === 0)
    console.log('  (none yet: run "Backup Now" from the app\'s command palette)');
  backups.forEach((b, i) => {
    console.log(
      `  ${String(i + 1).padStart(3)}. ${b.file}   ${mb(b.size)}   ${b.mtime.toLocaleString()}`,
    );
  });
  console.log('\nRestore one with:  npm run backup:restore -- <number or file name>\n');
  process.exit(0);
}

// 1. Which file.
const picked = /^\d+$/.test(target) ? backups[Number(target) - 1]?.file : target;
if (picked === undefined)
  fail(`There is no backup number ${target}. Run without arguments to list them.`);
const source = isAbsolute(picked) ? picked : existsSync(picked) ? picked : join(dir, picked);
if (!existsSync(source)) fail(`Not found: ${source}`);

// 2. The server must be stopped: it holds the database open.
try {
  const res = await fetch(`http://127.0.0.1:${String(config.KM_PORT)}/api/health`, {
    signal: AbortSignal.timeout(1500),
  });
  if (res.ok) {
    fail(
      `The server is running on port ${String(config.KM_PORT)}. Stop it first ` +
        '(Ctrl+C in its terminal, or `npm run docker:down`), then run this again.',
    );
  }
} catch {
  // Nothing answering: good.
}

// 3. It must be a database this build can open.
try {
  const check = new DatabaseSync(source, { readOnly: true });
  try {
    const ok = check.prepare('PRAGMA quick_check').get() as { quick_check: string } | undefined;
    if (ok?.quick_check !== 'ok')
      fail(`${source} is damaged (quick_check: ${String(ok?.quick_check)}).`);
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
    `\nReplace the database\n  ${dbPath}\nwith\n  ${source}\n? The current data is backed up first. Type "yes": `,
  );
  rl.close();
  if (answer.trim().toLowerCase() !== 'yes') fail('Nothing changed.');
}

// 5. Back up what is there now, then replace it.
if (existsSync(dbPath)) {
  const current = new DatabaseSync(dbPath);
  try {
    const saved = createBackup(current, dir, Date.now(), `${BACKUP_PREFIX}before-restore-`);
    console.log(`\nThe current database was saved as ${saved.file}`);
  } finally {
    current.close();
  }
}
for (const extra of ['-wal', '-shm']) rmSync(`${dbPath}${extra}`, { force: true });
copyFileSync(source, dbPath);
console.log(
  `Restored ${source}\n  → ${dbPath}\n\nStart the server again and sign in (sessions are not kept in backups).\n`,
);
