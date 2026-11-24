import type { Edge } from './schemas/edge.js';
import type { NodeSummary } from './schemas/node.js';

/** Everything the graph canvas needs in one round-trip. */
export interface GraphSnapshot {
  nodes: NodeSummary[];
  edges: Edge[];
}

export const API_ERROR_CODES = [
  'VALIDATION_ERROR',
  'NOT_FOUND',
  'CONFLICT',
  'FORBIDDEN_HOST',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'TOO_MANY_REQUESTS',
  'PAYLOAD_TOO_LARGE',
  'BAD_REQUEST',
  'BAD_GATEWAY',
  'INTERNAL_ERROR',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

/**
 * Finer-grained, stable cause for errors whose code alone is too vague to show
 * a user. Clients translate it; `message` stays English (logs, curl).
 * Listed at runtime so a test can check every one has a translation.
 */
export const API_ERROR_REASONS = [
  'EDGE_EXISTS',
  'TAG_NAME_TAKEN',
  'TAG_HAS_CHILDREN',
  'TAG_CYCLE',
  'TAG_LIMIT_REACHED',
  'CODE_INVALID',
  'CODE_USED',
  'LOCKED_OUT',
  'READ_ONLY',
  'BACKUP_FAILED',
  /** Sync: the hub has a version this device hasn't pulled (push with force to overwrite). */
  'SYNC_BEHIND',
  /** Sync: this device has changes the hub doesn't (pull with force to overwrite). */
  'SYNC_LOCAL_CHANGES',
  'SYNC_NOT_CONNECTED',
  'HUB_UNREACHABLE',
  /** The hub refused this device's token (removed, or the hub's data was reset). */
  'HUB_DENIED',
  /** That server isn't a hub (KM_HUB is off), or not a Knowledge Manager at all. */
  'HUB_NOT_ENABLED',
  /** The hub's snapshot is in a format this version can't read: update the app. */
  'HUB_INCOMPATIBLE',
  'HUB_EMPTY',
  /** The hub refused this address in the Host header (its KM_ALLOWED_HOSTS). */
  'HUB_HOST_REFUSED',
  /** The hub answered with an error of its own (see its log). */
  'HUB_ERROR',
] as const;
export type ApiErrorReason = (typeof API_ERROR_REASONS)[number];

/** Shape of every non-2xx JSON response body. */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    reason?: ApiErrorReason;
    message: string;
    details?: unknown;
  };
}

/** POST /api/backups: a copy of the database (without sign-in sessions). */
export interface BackupResult {
  /** File name inside `dir`. */
  file: string;
  /** The backup folder on the server's machine (KM_BACKUP_DIR). */
  dir: string;
  sizeBytes: number;
  createdAt: number;
}

/** POST /api/exports/markdown: one .md file per node, written on the server's machine. */
export interface MarkdownExportResult {
  /** The folder the files were written to. */
  dir: string;
  files: number;
}
