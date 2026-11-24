import { gzipSync } from 'node:zlib';
import {
  expSnapshot,
  hubPairInputSchema,
  hubPushInputSchema,
  newId,
  SNAPSHOT_FORMAT,
  snapshotSchema,
  type HubPairResult,
  type HubVersion,
  type LevelConfig,
  type PhoneView,
  type Snapshot,
} from '@km/core';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { LoginGuard } from '../../auth/loginGuard.js';
import { IN_MEMORY, openDatabase } from '../../db/database.js';
import {
  AppError,
  ConflictError,
  ForbiddenError,
  TooManyRequestsError,
  UnauthorizedError,
} from '../../errors.js';
import type { HubDevice } from '../../repositories/hubRepository.js';
import { createRepositories, type Repositories } from '../../repositories/index.js';
import {
  canonicalSnapshotJson,
  replaceWithSnapshot,
  snapshotHash,
} from '../../repositories/snapshotRepository.js';
import { parse } from '../validation.js';

export interface HubOptions {
  /** How many versions the hub keeps (older ones are dropped). */
  keepVersions: number;
}

/** Every hub route but pairing; they authenticate with a device token, not the cookie. */
export const HUB_ROUTE_PREFIX = '/api/hub/';
const PAIR_ROUTE = '/api/hub/pair';

/** A pushed snapshot can be far larger than a normal request. */
const PUSH_BODY_LIMIT = 256 * 1024 * 1024;

/**
 * The hub (KM_HUB=on): keeps numbered versions of the whole graph for the
 * devices that sync with it (see @km/core sync.ts). Devices pair once with
 * the authenticator code and then send a bearer token, so a device's own
 * server (PC) and the phone app can both talk to it without a browser session.
 */
