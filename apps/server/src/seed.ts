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
