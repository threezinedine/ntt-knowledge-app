import type { ApiErrorBody } from '@km/core';
import { describe, expect, it } from 'vitest';
import { ApiError, NetworkError } from '../api/client';
import { SOURCE_MESSAGES } from './catalog';
import { describeError } from './errorText';
import { format, lookup } from './format';

// The real English catalogue, so missing-key behaviour is exercised for real.
const t = (key: string, params?: Readonly<Record<string, string | number>>) =>
  format(lookup([SOURCE_MESSAGES], key), params);
const has = (key: string) => key in SOURCE_MESSAGES;
const describe_ = (error: unknown) => describeError(t, has, error);

const apiError = (status: number, error: Record<string, unknown>) =>
  new ApiError(status, { error } as unknown as ApiErrorBody);

describe('describeError', () => {
  it('prefers the reason, then the code, of an API error', () => {
    expect(
      describe_(apiError(409, { code: 'CONFLICT', reason: 'TAG_NAME_TAKEN', message: 'x' })),
    ).toBe(SOURCE_MESSAGES['error.reason.TAG_NAME_TAKEN']);
    expect(describe_(apiError(404, { code: 'NOT_FOUND', message: 'Node x' }))).toBe(
      SOURCE_MESSAGES['error.code.NOT_FOUND'],
    );
  });

  it('fills the tag limit into its message', () => {
    expect(
      describe_(apiError(400, { code: 'VALIDATION_ERROR', reason: 'TAG_LIMIT_REACHED' })),
    ).toBe('At most 50 tags per node or task.');
  });

  it('never shows a raw key for a reason or code this bundle does not know', () => {
    expect(
      describe_(apiError(409, { code: 'CONFLICT', reason: 'FROM_THE_FUTURE', message: 'x' })),
    ).toBe(SOURCE_MESSAGES['error.code.CONFLICT']);
    expect(describe_(apiError(429, { code: 'RATE_LIMITED', message: 'x' }))).toBe(
      'Request failed (HTTP 429).',
    );
  });

  it('describes body-less HTTP failures and network failures', () => {
    expect(describe_(new ApiError(502, undefined))).toBe('Request failed (HTTP 502).');
    expect(describe_(new NetworkError(new TypeError('Failed to fetch')))).toBe(
      SOURCE_MESSAGES['error.network'],
    );
  });

  it('passes other errors through', () => {
    expect(describe_(new Error('boom'))).toBe('boom');
  });
});
