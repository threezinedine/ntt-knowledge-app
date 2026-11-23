import type { Edge } from './schemas/edge.js';
import type { NodeSummary } from './schemas/node.js';

/** Everything the graph canvas needs in one round-trip. */
export interface GraphSnapshot {
  nodes: NodeSummary[];
  edges: Edge[];
}

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'FORBIDDEN_HOST'
  | 'UNAUTHORIZED'
  | 'TOO_MANY_REQUESTS'
  | 'PAYLOAD_TOO_LARGE'
  | 'BAD_REQUEST'
  | 'INTERNAL_ERROR';

/**
 * Finer-grained, stable cause for errors whose code alone is too vague to show
 * a user. Clients translate it; `message` stays English (logs, curl).
 */
export type ApiErrorReason =
  | 'EDGE_EXISTS'
  | 'TAG_NAME_TAKEN'
  | 'TAG_HAS_CHILDREN'
  | 'TAG_CYCLE'
  | 'TAG_LIMIT_REACHED'
  | 'CODE_INVALID'
  | 'CODE_USED'
  | 'LOCKED_OUT';

/** Shape of every non-2xx JSON response body. */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    reason?: ApiErrorReason;
    message: string;
    details?: unknown;
  };
}
