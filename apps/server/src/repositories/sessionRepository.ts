import { createHash, randomBytes } from 'node:crypto';
import type { RepoContext } from '@km/engine';

/** What goes in the cookie: 256 random bits. Only its hash is stored. */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export type SessionRepository = ReturnType<typeof createSessionRepository>;

export interface LiveSession {
  expiresAt: number;
  readOnly: boolean;
}

export function createSessionRepository({ db, now, newId }: RepoContext) {
  const insert = db.prepare(
    `INSERT INTO sessions (id, token_hash, expires_at, read_only, created_at, updated_at)
     VALUES (:id, :token_hash, :expires_at, :read_only, :ts, :ts)`,
  );
  const selectLive = db.prepare(
    `SELECT expires_at, read_only FROM sessions
      WHERE token_hash = ? AND deleted_at IS NULL AND expires_at > ?`,
  );
  const softDelete = db.prepare(
    `UPDATE sessions SET deleted_at = :ts, updated_at = :ts
      WHERE token_hash = :token_hash AND deleted_at IS NULL`,
  );

  return {
    /** Starts a session lasting `ttlMs`; returns the cookie token and its end. */
    create(ttlMs: number, readOnly = false): { token: string; expiresAt: number } {
      const token = newSessionToken();
      const ts = now();
      const expiresAt = ts + ttlMs;
      insert.run({
        id: newId(),
        token_hash: hashToken(token),
        expires_at: expiresAt,
        read_only: readOnly ? 1 : 0,
        ts,
      });
      return { token, expiresAt };
    },

    /** A live session (when it ends, whether it may only read), or undefined. */
    find(token: string): LiveSession | undefined {
      const row = selectLive.get(hashToken(token), now()) as
        { expires_at: number; read_only: number } | undefined;
      return row && { expiresAt: row.expires_at, readOnly: row.read_only === 1 };
    },

    /** Signs out: the token stops working at once. Unknown tokens are a no-op. */
    revoke(token: string): void {
      softDelete.run({ token_hash: hashToken(token), ts: now() });
    },
  };
}
