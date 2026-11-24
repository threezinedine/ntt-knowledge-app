import { describe, expect, it } from 'vitest';
import { hubIsNewer, syncState, type HubVersion, type SyncStatus } from './sync.js';

const v = (version: number, hash = `h${String(version)}`): HubVersion => ({
  version,
  hash,
  createdAt: 0,
  deviceName: 'PC',
});

const linked = (over: Partial<Extract<SyncStatus, { connected: true }>>): SyncStatus => ({
  connected: true,
  hubUrl: 'http://hub',
  deviceName: 'PC',
  synced: v(1),
  localChanged: false,
  problem: null,
  hub: v(1),
  ...over,
});

describe('syncState', () => {
  it.each([
    ['off', { connected: false, suggestedName: 'x' }],
    ['upToDate', linked({})],
    ['changes', linked({ localChanged: true })],
    ['behind', linked({ hub: v(2) })],
    ['diverged', linked({ hub: v(2), localChanged: true })],
    ['offline', linked({ problem: 'HUB_UNREACHABLE', hub: null })],
    ['error', linked({ problem: 'HUB_DENIED', hub: null })],
    ['upToDate', linked({ synced: null, hub: null })], // empty hub, empty device
    ['changes', linked({ synced: null, hub: null, localChanged: true })],
    ['behind', linked({ synced: null, hub: v(3) })], // a new device: pull first
  ] as const)('%s', (state, status) => {
    expect(syncState(status)).toBe(state);
  });

  it('a hub version with the same content is not newer', () => {
    expect(hubIsNewer(linked({ hub: v(2, 'h1') }))).toBe(false);
  });

  it('offline knows nothing newer', () => {
    expect(hubIsNewer(linked({ problem: 'HUB_UNREACHABLE', hub: v(5) }))).toBe(false);
  });
});