export function registerHubRoutes(
  app: FastifyInstance,
  repos: Repositories,
  options: HubOptions & { guard: LoginGuard | undefined; levelConfig: LevelConfig },
): void {
  const devices = new WeakMap<FastifyRequest, HubDevice>();

  // Deny by default, decided on the matched route like http/auth.ts.
  app.addHook('onRequest', (request, _reply, done) => {
    const route = request.routeOptions.url;
    if (route === undefined || !route.startsWith(HUB_ROUTE_PREFIX) || route === PAIR_ROUTE) {
      done();
      return;
    }
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const device = token ? repos.hub.findDevice(token) : undefined;
    if (!device) {
      done(new UnauthorizedError('HUB_DENIED', 'Unknown device token: pair this device again'));
      return;
    }
    devices.set(request, device);
    done();
  });
  const deviceOf = (request: FastifyRequest): HubDevice => {
    const device = devices.get(request);
    if (!device) throw new UnauthorizedError('HUB_DENIED');
    return device;
  };

  app.post(PAIR_ROUTE, (request, reply) => {
    const input = parse(hubPairInputSchema, request.body);
    // With sign-in off (KM_AUTH=off) anyone who reaches the hub may pair.
    if (options.guard) {
      // No code at all isn't a guess: it mustn't spend the owner's wrong-code budget.
      if (input.code === '') throw new UnauthorizedError('CODE_INVALID', 'The hub needs a code');
      const result = options.guard.check(input.code);
      if (!result.ok) {
        if (result.reason === 'locked') {
          void reply.header('Retry-After', Math.ceil(result.retryAfterMs / 1000));
          throw new TooManyRequestsError('LOCKED_OUT', 'Too many wrong codes', result.retryAfterMs);
        }
        throw new UnauthorizedError(
          result.reason === 'reused' ? 'CODE_USED' : 'CODE_INVALID',
          'Wrong or expired code',
        );
      }
    }
    const token = repos.hub.pair(input.name, input.readOnly);
    request.log.info({ device: input.name, readOnly: input.readOnly }, 'Hub: device paired');
    return reply.status(201).send({ token } satisfies HubPairResult);
  });

  // Disconnecting: the device asks the hub to forget its token.
  app.delete('/api/hub/devices/self', (request, reply) => {
    repos.hub.revoke(deviceOf(request).id);
    return reply.status(204).send();
  });

  app.get('/api/hub/head', (request) => {
    deviceOf(request);
    return { head: repos.hub.head() };
  });

  app.get('/api/hub/latest', (request, reply) => {
    deviceOf(request);
    const latest = repos.hub.latest();
    if (!latest)
      throw new AppError(404, 'NOT_FOUND', 'The hub has no version yet', undefined, 'HUB_EMPTY');
    // The stored text is already canonical JSON: splice it in rather than re-encode it.
    const body = `{"head":${JSON.stringify(latest.head)},"snapshot":${latest.json}}`;
    return sendJson(request, reply, body);
  });

  let viewCache: { hash: string; view: PhoneView } | null = null;
  app.get('/api/hub/latest/view', (request, reply) => {
    deviceOf(request);
    const latest = repos.hub.latest();
    if (!latest)
      throw new AppError(404, 'NOT_FOUND', 'The hub has no version yet', undefined, 'HUB_EMPTY');
    if (viewCache?.hash !== latest.head.hash) {
      const snapshot = snapshotSchema.parse(JSON.parse(latest.json));
      viewCache = {
        hash: latest.head.hash,
        view: phoneView(latest.head, snapshot, options.levelConfig),
      };
    }
    return sendJson(request, reply, JSON.stringify(viewCache.view));
  });

  app.post('/api/hub/versions', { bodyLimit: PUSH_BODY_LIMIT }, (request, reply) => {
    const device = deviceOf(request);
    if (device.readOnly) throw new ForbiddenError('READ_ONLY', 'This device can only pull');
    const raw = request.body as { snapshot?: { format?: unknown } } | undefined;
    if (raw?.snapshot?.format !== undefined && raw.snapshot.format !== SNAPSHOT_FORMAT) {
      throw new AppError(
        400,
        'VALIDATION_ERROR',
        `Expected ${SNAPSHOT_FORMAT}`,
        undefined,
        'HUB_INCOMPATIBLE',
      );
    }
    const input = parse(hubPushInputSchema, request.body);
    const json = canonicalSnapshotJson(input.snapshot);
    const hash = snapshotHash(json);
    checkImportable(input.snapshot);

    const head = repos.hub.head();
    const onHead =
      head !== null &&
      head.version === input.baseVersion &&
      (input.baseHash === null || head.hash === input.baseHash);
    if (head && !onHead && !input.force) {
      throw new ConflictError(
        'SYNC_BEHIND',
        `The hub has version ${String(head.version)}, which this device hasn't pulled`,
        { head },
      );
    }
    // The same data as the newest version: nothing new to keep.
    if (head?.hash === hash) return reply.status(200).send(head);
    const version: HubVersion = repos.hub.add(
      { hash, json, baseVersion: input.baseVersion, device },
      options.keepVersions,
    );
    request.log.info({ version: version.version, device: device.name }, 'Hub: new version');
    return reply.status(201).send(version);
  });
}

/** JSON text, gzipped when the client accepts it (snapshots compress well). */
function sendJson(request: FastifyRequest, reply: FastifyReply, body: string): FastifyReply {
  void reply.type('application/json; charset=utf-8');
  const accepts = request.headers['accept-encoding'] ?? '';
  if (/\bgzip\b/.test(accepts)) {
    return reply.header('content-encoding', 'gzip').send(gzipSync(body));
  }
  return reply.send(body);
}

/** A throwaway database holding `snapshot` (it must be one a device could load). */
function withSnapshotDb<T>(snapshot: Snapshot, fn: (repos: Repositories) => T): T {
  const db = openDatabase(IN_MEMORY);
  try {
    replaceWithSnapshot(db, snapshot);
    return fn(createRepositories({ db, now: Date.now, newId }));
  } finally {
    db.close();
  }
}

/** Refuses a snapshot that would fail to load on a device (dangling references, bad JSON). */
function checkImportable(snapshot: Snapshot): void {
  try {
    withSnapshotDb(snapshot, () => undefined);
  } catch (error) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      `The snapshot can't be loaded: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** The phone app's copy: the API answers it needs, computed from the snapshot. */
export function phoneView(
  head: HubVersion,
  snapshot: Snapshot,
  levelConfig: LevelConfig,
): PhoneView {
  return withSnapshotDb(snapshot, (r) => {
    const { tags, nodes } = r.exp.inputs();
    return {
      head,
      graph: { nodes: r.nodes.summaries(), edges: r.edges.all() },
      nodes: r.nodes.all(),
      tags: r.tags.all(),
      exp: expSnapshot(tags, nodes, levelConfig),
    };
  });
}
