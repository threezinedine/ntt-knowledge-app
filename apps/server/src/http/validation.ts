import { idSchema } from '@km/core';
import { z } from 'zod';

export const idParamsSchema = z.object({ id: idSchema });

/** For actions that take no input: no body, or `{}`; anything else is a 400. */
export const emptyBodySchema = z.strictObject({}).optional();

/** Parses `schema` or throws `ZodError`, which the error handler turns into a 400. */
export function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  return schema.parse(value);
}
