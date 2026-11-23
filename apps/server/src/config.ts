import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

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
  KM_LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
});

export type Config = z.output<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  return envSchema.parse(env);
}

export function levelConfigPath(config: Config): string {
  return config.KM_LEVEL_CONFIG ?? join(dirname(config.KM_DB_PATH), 'level-config.json');
}
