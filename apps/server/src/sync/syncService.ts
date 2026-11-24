import { hostname } from 'node:os';
import {
  SNAPSHOT_FORMAT,
  snapshotSchema,
  type ApiErrorReason,
  type HubVersion,
  type SyncConnectInput,
  type SyncStatus,
} from '@km/core';
import { createBackup } from '../backup/backup.js';
import type { Database } from '../db/database.js';
import { AppError, ConflictError } from '../errors.js';
import type { Repositories } from '../repositories/index.js';
import {
  canonicalSnapshotJson,
  isEmptySnapshot,
  readSnapshot,
  replaceWithSnapshot,
  snapshotFingerprint,
  snapshotHash,
} from '../repositories/snapshotRepository.js';
import type { SyncLink } from '../repositories/syncRepository.js';
import { HubClient, type FetchLike } from './hubClient.js';

export interface SyncServiceOptions {
  db: Database;
  repos: Repositories;
  /** Where the copy taken before an overwriting pull goes; none in some tests. */
  backupDir: string | undefined;
  now: () => number;
  fetch: FetchLike;
}

export const PULL_BACKUP_PREFIX = 'km-before-pull-';

/**
 * This device's side of sync (see @km/core sync.ts): pair with a hub, push
 * this device's data as the hub's newest version, or pull the newest version
 * over this device's data. Both refuse to overwrite silently: the caller
 * passes `force` once the user has confirmed.
 */
