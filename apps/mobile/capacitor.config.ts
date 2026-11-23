import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import type { CapacitorConfig } from '@capacitor/cli';

/**
 * The Android app shows the web app straight from your Knowledge Manager
 * server (the PC), so nothing is duplicated and data is always current. The
 * app runs it read-only (see apps/web/src/features/readOnly.ts).
 *
 * Which server: KM_MOBILE_SERVER_URL, from the environment or the repo-root
 * .env, e.g. http://192.168.1.20:4317. It is baked in at `cap sync`: change
 * it, then sync again and reinstall.
 */
function serverUrl(): string {
  const fromEnv = process.env.KM_MOBILE_SERVER_URL;
  // The Capacitor CLI runs from apps/mobile (and loads this file as CommonJS).
  const envFile = resolve(process.cwd(), '../../.env');
  const fromFile = existsSync(envFile)
    ? parseEnv(readFileSync(envFile, 'utf8')).KM_MOBILE_SERVER_URL
    : undefined;
  const url = (fromEnv ?? fromFile ?? '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+$/.test(url)) {
    throw new Error(
      'Set KM_MOBILE_SERVER_URL in .env to the server the phone should open, ' +
        'e.g. KM_MOBILE_SERVER_URL=http://192.168.1.20:4317 (see README, "Android app").',
    );
  }
  return url;
}

const url = serverUrl();

const config: CapacitorConfig = {
  appId: 'dev.knowledgemanager.viewer',
  appName: 'Knowledge Manager',
  // Only the "can't reach the server" page ships inside the app.
  webDir: 'www',
  server: {
    url,
    // A LAN server is usually plain http; Android blocks that unless allowed.
    cleartext: url.startsWith('http://'),
    errorPath: 'offline.html',
  },
};

export default config;
