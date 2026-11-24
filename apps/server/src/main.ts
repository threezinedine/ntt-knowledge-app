import { buildApp } from './app.js';
import { authSettings, levelConfigPath, loadConfig } from './config.js';
import { hasUnversionedGraph, seedFirstVersion } from './seed.js';
import { openDatabase } from './db/database.js';
import { loadLevelConfig } from './levelConfig.js';
import { DEFAULT_ENV_FILE, loadEnvFile } from './envFile.js';
import { watchParent } from './watchParent.js';

// Secrets live in the repo-root .env (gitignored); real env vars win over it.
const envFile = loadEnvFile(process.env.KM_ENV_FILE ?? DEFAULT_ENV_FILE);
const config = loadConfig(process.env);
const auth = authSettings(config); // throws (stops startup) if half-configured
const levelPath = levelConfigPath(config);
const level = loadLevelConfig(levelPath); // throws (stops startup) if the file is broken
const db = openDatabase(config.KM_DB_PATH);
const app = await buildApp({
  db,
  staticDir: config.KM_STATIC_DIR,
  // A concrete bind address (not a wildcard) is always a legitimate Host.
  allowedHosts: [
    ...config.KM_ALLOWED_HOSTS,
    ...(['0.0.0.0', '::'].includes(config.KM_HOST) ? [] : [config.KM_HOST]),
  ],
  logger: { level: config.KM_LOG_LEVEL },
  levelConfig: level.config,
  auth: auth ?? undefined,
  hub: { keepVersions: config.KM_HUB_KEEP_VERSIONS },
});
if (envFile) app.log.info({ path: envFile }, 'Loaded .env');
if (auth) {
  app.log.info('Pairing a device needs the authenticator code');
} else {
  app.log.warn('KM_AUTH=off: anyone who can reach this server can pair a device and push');
}
app.log.info({ path: levelPath, source: level.source }, 'Level config loaded');
const seeded = seedFirstVersion(db);
if (seeded) {
  app.log.info({ version: seeded.version }, "This server's graph became the first version");
} else if (hasUnversionedGraph(db)) {
  app.log.warn(
    "This server's own graph tables hold data that is in no hub version (edited here before " +
      'the hub took over). Devices cannot pull it; it is left untouched in the database.',
  );
}

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'Shutting down');
  await app.close();
  db.close();
}
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
if (config.KM_PARENT_PID !== undefined) {
  watchParent(config.KM_PARENT_PID, () => void shutdown('parent exited'));
}

await app.listen({ host: config.KM_HOST, port: config.KM_PORT });
app.log.info({ db: config.KM_DB_PATH }, 'Knowledge Manager ready');
