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
  | 'PAYLOAD_TOO_LARGE'
  | 'BAD_REQUEST'
  | 'INTERNAL_ERROR';

/** Shape of every non-2xx JSON response body. */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}
