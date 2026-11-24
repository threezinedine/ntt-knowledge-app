import type {
  ApiErrorBody,
  ApiErrorReason,
  HubLatest,
  HubPairInput,
  HubPairResult,
  HubPushInput,
  HubVersion,
} from '@km/core';
import { AppError, ConflictError } from '../errors.js';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const HEAD_TIMEOUT_MS = 5_000;
const TRANSFER_TIMEOUT_MS = 120_000;

/**
 * Talks to the hub from this device's engine. Every failure becomes an
 * AppError the web app can show: never a 401 (that would look like this
 * server's own sign-in ending), so the hub's refusals are 502s with the
 * hub's reason.
 */
export class HubClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string | null,
    private readonly fetchImpl: FetchLike,
  ) {}

  pair(input: HubPairInput): Promise<HubPairResult> {
    return this.call<HubPairResult>('POST', '/api/hub/pair', input, HEAD_TIMEOUT_MS);
  }

  async head(): Promise<HubVersion | null> {
    return (
      await this.call<{ head: HubVersion | null }>(
        'GET',
        '/api/hub/head',
        undefined,
        HEAD_TIMEOUT_MS,
      )
    ).head;
  }

  /** Raw: the snapshot is checked by the caller. */
  latest(): Promise<HubLatest> {
    return this.call<HubLatest>('GET', '/api/hub/latest', undefined, TRANSFER_TIMEOUT_MS);
  }

  /** The hub's level table (public: it holds no data). */
  config(): Promise<{ levelConfig: unknown }> {
    return this.call<{ levelConfig: unknown }>(
      'GET',
      '/api/hub/config',
      undefined,
      HEAD_TIMEOUT_MS,
    );
  }

  /** The hub forgets this device's token. */
  async revokeSelf(): Promise<void> {
    await this.call<unknown>('DELETE', '/api/hub/devices/self', undefined, HEAD_TIMEOUT_MS);
  }

  push(input: HubPushInput): Promise<HubVersion> {
    return this.call<HubVersion>('POST', '/api/hub/versions', input, TRANSFER_TIMEOUT_MS);
  }

  private async call<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<T> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    let res: Response;
    let text: string;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? null : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      text = await res.text();
    } catch (error) {
      throw hubError('HUB_UNREACHABLE', `Can't reach the hub at ${this.baseUrl}`, error);
    }
    if (res.status === 204) return undefined as T;
    if (res.ok) {
      try {
        return JSON.parse(text) as T;
      } catch {
        throw hubError('HUB_NOT_ENABLED', 'The hub sent something that is not JSON');
      }
    }
    throw this.failure(res.status, parseBody(text));
  }

  private failure(status: number, body: ApiErrorBody['error'] | undefined): AppError {
    const reason = body?.reason;
    if (status === 409 && reason === 'SYNC_BEHIND') {
      return new ConflictError(
        'SYNC_BEHIND',
        body?.message ?? 'The hub has a newer version',
        body?.details,
      );
    }
    if (reason === 'HUB_EMPTY') return new ConflictError('HUB_EMPTY', 'The hub has no version yet');
    if (reason === 'CODE_INVALID' || reason === 'CODE_USED' || reason === 'LOCKED_OUT') {
      return hubError(
        reason,
        body?.message ?? 'The hub refused the code',
        undefined,
        body?.details,
      );
    }
    if (reason === 'HUB_INCOMPATIBLE') return hubError(reason, body?.message ?? 'Incompatible hub');
    if (status === 401) return hubError('HUB_DENIED', 'The hub no longer knows this device');
    if (body?.code === 'FORBIDDEN_HOST') {
      return hubError('HUB_HOST_REFUSED', 'The hub refused its own address (KM_ALLOWED_HOSTS)');
    }
    // A missing route: not a Knowledge Manager hub (or an older one).
    if (status === 404 || body === undefined) {
      return hubError('HUB_NOT_ENABLED', `No hub at ${this.baseUrl} (HTTP ${String(status)})`);
    }
    return new AppError(502, 'BAD_GATEWAY', `The hub answered ${String(status)}: ${body.message}`);
  }
}

function hubError(
  reason: ApiErrorReason,
  message: string,
  cause?: unknown,
  details?: unknown,
): AppError {
  const error = new AppError(502, 'BAD_GATEWAY', message, details, reason);
  if (cause !== undefined) error.cause = cause;
  return error;
}

function parseBody(text: string): ApiErrorBody['error'] | undefined {
  try {
    const json = JSON.parse(text) as Partial<ApiErrorBody> | null;
    return typeof json?.error?.code === 'string' ? json.error : undefined;
  } catch {
    return undefined;
  }
}
