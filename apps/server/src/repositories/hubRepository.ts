import { gunzipSync, gzipSync } from 'node:zlib';
import { SNAPSHOT_FORMAT, type HubVersion } from '@km/core';
import { transaction } from '../db/database.js';
import type { RepoContext } from './context.js';
import { hashToken, newSessionToken } from './sessionRepository.js';

/** A device paired with this hub. */
export interface HubDevice {
  id: string;
  name: string;
  readOnly: boolean;
}

interface VersionRow {
  version: number;
  hash: string;
  created_at: number;
  device_name: string;
}

const toVersion = (row: VersionRow): HubVersion => ({
  version: row.version,
  hash: row.hash,
  createdAt: row.created_at,
  deviceName: row.device_name,
});

export type HubRepository = ReturnType<typeof createHubRepository>;

/** The hub's side of sync: paired devices and the numbered versions. */
export function createHubRepository({ db, now, newId }: RepoContext) {
  const insertDevice = db.prepare(
    `INSERT INTO hub_devices (id, name, token_hash, read_only, created_at, updated_at)
     VALUES (:id, :name, :token_hash, :read_only, :ts, :ts)`,
  );
  const selectDevice = db.prepare(
    'SELECT id, name, read_only FROM hub_devices WHERE token_hash = ? AND deleted_at IS NULL',
  );
  const softDeleteDevice = db.prepare(
    'UPDATE hub_devices SET deleted_at = :ts, updated_at = :ts WHERE id = :id AND deleted_at IS NULL',
  );
  const selectDevices = db.prepare(
    `SELECT id, name, read_only, created_at FROM hub_devices
      WHERE deleted_at IS NULL ORDER BY created_at`,
  );
  const VERSION_COLUMNS = 'version, hash, created_at, device_name';
  const selectHead = db.prepare(
    `SELECT ${VERSION_COLUMNS} FROM hub_versions ORDER BY version DESC LIMIT 1`,
  );
  const selectHeadSnapshot = db.prepare(
    `SELECT ${VERSION_COLUMNS}, format, snapshot FROM hub_versions ORDER BY version DESC LIMIT 1`,
  );
  const insertVersion = db.prepare(
    `INSERT INTO hub_versions
       (version, hash, base_version, device_id, device_name, format, size_bytes, snapshot, created_at)
     VALUES (:version, :hash, :base_version, :device_id, :device_name, :format, :size, :snapshot, :ts)`,
  );
  const prune = db.prepare('DELETE FROM hub_versions WHERE version <= ?');

  function head(): HubVersion | null {
    const row = selectHead.get() as VersionRow | undefined;
    return row ? toVersion(row) : null;
  }

  return {
    /** Pairs a device; returns the token it sends from now on (only its hash is kept). */
    pair(name: string, readOnly: boolean): string {
      const token = newSessionToken();
      const ts = now();
      insertDevice.run({
        id: newId(),
        name,
        token_hash: hashToken(token),
        read_only: readOnly ? 1 : 0,
        ts,
      });
      return token;
    },

    findDevice(token: string): HubDevice | undefined {
      const row = selectDevice.get(hashToken(token)) as
        { id: string; name: string; read_only: number } | undefined;
      return row && { id: row.id, name: row.name, readOnly: row.read_only === 1 };
    },

    /** Its token stops working at once. Returns whether there was such a device. */
    revoke(id: string): boolean {
      return softDeleteDevice.run({ id, ts: now() }).changes > 0;
    },

    devices(): (HubDevice & { createdAt: number })[] {
      return (
        selectDevices.all() as { id: string; name: string; read_only: number; created_at: number }[]
      ).map((r) => ({
        id: r.id,
        name: r.name,
        readOnly: r.read_only === 1,
        createdAt: r.created_at,
      }));
    },

    head,

    /** The newest version and its snapshot's canonical JSON. */
    latest(): { head: HubVersion; format: string; json: string } | null {
      const row = selectHeadSnapshot.get() as
        (VersionRow & { format: string; snapshot: Uint8Array }) | undefined;
      if (!row) return null;
      return {
        head: toVersion(row),
        format: row.format,
        json: gunzipSync(row.snapshot).toString('utf8'),
      };
    },

    /**
     * Adds the next version. Keeps the newest `keep`; older ones are dropped.
     * The caller has checked the push against the head (in this transaction).
     */
    add(
      input: { hash: string; json: string; baseVersion: number | null; device: HubDevice },
      keep: number,
    ): HubVersion {
      return transaction(db, () => {
        const version = (head()?.version ?? 0) + 1;
        const ts = now();
        insertVersion.run({
          version,
          hash: input.hash,
          base_version: input.baseVersion,
          device_id: input.device.id,
          device_name: input.device.name,
          format: SNAPSHOT_FORMAT,
          size: Buffer.byteLength(input.json),
          snapshot: gzipSync(input.json),
          ts,
        });
        prune.run(version - keep);
        return { version, hash: input.hash, createdAt: ts, deviceName: input.device.name };
      });
    },
  };
}
