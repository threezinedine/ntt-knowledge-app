import type { Database } from '../db/database.js';

/** Injected dependencies shared by all repositories; swap `now`/`newId` in tests. */
export interface RepoContext {
  db: Database;
  now: () => number;
  newId: () => string;
}

export function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string') throw new TypeError('Expected JSON text column');
  const value: unknown = JSON.parse(raw);
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Expected JSON object column');
  }
  return value as Record<string, unknown>;
}

/** Escapes `%`, `_` and `\` for use in `LIKE ... ESCAPE '\'`. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Next `updated_at` for a row: wall clock, but never at or before the previous
 * value, so a backwards clock step can't make a newer write look older (LWW-safe).
 */
export function nextTimestamp(now: () => number, previous: number): number {
  return Math.max(now(), previous + 1);
}

/** Structural equality for JSON-shaped values (key order matters; fine for our writes). */
export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** SQLite unique-constraint violation, as surfaced by node:sqlite. */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/.test(error.message);
}
