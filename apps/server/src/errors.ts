import type { ApiErrorCode } from '@km/core';

/** Errors that map to a well-defined HTTP response. Anything else is a 500. */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: ApiErrorCode;
  readonly details: unknown;

  constructor(statusCode: number, code: ApiErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export type EntityName = 'Node' | 'Edge' | 'Category' | 'Task';

export class NotFoundError extends AppError {
  constructor(entity: EntityName, id: string) {
    super(404, 'NOT_FOUND', `${entity} ${id} not found`);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super(409, 'CONFLICT', message, details);
  }
}

export class DomainValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, 'VALIDATION_ERROR', message, details);
  }
}
