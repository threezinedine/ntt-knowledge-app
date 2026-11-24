import type { HubVersion } from '@km/core';
import type { RepoContext } from './context.js';

/** This device's link to a hub (the `sync_state` row), if any. */
export interface SyncLink {
  hubUrl: string;
  deviceName: string;
  /** Sent to the hub as a bearer token. */
  token: string;
  /** The version last pushed or pulled. */
  synced: HubVersion | null;
}

interface StateRow {
  hub_url: string;
  device_name: string;
  token: string;
  version: number | null;
  hash: string | null;
  version_created_at: number | null;
  version_device: string | null;
}

export type SyncRepository = ReturnType<typeof createSyncRepository>;

export function createSyncRepository({ db, now }: RepoContext) {
  const select = db.prepare(
    `SELECT hub_url, device_name, token, version, hash, version_created_at, version_device
       FROM sync_state WHERE id = 1`,
  );
  const upsert = db.prepare(
    `INSERT INTO sync_state (id, hub_url, device_name, token, updated_at)
     VALUES (1, :hub_url, :device_name, :token, :ts)
     ON CONFLICT (id) DO UPDATE SET hub_url = :hub_url, device_name = :device_name, token = :token,
       version = NULL, hash = NULL, version_created_at = NULL, version_device = NULL, updated_at = :ts`,
  );
  const setSynced = db.prepare(
    `UPDATE sync_state SET version = :version, hash = :hash, version_created_at = :created_at,
       version_device = :device, updated_at = :ts WHERE id = 1`,
  );
  // Device-local, not synced data: a link is simply removed.
  const remove = db.prepare('DELETE FROM sync_state');

  return {
    get(): SyncLink | undefined {
      const row = select.get() as StateRow | undefined;
      if (!row) return undefined;
      const synced =
        row.version !== null && row.hash !== null
          ? {
              version: row.version,
              hash: row.hash,
              createdAt: row.version_created_at ?? 0,
              deviceName: row.version_device ?? '',
            }
          : null;
      return { hubUrl: row.hub_url, deviceName: row.device_name, token: row.token, synced };
    },

    /** A new link starts with nothing synced. */
    connect(hubUrl: string, deviceName: string, token: string): void {
      upsert.run({ hub_url: hubUrl, device_name: deviceName, token, ts: now() });
    },

    markSynced(version: HubVersion): void {
      setSynced.run({
        version: version.version,
        hash: version.hash,
        created_at: version.createdAt,
        device: version.deviceName,
        ts: now(),
      });
    },

    disconnect(): void {
      remove.run();
    },
  };
}
