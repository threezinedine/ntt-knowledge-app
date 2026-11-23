import { MAX_TAGS_PER_ITEM } from '@km/core';
import { ApiError, errorMessage, NetworkError } from '../api/client';
import type { MessageKey } from './catalog';
import type { Params } from './context';

type Translate = (key: MessageKey, params?: Params) => string;

/** Values any error message may interpolate. */
const ERROR_PARAMS = { max: MAX_TAGS_PER_ITEM };

/**
 * Server messages are English and meant for developers, so API errors are
 * shown via their stable `reason`/`code`. Both arrive as unvalidated JSON, and
 * an installed PWA may run an older bundle than the server, so each step is
 * tried only if this bundle has a message for it: reason → code → HTTP status.
 * Anything else (a bug, a JSON parse error) falls through to its own message.
 */
export function describeError(t: Translate, has: (key: string) => boolean, error: unknown): string {
  if (error instanceof NetworkError) return t('error.network');
  if (error instanceof ApiError) {
    const info = error.body?.error;
    for (const key of [
      `error.reason.${String(info?.reason)}`,
      `error.code.${String(info?.code)}`,
    ]) {
      if (info && has(key)) return t(key as MessageKey, ERROR_PARAMS);
    }
    return t('error.status', { status: error.status });
  }
  return errorMessage(error);
}
