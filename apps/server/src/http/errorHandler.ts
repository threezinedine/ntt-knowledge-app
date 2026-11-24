import type { ApiErrorBody } from '@km/core';
import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError, z } from 'zod';
import { AppError } from '@km/engine';

type ErrorFields = ApiErrorBody['error'];

function body(
  code: ErrorFields['code'],
  message: string,
  details?: unknown,
  reason?: ErrorFields['reason'],
): ApiErrorBody {
  const error: ErrorFields = { code, message };
  if (reason !== undefined) error.reason = reason;
  if (details !== undefined) error.details = details;
  return { error };
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    if (error instanceof ZodError) {
      return reply
        .status(400)
        .send(body('VALIDATION_ERROR', 'Invalid request', z.flattenError(error)));
    }
    if (error instanceof AppError) {
      return reply
        .status(error.statusCode)
        .send(body(error.code, error.message, error.details, error.reason));
    }
    // Fastify's own 4xx errors (malformed JSON, body too large, ...).
    const statusCode = 'statusCode' in error ? error.statusCode : undefined;
    if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
      const code = statusCode === 413 ? 'PAYLOAD_TOO_LARGE' : 'BAD_REQUEST';
      return reply.status(statusCode).send(body(code, error.message));
    }

    request.log.error({ err: error }, 'Unhandled error');
    return reply.status(500).send(body('INTERNAL_ERROR', 'Internal server error'));
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send(body('NOT_FOUND', `Route ${request.method} ${request.url} not found`)),
  );
}
