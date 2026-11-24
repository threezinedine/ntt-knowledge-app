import type { BackupResult, MarkdownExportResult } from '@km/core';
import type { FastifyInstance } from 'fastify';
import { createBackup, exportMarkdown } from '../../backup/backup.js';
import type { Database } from '../../db/database.js';
import { AppError } from '../../errors.js';
import type { Repositories } from '../../repositories/index.js';
import { emptyBodySchema, parse } from '../validation.js';

/** On-demand backup and markdown export (writes; read-only sessions get 403). */
export function registerBackupRoutes(
  app: FastifyInstance,
  db: Database,
  repos: Repositories,
  dir: string,
  now: () => number,
): void {
  /** A file-system failure (folder missing rights, disk full) gets a message the user can act on. */
  const writing = <T>(what: string, fn: () => T): T => {
    try {
      return fn();
    } catch (error) {
      if (error instanceof AppError) throw error;
      app.log.error({ err: error, dir }, `${what} failed`);
      throw new AppError(500, 'INTERNAL_ERROR', `${what} failed`, undefined, 'BACKUP_FAILED');
    }
  };

  app.post('/api/backups', async (request, reply) => {
    parse(emptyBodySchema, request.body);
    const result: BackupResult = writing('Backup', () => createBackup(db, dir, now()));
    return reply.status(201).send(result);
  });

  app.post('/api/exports/markdown', async (request, reply) => {
    parse(emptyBodySchema, request.body);
    const result: MarkdownExportResult = writing('Markdown export', () =>
      exportMarkdown(repos, dir, now()),
    );
    return reply.status(201).send(result);
  });
}
