import { z } from 'zod';
import type { ApiErrorReason, GraphSnapshot } from './api.js';
import type { ExpSnapshot } from './exp.js';
import type { GraphNode } from './schemas/node.js';
import type { Tag } from './schemas/tag.js';

/**
 * Sync through the hub: the one server keeps numbered versions of the
 * whole graph, each a snapshot with a SHA-256 hash. Every device keeps only
 * its current copy. Pushing makes this device's copy the hub's newest
 * version; pulling replaces this device's copy with the newest version.
 * Nothing is merged: whoever pushes last wins, and older versions stay in the
 * hub's history.
 */

/** Bumped whenever the tables or their columns in a snapshot change. */
export const SNAPSHOT_FORMAT = 'km-snapshot/1';

const text = z.string();
const nullableText = z.string().nullable();
const ms = z.number().int();
const nullableMs = z.number().int().nullable();

/**
 * One row per table, with the database's own column names, in column order.
 * Every row is included, tombstones too. Not included: sign-in sessions and
 * sync state (device-local), the cached word count (derived) and the tasks
 * that were removed (all tombstoned).
 */
export const snapshotRowSchemas = {
  nodes: z.strictObject({
    id: text,
    type: text,
    title: text,
    content: text,
    props: text,
    created_at: ms,
    updated_at: ms,
    deleted_at: nullableMs,
  }),
  node_layouts: z.strictObject({
    node_id: text,
    pos_x: z.number().nullable(),
    pos_y: z.number().nullable(),
    updated_at: ms,
  }),
  edges: z.strictObject({
    id: text,
    from_id: text,
    to_id: text,
    name: text,
    props: text,
    created_at: ms,
    updated_at: ms,
    deleted_at: nullableMs,
  }),
  tags: z.strictObject({
    id: text,
    name: text,
    parent_id: nullableText,
    color: nullableText,
    created_at: ms,
    updated_at: ms,
    deleted_at: nullableMs,
  }),
  node_tags: z.strictObject({
    node_id: text,
    tag_id: text,
    created_at: ms,
    updated_at: ms,
    deleted_at: nullableMs,
  }),
  why_sessions: z.strictObject({
    id: text,
    node_id: text,
    summary: text,
    conclusion: text,
    whys: text,
    created_at: ms,
    updated_at: ms,
    deleted_at: nullableMs,
  }),
} as const;

export type SnapshotTable = keyof typeof snapshotRowSchemas;
export const SNAPSHOT_TABLES = Object.keys(snapshotRowSchemas) as SnapshotTable[];

/** Each table's primary key columns: rows are sorted by them, so a snapshot's JSON is canonical. */
export const SNAPSHOT_KEYS: Record<SnapshotTable, readonly string[]> = {
  nodes: ['id'],
  node_layouts: ['node_id'],
  edges: ['id'],
  tags: ['id'],
  node_tags: ['node_id', 'tag_id'],
  why_sessions: ['id'],
};

