import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { base32Decode } from './auth/totp.js';

const envSchema = z.object({
  KM_HOST: z.string().default('127.0.0.1'),
  KM_PORT: z.coerce.number().int().min(1).max(65535).default(4317),
  KM_DB_PATH: z.string().default(join(homedir(), '.knowledge-manager', 'km.sqlite')),
  KM_STATIC_DIR: z.string().default(fileURLToPath(new URL('../../web/dist', import.meta.url))),
  /** Comma-separated extra hostnames for the Host-header guard, e.g. "192.168.1.20,km.lan". */
  KM_ALLOWED_HOSTS: z
    .string()
    .default('')
    .transform((v) =>
      v
        .split(',')
        .map((h) => h.trim())
        .filter(Boolean),
    ),
  /** Exit when this process exits (set by the e2e config; see watchParent.ts). */
  KM_PARENT_PID: z.coerce.number().int().positive().optional(),
  /** EXP/level table (JSON). Default: level-config.json next to the database. */
  KM_LEVEL_CONFIG: z.string().optional(),
  /**
   * "totp": sign in with the 6-digit code from an authenticator app
   * (Google Authenticator, …). "off": no sign-in; only for a server nobody
   * else can reach.
   */
  KM_AUTH: z.enum(['totp', 'off']).default('totp'),
  /** Authenticator secret (base32). Create it with `npm run auth:setup`. */
  KM_TOTP_SECRET: z.string().trim().optional(),
  /** How long a sign-in lasts before the app asks for a code again. */
  KM_SESSION_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 365)
    .default(24 * 7),
  /** "true" when users reach the app over HTTPS (reverse proxy): Secure cookie. */
  KM_COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  KM_LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
});

export type Config = z.output<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  return envSchema.parse(env);
}

export interface AuthSettings {
  totpSecret: Buffer;
  sessionTtlMs: number;
  secureCookie: boolean;
}

/**
 * Sign-in settings, or null with KM_AUTH=off. Refuses to start without a
 * usable secret: a typo must never leave the server open.
 */
export function authSettings(config: Config): AuthSettings | null {
  if (config.KM_AUTH === 'off') return null;
  const hint =
    'Run `npm run auth:setup` to create one and add it to your authenticator app, ' +
    'or set KM_AUTH=off in .env for a local-only server.';
  if (!config.KM_TOTP_SECRET) {
    throw new Error(`Sign-in is on (KM_AUTH=totp) but KM_TOTP_SECRET is missing. ${hint}`);
  }
  let totpSecret: Buffer;
  try {
    totpSecret = base32Decode(config.KM_TOTP_SECRET);
  } catch {
    throw new Error(`KM_TOTP_SECRET is not valid base32. ${hint}`);
  }
  if (totpSecret.length < 16) {
    throw new Error(`KM_TOTP_SECRET is too short (needs 128+ bits). ${hint}`);
  }
  return {
    totpSecret,
    sessionTtlMs: config.KM_SESSION_HOURS * 60 * 60 * 1000,
    secureCookie: config.KM_COOKIE_SECURE,
  };
}

export function levelConfigPath(config: Config): string {
  return config.KM_LEVEL_CONFIG ?? join(dirname(config.KM_DB_PATH), 'level-config.json');
}
