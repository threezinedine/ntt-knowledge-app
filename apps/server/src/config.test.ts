import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { authSettings, loadConfig } from './config.js';
import { loadEnvFile, setEnvValues } from './envFile.js';

const SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP'; // 160 bits

describe('authSettings', () => {
  it('is null with KM_AUTH=off', () => {
    expect(authSettings(loadConfig({ KM_AUTH: 'off' }))).toBeNull();
  });

  it('is on by default, and refuses to start without a usable secret', () => {
    expect(() => authSettings(loadConfig({}))).toThrow(/KM_TOTP_SECRET is missing.*auth:setup/);
    expect(() => authSettings(loadConfig({ KM_TOTP_SECRET: 'not base32!' }))).toThrow(
      /not valid base32/,
    );
    expect(() => authSettings(loadConfig({ KM_TOTP_SECRET: 'JBSWY3DP' }))).toThrow(/too short/);
  });

  it('decodes the secret and turns hours into a lifetime', () => {
    const auth = authSettings(loadConfig({ KM_TOTP_SECRET: SECRET, KM_SESSION_HOURS: '12' }));
    expect(auth?.totpSecret).toHaveLength(20);
    expect(auth?.sessionTtlMs).toBe(12 * 60 * 60 * 1000);
    expect(authSettings(loadConfig({ KM_TOTP_SECRET: SECRET }))?.sessionTtlMs).toBe(
      7 * 24 * 60 * 60 * 1000,
    );
  });

  it('rejects an unknown mode (e.g. the old "google")', () => {
    expect(() => loadConfig({ KM_AUTH: 'google' })).toThrow();
  });
});

describe('loadEnvFile', () => {
  it('fills unset variables only, and tolerates a missing file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'km-env-'));
    const file = join(dir, '.env');
    writeFileSync(file, '# comment\nA=from-file\nB="quoted value"\n');
    const env: NodeJS.ProcessEnv = { A: 'from-shell' };
    expect(loadEnvFile(file, env)).toBe(file);
    expect(env).toEqual({ A: 'from-shell', B: 'quoted value' });
    expect(loadEnvFile(join(dir, 'nope'), env)).toBeNull();
  });
});

describe('setEnvValues', () => {
  it('replaces live lines in place, keeps comments, appends new keys', () => {
    const before = '# Sign-in\n# KM_AUTH=totp\nKM_AUTH=off\nOTHER=1\r\n';
    expect(setEnvValues(before, { KM_AUTH: 'totp', KM_TOTP_SECRET: 'ABC' })).toBe(
      '# Sign-in\n# KM_AUTH=totp\nKM_AUTH=totp\nOTHER=1\nKM_TOTP_SECRET=ABC\n',
    );
    expect(setEnvValues('', { A: '1' })).toBe('A=1\n');
    expect(setEnvValues('KM_TOTP_SECRET=\n', { KM_TOTP_SECRET: 'X' })).toBe('KM_TOTP_SECRET=X\n');
  });
});