export const snapshotSchema = z.strictObject({
  format: z.literal(SNAPSHOT_FORMAT),
  tables: z.strictObject({
    nodes: z.array(snapshotRowSchemas.nodes),
    node_layouts: z.array(snapshotRowSchemas.node_layouts),
    edges: z.array(snapshotRowSchemas.edges),
    tags: z.array(snapshotRowSchemas.tags),
    node_tags: z.array(snapshotRowSchemas.node_tags),
    why_sessions: z.array(snapshotRowSchemas.why_sessions),
  }),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

/** A version on the hub. */
export interface HubVersion {
  version: number;
  /** SHA-256 (hex) of the snapshot's canonical JSON. */
  hash: string;
  createdAt: number;
  /** The device that pushed it. */
  deviceName: string;
}

export const hubUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .transform((v) => v.replace(/\/+$/, ''))
  // http(s), a host (no user:password@), an optional path; no query or fragment.
  .refine(
    (v) => /^https?:\/\/[^\s/?#@]+(\/[^\s?#]*)?$/i.test(v),
    'Expected an http(s) address, e.g. http://192.168.1.20:4317',
  );

/** The hub's authenticator code; empty is accepted only by a hub with sign-in off. */
const pairCodeSchema = z
  .string()
  .trim()
  .regex(/^(\d{6})?$/, 'Expected the 6-digit code');

export const deviceNameSchema = z.string().trim().min(1).max(64);

/** POST /api/hub/pair (on the hub): a device signs in once and gets a lasting token. */
export const hubPairInputSchema = z.strictObject({
  code: pairCodeSchema,
  name: deviceNameSchema,
  /** The phone app: may pull, never push. */
  readOnly: z.boolean().default(false),
});
export type HubPairInput = z.input<typeof hubPairInputSchema>;

export interface HubPairResult {
  token: string;
}

/** POST /api/hub/versions (on the hub). */
export const hubPushInputSchema = z.strictObject({
  /** The version this device last synced; null if never. */
  baseVersion: z.number().int().positive().nullable(),
  /** Its hash, checked too: a hub restored from a backup can reuse a number for other data. */
  baseHash: z.string().nullable().default(null),
  /** Push even though the hub has a version this device hasn't pulled. */
  force: z.boolean().default(false),
  snapshot: snapshotSchema,
});
export type HubPushInput = z.input<typeof hubPushInputSchema>;

/** GET /api/hub/latest (on the hub). */
export interface HubLatest {
  head: HubVersion;
  snapshot: Snapshot;
}

/** POST /api/sync/connect (the device's local API): pair this device with the hub. */
export const syncConnectInputSchema = z.strictObject({
  hubUrl: hubUrlSchema,
  code: pairCodeSchema,
  deviceName: deviceNameSchema,
});
export type SyncConnectInput = z.input<typeof syncConnectInputSchema>;

/** POST /api/sync/push and /api/sync/pull. */
export const syncActionInputSchema = z.strictObject({
  /** Overwrite anyway (after the user confirmed the warning). */
  force: z.boolean().default(false),
});
export type SyncActionInput = z.input<typeof syncActionInputSchema>;

/** GET /api/sync/status (on the device). */
export type SyncStatus =
  | {
      connected: false;
      /** A default name for this device (the machine's host name). */
      suggestedName: string;
    }
  | {
      connected: true;
      hubUrl: string;
      deviceName: string;
      /** The version this device last pushed or pulled. */
      synced: HubVersion | null;
      /** This device's data differs from that version (or was never synced). */
      localChanged: boolean;
      /**
       * Why the hub couldn't be asked: HUB_UNREACHABLE (no network, or it is
       * down), HUB_DENIED, ...; null when it answered.
       */
      problem: ApiErrorReason | null;
      /** The hub's newest version; null when it has none yet, or didn't answer. */
      hub: HubVersion | null;
    };

export type SyncState =
  | 'off'
  /** The hub didn't answer. */
  | 'offline'
  /** The hub answered, but refused (see `problem`). */
  | 'error'
  | 'upToDate'
  /** This device has changes to push. */
  | 'changes'
  /** The hub has a version this device hasn't pulled. */
  | 'behind'
  /** Both: pushing or pulling overwrites one side. */
  | 'diverged';

/** Is the hub's newest version one this device doesn't have? */
export function hubIsNewer(status: SyncStatus): boolean {
  if (!status.connected || status.problem !== null || status.hub === null) return false;
  return status.hub.hash !== status.synced?.hash;
}

export function syncState(status: SyncStatus): SyncState {
  if (!status.connected) return 'off';
  if (status.problem === 'HUB_UNREACHABLE') return 'offline';
  if (status.problem !== null) return 'error';
  const behind = hubIsNewer(status);
  if (behind) return status.localChanged ? 'diverged' : 'behind';
  return status.localChanged ? 'changes' : 'upToDate';
}

/**
 * GET /api/hub/latest/view (on the hub): the newest version as the read-only
 * phone app shows it, already in API shapes, so the phone needs no database.
 */
export interface PhoneView {
  head: HubVersion;
  graph: GraphSnapshot;
  /** Every live node, in full. */
  nodes: GraphNode[];
  tags: Tag[];
  exp: ExpSnapshot;
}
