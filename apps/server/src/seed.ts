import { newId, type HubVersion } from '@km/core';
import {
  canonicalSnapshotJson,
  isEmptySnapshot,
  readSnapshot,
  snapshotHash,
  type Database,
} from '@km/engine';
import { createHubRepository } from './repositories/hubRepository.js';

/**
 * Once, when a server from before sync-by-hub starts: the graph it holds in
 * its own tables (where the web app used to edit it) becomes the hub's first
 * version, so every device can pull it. Afterwards those tables are unused.
 */
export function seedFirstVersion(db: Database, now: () => number = Date.now): HubVersion | null {
  const hub = createHubRepository({ db, now, newId });
  if (hub.head() !== null) return null;
  const snapshot = readSnapshot(db);
  if (isEmptySnapshot(snapshot)) return null;
  const json = canonicalSnapshotJson(snapshot);
  return hub.add(
    {
      hash: snapshotHash(json),
      json,
      baseVersion: null,
      device: { id: 'server', name: 'Server (existing data)', readOnly: false },
    },
    Number.MAX_SAFE_INTEGER,
  );
}

/**
 * True when this server's own graph tables hold data that is in none of the
 * hub's versions (edited here before the hub took over, after versions already
 * existed). Nothing is lost, but no device can pull it: the log says so.
 */
export function hasUnversionedGraph(db: Database): boolean {
  const snapshot = readSnapshot(db);
  if (isEmptySnapshot(snapshot)) return false;
  const hash = snapshotHash(canonicalSnapshotJson(snapshot));
  const row = db.prepare('SELECT 1 AS x FROM hub_versions WHERE hash = ?').get(hash);
  return row === undefined;
}
