import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  buildTagTree,
  flattenTagTree,
  type BackupResult,
  type MarkdownExportResult,
  type WhySession,
} from '@km/core';
import { backup, type Database } from '../db/database.js';
import type { Repositories } from '../repositories/index.js';
import { renderMarkdownExport } from './markdown.js';

/**
 * Backups and the markdown export, both only on demand (the user runs a
 * command). They go to the backup folder (KM_BACKUP_DIR), which can be a
 * cloud-synced folder or another disk so a dead disk doesn't take the
 * backups with it. Restoring is a terminal command (cli/restore.ts) run
 * while the server is stopped, never an API.
 */

/** "2026-11-24T08-12-03-123Z": sortable, and legal in file names everywhere. */
export function stamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[:.]/g, '-');
}

export const BACKUP_PREFIX = 'km-';
export const BACKUP_SUFFIX = '.sqlite';

/** A path in `dir` that doesn't exist yet: `base + ext`, else `base-2 + ext`, … */
function freePath(dir: string, base: string, ext: string): string {
  let path = join(dir, `${base}${ext}`);
  for (let n = 2; existsSync(path); n++) path = join(dir, `${base}-${String(n)}${ext}`);
  return path;
}

/**
 * A consistent copy of the database (VACUUM INTO works while the server is
 * running, WAL included), minus sign-in sessions: they are device-local
 * secrets, and after a restore you just sign in again.
 */
export function createBackup(
  db: Database,
  dir: string,
  now: number,
  prefix = BACKUP_PREFIX,
): BackupResult {
  mkdirSync(dir, { recursive: true });
  const path = freePath(dir, `${prefix}${stamp(now)}`, BACKUP_SUFFIX);
  backup(db, path);
  const copy = new DatabaseSync(path);
  try {
    // Databases from before sign-in existed (schema < 6) have no sessions table.
    const hasSessions = copy
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sessions'")
      .get();
    if (hasSessions) copy.exec('DELETE FROM sessions; VACUUM;');
  } finally {
    copy.close();
  }
  return {
    file: basename(path),
    dir,
    sizeBytes: statSync(path).size,
    createdAt: now,
  };
}

/** Every node as a .md file in `<dir>/exports/<stamp>/` (see markdown.ts). */
export function exportMarkdown(
  repos: Repositories,
  dir: string,
  now: number,
): MarkdownExportResult {
  const nodes = repos.nodes.all();
  const tagPath = new Map(
    flattenTagTree(buildTagTree(repos.tags.all())).map((n) => [n.tag.id, n.path.join('/')]),
  );
  const whys = new Map<string, WhySession[]>();
  for (const s of repos.whys.all()) {
    const list = whys.get(s.nodeId);
    if (list) list.push(s);
    else whys.set(s.nodeId, [s]);
  }
  const files = renderMarkdownExport({ nodes, edges: repos.edges.all(), tagPath, whys });

  const exports = join(dir, 'exports');
  mkdirSync(exports, { recursive: true });
  const target = freePath(exports, stamp(now), '');
  mkdirSync(target);
  for (const f of files) writeFileSync(join(target, f.name), f.content, 'utf8');
  return { dir: target, files: files.length };
}
