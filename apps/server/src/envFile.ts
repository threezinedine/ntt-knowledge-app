import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

/** The repo-root .env, where the server and `npm run auth:setup` keep secrets. */
export const DEFAULT_ENV_FILE = new URL('../../../.env', import.meta.url);

export function envPath(file: string | URL): string {
  return file instanceof URL ? fileURLToPath(file) : file;
}

/**
 * Loads KEY=value pairs from a .env file into `env`, never overriding a
 * variable that is already set (so the e2e config, Docker or the shell win).
 * Returns the path it loaded, or null when there is no such file.
 */
export function loadEnvFile(
  file: string | URL,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const path = envPath(file);
  if (!existsSync(path)) return null;
  for (const [key, value] of Object.entries(parseEnv(readFileSync(path, 'utf8')))) {
    if (env[key] === undefined) env[key] = value;
  }
  return path;
}

/**
 * Sets `KEY=value` lines in .env text: replaces the first live (uncommented)
 * line for each key, or appends one. Comments and other lines stay as they
 * are. Values must not need quoting (base32, words).
 */
export function setEnvValues(text: string, values: Readonly<Record<string, string>>): string {
  const lines = text === '' ? [] : text.replace(/\r?\n$/, '').split(/\r?\n/);
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const at = lines.findIndex((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
    if (at === -1) lines.push(line);
    else lines[at] = line;
  }
  return `${lines.join('\n')}\n`;
}