export function createSyncService({ db, repos, backupDir, now, fetch }: SyncServiceOptions) {
  const client = (link: SyncLink) => new HubClient(link.hubUrl, link.token, fetch);

  const requireLink = (): SyncLink => {
    const link = repos.sync.get();
    if (!link)
      throw new ConflictError('SYNC_NOT_CONNECTED', 'This device is not connected to a hub');
    return link;
  };

  const isChanged = (link: SyncLink, hash: string, empty: boolean) =>
    link.synced === null ? !empty : link.synced.hash !== hash;

  // The status poll (every minute, per tab) mustn't re-read the whole graph.
  let hashCache: { fingerprint: string; hash: string; empty: boolean } | null = null;

  /** This device's data now, and whether it differs from what was last synced. */
  const local = (link: SyncLink) => {
    const snapshot = readSnapshot(db);
    const hash = snapshotHash(canonicalSnapshotJson(snapshot));
    const empty = isEmptySnapshot(snapshot);
    hashCache = { fingerprint: snapshotFingerprint(db), hash, empty };
    return { snapshot, hash, changed: isChanged(link, hash, empty) };
  };

  const localHash = (): { hash: string; empty: boolean } => {
    const fingerprint = snapshotFingerprint(db);
    if (hashCache?.fingerprint !== fingerprint) {
      const snapshot = readSnapshot(db);
      hashCache = {
        fingerprint,
        hash: snapshotHash(canonicalSnapshotJson(snapshot)),
        empty: isEmptySnapshot(snapshot),
      };
    }
    return hashCache;
  };

  /**
   * Never synced (just connected, or a restored backup), but the data is
   * exactly the hub's newest version: that is in sync, not a conflict.
   * So GET /api/sync/status may write, even for a read-only session: only
   * this device's own sync_state, never the graph.
   */
  const adoptIfSame = (link: SyncLink, hub: HubVersion | null, hash: string): SyncLink => {
    if (link.synced !== null || hub === null || hub.hash !== hash) return link;
    repos.sync.markSynced(hub);
    return { ...link, synced: hub };
  };

  const statusOf = (
    link: SyncLink,
    localChanged: boolean,
    hub: HubVersion | null,
    problem: ApiErrorReason | null,
  ): SyncStatus => ({
    connected: true,
    hubUrl: link.hubUrl,
    deviceName: link.deviceName,
    synced: link.synced,
    localChanged,
    problem,
    hub,
  });

  async function status(): Promise<SyncStatus> {
    const link = repos.sync.get();
    if (!link) return { connected: false, suggestedName: hostname() };
    let head: HubVersion | null;
    try {
      head = await client(link).head();
    } catch (error) {
      // Hub trouble is a state to show, never a failed status (the title bar needs one).
      if (!(error instanceof AppError)) throw error;
      const { hash, empty } = localHash();
      return statusOf(link, isChanged(link, hash, empty), null, error.reason ?? 'HUB_ERROR');
    }
    // Read after the await: what this device has now, not before the hub answered.
    const { hash, empty } = localHash();
    const current = adoptIfSame(link, head, hash);
    return statusOf(current, isChanged(current, hash, empty), head, null);
  }

  /** Tells the hub to forget a token (best effort: offline, it just stays valid). */
  const revoke = async (link: SyncLink) => {
    try {
      await client(link).revokeSelf();
    } catch {
      // The hub's owner can still remove it: npm run hub:devices.
    }
  };

  async function connect(input: SyncConnectInput): Promise<SyncStatus> {
    const hubUrl = input.hubUrl;
    const { token } = await new HubClient(hubUrl, null, fetch).pair({
      code: input.code,
      name: input.deviceName,
      readOnly: false,
    });
    const previous = repos.sync.get();
    repos.sync.connect(hubUrl, input.deviceName, token);
    if (previous) await revoke(previous); // one live token per device
    return status();
  }

  async function push(force: boolean): Promise<SyncStatus> {
    const link = requireLink();
    const { snapshot, hash } = local(link);
    const version = await client(link).push({
      baseVersion: link.synced?.version ?? null,
      baseHash: link.synced?.hash ?? null,
      force,
      snapshot,
    });
    // The hub hashes the same canonical JSON; a mismatch means a bug, not a race.
    if (version.hash !== hash) {
      throw new AppError(502, 'BAD_GATEWAY', 'The hub stored different data than was sent');
    }
    repos.sync.markSynced(version);
    return statusOf(requireLink(), false, version, null);
  }

  async function pull(force: boolean): Promise<SyncStatus> {
    const link = requireLink();
    const mine = local(link);
    if (mine.changed && !force) {
      throw new ConflictError(
        'SYNC_LOCAL_CHANGES',
        'This device has changes the hub does not; pulling would replace them',
      );
    }
    const latest = await client(link).latest();
    const raw = latest.snapshot as { format?: unknown } | undefined;
    if (raw?.format !== SNAPSHOT_FORMAT) {
      throw new AppError(
        502,
        'BAD_GATEWAY',
        `The hub's data is in format ${String(raw?.format)}; this version reads ${SNAPSHOT_FORMAT}`,
        undefined,
        'HUB_INCOMPATIBLE',
      );
    }
    const snapshot = snapshotSchema.parse(latest.snapshot);
    if (snapshotHash(canonicalSnapshotJson(snapshot)) !== latest.head.hash) {
      throw new AppError(502, 'BAD_GATEWAY', 'The hub sent data that does not match its hash');
    }
    // Look again: an edit may have landed while the hub answered (another tab).
    // From here on nothing awaits, so nothing else can slip in.
    const fresh = local(link);
    if (fresh.hash !== mine.hash && !force) {
      throw new ConflictError(
        'SYNC_LOCAL_CHANGES',
        'This device changed while pulling; pulling would replace that change',
      );
    }
    // Overwriting changes the hub never got: keep a copy first.
    if ((fresh.changed || fresh.hash !== mine.hash) && backupDir !== undefined) {
      createBackup(db, backupDir, now(), PULL_BACKUP_PREFIX);
    }
    if (fresh.hash !== latest.head.hash) {
      replaceWithSnapshot(db, snapshot);
      hashCache = null;
    }
    repos.sync.markSynced(latest.head);
    return statusOf(requireLink(), false, latest.head, null);
  }

  return {
    status,
    connect,
    push,
    pull,
    disconnect: async () => {
      const link = repos.sync.get();
      repos.sync.disconnect();
      if (link) await revoke(link);
    },
  };
}

export type SyncService = ReturnType<typeof createSyncService>;
