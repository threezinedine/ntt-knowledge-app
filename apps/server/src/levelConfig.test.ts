import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_LEVEL_CONFIG } from '@km/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadLevelConfig } from './levelConfig.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'km-level-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('loadLevelConfig', () => {
  it('uses the defaults when there is no file', () => {
    expect(loadLevelConfig(join(dir, 'missing.json'))).toEqual({
      config: DEFAULT_LEVEL_CONFIG,
      source: 'defaults',
    });
  });

  it('reads the file, filling unset values with defaults', () => {
    const path = join(dir, 'level-config.json');
    writeFileSync(path, JSON.stringify({ expPerNode: 5, levelThresholds: [10, 30] }));
    const { config, source } = loadLevelConfig(path);
    expect(source).toBe('file');
    expect(config).toEqual({ ...DEFAULT_LEVEL_CONFIG, expPerNode: 5, levelThresholds: [10, 30] });
  });

  it('refuses to start on a broken file, saying why', () => {
    const path = join(dir, 'level-config.json');
    writeFileSync(path, '{ nope');
    expect(() => loadLevelConfig(path)).toThrow(/not valid JSON/);
    writeFileSync(path, JSON.stringify({ levelThresholds: [30, 10] }));
    expect(() => loadLevelConfig(path)).toThrow(/strictly increasing/);
    writeFileSync(path, JSON.stringify({ expPerTask: 1 }));
    expect(() => loadLevelConfig(path)).toThrow(/invalid/);
  });
});
