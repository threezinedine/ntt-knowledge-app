import type { RepoContext } from './context.js';

export type SettingsRepository = ReturnType<typeof createSettingsRepository>;

/** Device-local key/value settings (e.g. the hub's level table); never synced. */
export function createSettingsRepository({ db, now }: RepoContext) {
  const select = db.prepare('SELECT value FROM device_settings WHERE key = ?');
  const upsert = db.prepare(
    `INSERT INTO device_settings (key, value, updated_at) VALUES (:key, :value, :ts)
     ON CONFLICT (key) DO UPDATE SET value = :value, updated_at = :ts`,
  );
  return {
    get(key: string): string | undefined {
      return (select.get(key) as { value: string } | undefined)?.value;
    },
    set(key: string, value: string): void {
      upsert.run({ key, value, ts: now() });
    },
  };
}
