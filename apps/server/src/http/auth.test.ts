import type { AuthStatus } from '@km/core';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { DAILY_BUDGET, MAX_CONSECUTIVE, PAUSE_MS } from '../auth/loginGuard.js';
import { base32Decode, hotp, stepAt } from '../auth/totp.js';
import { createTestApp, type TestApp } from '../testing/testApp.js';
import { SESSION_COOKIE } from './auth.js';

const HOUR = 60 * 60 * 1000;
const SECRET = base32Decode('JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP');
/** createTestApp's fake clock starts here. */
const START = 1_700_000_000_000;

let t: TestApp;
let clock = START;
afterEach(async () => {
  await t.close();
});

async function withAuth(sessionTtlMs = 24 * HOUR, secureCookie = false) {
  t = await createTestApp({ auth: { totpSecret: SECRET, sessionTtlMs, secureCookie } });
  clock = START;
}
const tick = (ms: number) => {
  t.tick(ms);
  clock += ms;
};
/** The code an authenticator app shows right now (step offset optional). */
const codeNow = (offset = 0) => hotp(SECRET, stepAt(clock) + offset);
const login = (code: string) =>
  t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { code } });
const sessionOf = (res: LightMyRequestResponse) =>
  res.cookies.find((c) => c.name === SESSION_COOKIE);
const withSession = (token: string) => ({ cookies: { [SESSION_COOKIE]: token } });

describe('auth off (KM_AUTH=off)', () => {
  it('reports disabled and leaves the API open', async () => {
    t = await createTestApp();
    expect((await t.request<AuthStatus>('GET', '/api/auth/status')).body).toEqual({
      enabled: false,
      signedIn: false,
      expiresAt: null,
      readOnly: false,
    });
    expect((await t.request('GET', '/api/nodes')).status).toBe(200);
    expect((await t.request('POST', '/api/auth/login', { code: '123456' })).status).toBe(404);
  });
});

