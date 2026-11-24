import type { ApiErrorBody } from '@km/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../testing/testApp.js';
import { hostnameOf } from './hostGuard.js';

let t: TestApp;
beforeEach(async () => {
  t = await createTestApp();
});
afterEach(async () => {
  await t.close();
});

describe('host guard (DNS rebinding)', () => {
  it('rejects foreign Host headers and allows loopback', async () => {
    const evil = await t.app.inject({ url: '/api/health', headers: { host: 'evil.example:4317' } });
    expect(evil.statusCode).toBe(403);
    expect(evil.json<ApiErrorBody>().error.code).toBe('FORBIDDEN_HOST');

    for (const host of ['localhost:4317', '127.0.0.1:4317', '[::1]:4317']) {
      const ok = await t.app.inject({ url: '/api/health', headers: { host } });
      expect(ok.statusCode, host).toBe(200);
    }
  });

  it('parses hostnames including IPv6 literals', () => {
    expect(hostnameOf('Example.COM:80')).toBe('example.com');
    expect(hostnameOf('[::1]:4317')).toBe('[::1]');
    expect(hostnameOf('127.0.0.1')).toBe('127.0.0.1');
  });
});

describe('error codes', () => {
  it('distinguishes oversized bodies from validation errors', async () => {
    const res = await t.request<ApiErrorBody>('POST', '/api/hub/pair', {
      code: '',
      name: 'a'.repeat(6 * 1024 * 1024),
    });
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('a route that isn’t there is a JSON 404', async () => {
    const res = await t.request<ApiErrorBody>('GET', '/api/nodes');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
