import type { ApiErrorCode, ApiErrorReason } from '@km/core';

/** Errors that map to a well-defined HTTP response. Anything else is a 500. */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;
  readonly details: unknown;
  readonly reason: ApiErrorReason | undefined;

  constructor(
    statusCode: number,
    code: ApiErrorCode,
    message: string,
    details?: unknown,
    reason?: ApiErrorReason,
  ) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.reason = reason;
  }
}

export type EntityName = 'Node' | 'Edge' | 'Tag';

export class NotFoundError extends AppError {
  constructor(entity: EntityName, id: string) {
    super(404, 'NOT_FOUND', `${entity} ${id} not found`);
  }
}

export class ConflictError extends AppError {
  constructor(reason: ApiErrorReason, message: string, details?: unknown) {
    super(409, 'CONFLICT', message, details, reason);
  }
}

export class UnauthorizedError extends AppError {
  constructor(reason?: ApiErrorReason, message = 'Sign in required') {
    super(401, 'UNAUTHORIZED', message, undefined, reason);
  }
}

export class ForbiddenError extends AppError {
  constructor(reason: ApiErrorReason, message: string) {
    super(403, 'FORBIDDEN', message, undefined, reason);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(reason: ApiErrorReason, message: string, retryAfterMs: number) {
    super(429, 'TOO_MANY_REQUESTS', message, { retryAfterMs }, reason);
  }
}

export class DomainValidationError extends AppError {
  constructor(reason: ApiErrorReason, message: string, details?: unknown) {
    super(400, 'VALIDATION_ERROR', message, details, reason);
  }
}