describe('sign-in with an authenticator code', () => {
  it('locks the API until signed in, but not health or status', async () => {
    await withAuth();
    const res = await t.request<{ error: { code: string } }>('GET', '/api/nodes');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect((await t.request('GET', '/api/health')).status).toBe(200);
    expect((await t.request<AuthStatus>('GET', '/api/auth/status')).body).toEqual({
      enabled: true,
      signedIn: false,
      expiresAt: null,
      readOnly: false,
    });
  });

  it('the current code signs in: an httpOnly session cookie that opens the API', async () => {
    await withAuth();
    const res = await login(codeNow());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      enabled: true,
      signedIn: true,
      expiresAt: START + 24 * HOUR,
      readOnly: false,
    });
    const cookie = sessionOf(res);
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });
    expect(cookie?.maxAge).toBe(24 * 60 * 60);
    expect(cookie?.secure).toBeFalsy(); // plain http (local); Secure over https

    const session = withSession(cookie?.value ?? '');
    expect((await t.app.inject({ method: 'GET', url: '/api/nodes', ...session })).statusCode).toBe(
      200,
    );
    const status = await t.app.inject({ method: 'GET', url: '/api/auth/status', ...session });
    expect(status.json()).toMatchObject({ signedIn: true, expiresAt: START + 24 * HOUR });
  });

  it('accepts the neighbouring step (clock drift), not further', async () => {
    await withAuth();
    expect((await login(codeNow(-2))).statusCode).toBe(401);
    expect((await login(codeNow(1))).statusCode).toBe(200);
  });

  it('a wrong code is a 401 with a reason, and sets no cookie', async () => {
    await withAuth();
    const res = await login(codeNow() === '000000' ? '111111' : '000000');
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: { code: 'UNAUTHORIZED', reason: 'CODE_INVALID' } });
    expect(sessionOf(res)).toBeUndefined();
  });

  it('malformed input is a 400', async () => {
    await withAuth();
    for (const payload of [{ code: '12345' }, { code: 'abcdef' }, {}, { code: '123456', x: 1 }]) {
      const res = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload });
      expect(res.statusCode).toBe(400);
    }
  });

  it('a code works only once (no replay)', async () => {
    await withAuth();
    const code = codeNow();
    expect((await login(code)).statusCode).toBe(200);
    const again = await login(code);
    expect(again.statusCode).toBe(401);
    expect(again.json()).toMatchObject({ error: { reason: 'CODE_USED' } });
    tick(30_000); // the next code is fine
    expect((await login(codeNow())).statusCode).toBe(200);
  });

  it('pauses after wrong codes in a row, then rations them per day', async () => {
    await withAuth();
    const wrong = codeNow() === '000000' ? '111111' : '000000';
    for (let i = 1; i < MAX_CONSECUTIVE; i++) expect((await login(wrong)).statusCode).toBe(401);
    const paused = await login(wrong);
    expect(paused.statusCode).toBe(429);
    expect(paused.json()).toMatchObject({
      error: {
        code: 'TOO_MANY_REQUESTS',
        reason: 'LOCKED_OUT',
        details: { retryAfterMs: PAUSE_MS },
      },
    });
    expect(paused.headers['retry-after']).toBe('60');
    expect((await login(codeNow())).statusCode).toBe(429); // even the right code waits

    tick(PAUSE_MS);
    expect((await login(codeNow())).statusCode).toBe(200); // signing in...
    tick(30_000);
    for (let i = MAX_CONSECUTIVE; i < DAILY_BUDGET; i++) await login(wrong);
    // ...didn't give the guesser a fresh budget: spent for the day.
    tick(PAUSE_MS);
    const spent = await login(codeNow());
    expect(spent.statusCode).toBe(429);
    const { retryAfterMs } = spent.json<{ error: { details: { retryAfterMs: number } } }>().error
      .details;
    expect(retryAfterMs).toBeGreaterThan(20 * HOUR);
  });

  it('marks the cookie Secure when told the app is served over HTTPS', async () => {
    await withAuth(24 * HOUR, true);
    expect(sessionOf(await login(codeNow()))?.secure).toBe(true);
  });

  it('a read-only sign-in (the phone app) can read but never write', async () => {
    await withAuth();
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { code: codeNow(), readOnly: true },
    });
    expect(res.json()).toMatchObject({ signedIn: true, readOnly: true });
    const session = withSession(sessionOf(res)?.value ?? '');

    const read = (url: string) => t.app.inject({ method: 'GET', url, ...session });
    for (const url of ['/api/nodes', '/api/graph', '/api/tags', '/api/exp', '/api/relations']) {
      expect((await read(url)).statusCode).toBe(200);
    }
    const status = await read('/api/auth/status');
    expect(status.json()).toMatchObject({ signedIn: true, readOnly: true });

    const writes = [
      { method: 'POST', url: '/api/nodes', payload: { title: 'x' } },
      { method: 'PATCH', url: '/api/nodes/positions', payload: { items: [] } },
      { method: 'POST', url: '/api/tags', payload: { name: 't', parentId: null } },
      { method: 'DELETE', url: '/api/nodes/01890000-0000-7000-8000-000000000000' },
      { method: 'POST', url: '/%61pi/nodes', payload: { title: 'x' } },
    ] as const;
    for (const w of writes) {
      const r = await t.app.inject({ ...w, ...session });
      expect(r.statusCode, `${w.method} ${w.url}`).toBe(403);
      expect(r.json()).toMatchObject({ error: { code: 'FORBIDDEN', reason: 'READ_ONLY' } });
    }
    expect((await t.request<unknown[]>('GET', '/api/nodes')).status).toBe(401); // no cookie

    // Signing out still works.
    const out = await t.app.inject({ method: 'POST', url: '/api/auth/logout', ...session });
    expect(out.statusCode).toBe(204);
    expect((await read('/api/nodes')).statusCode).toBe(401);
  });

  it('signing out ends the session at once', async () => {
    await withAuth();
    const session = withSession(sessionOf(await login(codeNow()))?.value ?? '');
    const out = await t.app.inject({ method: 'POST', url: '/api/auth/logout', ...session });
    expect(out.statusCode).toBe(204);
    expect(sessionOf(out)?.value).toBe('');
    expect((await t.app.inject({ method: 'GET', url: '/api/nodes', ...session })).statusCode).toBe(
      401,
    );
  });

  it('a session ends when its time is up', async () => {
    await withAuth(HOUR);
    const session = withSession(sessionOf(await login(codeNow()))?.value ?? '');
    const get = () => t.app.inject({ method: 'GET', url: '/api/tags', ...session });
    tick(HOUR - 1);
    expect((await get()).statusCode).toBe(200);
    tick(1);
    expect((await get()).statusCode).toBe(401);
  });

  it('a made-up session cookie gets nowhere', async () => {
    await withAuth();
    const res = await t.app.inject({ method: 'GET', url: '/api/nodes', ...withSession('nope') });
    expect(res.statusCode).toBe(401);
  });

  it.each([
    ['GET', '/%61pi/nodes'],
    ['GET', '/%2561pi/nodes'],
    ['GET', '/api/nodes%2F..'],
    ['GET', '/%61pi/graph'],
    ['GET', '/api/%6eodes'],
    ['GET', '/api/health/../nodes'],
    ['POST', '/%61pi/nodes'],
  ] as const)('a disguised path cannot dodge the lock: %s %s', async (method, url) => {
    await withAuth();
    const res = await t.app.inject({
      method,
      url,
      ...(method === 'POST' ? { payload: { title: 'pwned' } } : {}),
    });
    // 401 when it reaches an API route, 404 when it matches nothing; never data.
    expect([401, 404]).toContain(res.statusCode);
  });
});
