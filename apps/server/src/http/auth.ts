import fastifyCookie from '@fastify/cookie';
import { loginInputSchema, type AuthStatus } from '@km/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { LoginGuard } from '../auth/loginGuard.js';
import { ForbiddenError, TooManyRequestsError, UnauthorizedError } from '../errors.js';
import type { LiveSession, SessionRepository } from '../repositories/sessionRepository.js';
import { HUB_ROUTE_PREFIX } from './routes/hubRoutes.js';
import { parse } from './validation.js';

export interface AuthOptions {
  /** The authenticator secret (raw bytes, decoded from KM_TOTP_SECRET). */
  totpSecret: Buffer;
  /** How long a sign-in lasts; after that the app asks for a code again. */
  sessionTtlMs: number;
  /**
   * Mark the session cookie Secure (HTTPS only). Set it when the app is served
   * over HTTPS, e.g. behind a reverse proxy: Node itself only speaks HTTP here,
   * so it can't tell on its own.
   */
  secureCookie: boolean;
}

export const SESSION_COOKIE = 'km_session';

/** All a read-only session may do (besides signing out). */
const READ_METHODS = new Set(['GET', 'HEAD']);

/**
 * Route *patterns* reachable without a session: signing in and out, the
 * status the web app asks first, and the health check. Matched against the
 * route Fastify actually picked, never the raw URL: the router percent-decodes
 * paths, so a string check on the URL could be dodged with `/%61pi/nodes`.
 */
const PUBLIC_API = new Set([
  '/api/health',
  '/api/auth/status',
  '/api/auth/login',
  '/api/auth/logout',
]);

/**
 * Sign-in with the 6-digit code from an authenticator app (TOTP), then a
 * server-side session in an httpOnly cookie. With `auth` undefined
 * (KM_AUTH=off) every route stays open and /api/auth/status says so.
 *
 * Returns the wrong-code rationing, which the hub's pairing shares (one
 * budget of guesses per server, whichever door they knock on).
 */
export async function registerAuth(
  app: FastifyInstance,
  sessions: SessionRepository,
  auth: AuthOptions | undefined,
  now: () => number,
): Promise<LoginGuard | undefined> {
  await app.register(fastifyCookie);

  const liveSession = (request: FastifyRequest): LiveSession | undefined => {
    const token = request.cookies[SESSION_COOKIE];
    return token ? sessions.find(token) : undefined;
  };

  app.get('/api/auth/status', (request): AuthStatus => {
    if (!auth) return { enabled: false, signedIn: false, expiresAt: null, readOnly: false };
    const session = liveSession(request);
    return {
      enabled: true,
      signedIn: session !== undefined,
      expiresAt: session?.expiresAt ?? null,
      readOnly: session?.readOnly ?? false,
    };
  });

  if (!auth) return undefined;

  const guard = new LoginGuard(auth.totpSecret, now);
  const setSessionCookie = (reply: FastifyReply, token: string) =>
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/',
      httpOnly: true,
      sameSite: 'strict', // never sent on a cross-site request
      secure: auth.secureCookie,
      maxAge: Math.floor(auth.sessionTtlMs / 1000),
    });

  // Deny by default: every API route needs a live session unless listed in
  // PUBLIC_API. Decided on the matched route (the router has already run);
  // unmatched requests fall through to the 404 handler, which serves no data.
  // Runs after the Host guard.
  app.addHook('onRequest', (request, _reply, done) => {
    const route = request.routeOptions.url;
    if (route === undefined || !route.startsWith('/api') || PUBLIC_API.has(route)) {
      done();
      return;
    }
    // Hub routes check a device token instead (and only exist with KM_HUB=on).
    if (route.startsWith(HUB_ROUTE_PREFIX)) {
      done();
      return;
    }
    const session = liveSession(request);
    if (!session) {
      done(new UnauthorizedError());
      return;
    }
    // A read-only session (the phone app) can look but never change anything.
    if (session.readOnly && !READ_METHODS.has(request.method)) {
      done(new ForbiddenError('READ_ONLY', 'This sign-in can only read'));
      return;
    }
    done();
  });

  app.post('/api/auth/login', (request, reply) => {
    const { code, readOnly = false } = parse(loginInputSchema, request.body);
    const result = guard.check(code);
    if (!result.ok) {
      if (result.reason === 'locked') {
        request.log.warn(
          { retryAfterMs: result.retryAfterMs },
          'Sign-in locked: too many wrong codes',
        );
        void reply.header('Retry-After', Math.ceil(result.retryAfterMs / 1000));
        throw new TooManyRequestsError(
          'LOCKED_OUT',
          'Too many wrong codes; try again later',
          result.retryAfterMs,
        );
      }
      if (result.reason === 'reused') {
        throw new UnauthorizedError('CODE_USED', 'That code was just used; wait for the next one');
      }
      throw new UnauthorizedError('CODE_INVALID', 'Wrong or expired code');
    }
    const session = sessions.create(auth.sessionTtlMs, readOnly);
    setSessionCookie(reply, session.token);
    request.log.info({ readOnly }, 'Signed in');
    return {
      enabled: true,
      signedIn: true,
      expiresAt: session.expiresAt,
      readOnly,
    } satisfies AuthStatus;
  });

  app.post('/api/auth/logout', (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) sessions.revoke(token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.status(204).send();
  });
  return guard;
}
