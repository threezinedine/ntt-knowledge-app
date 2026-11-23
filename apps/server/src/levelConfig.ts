import { readFileSync } from 'node:fs';
import { DEFAULT_LEVEL_CONFIG, levelConfigSchema, type LevelConfig } from '@km/core';
import { z } from 'zod';

export interface LoadedLevelConfig {
  config: LevelConfig;
  /** Where it came from, for the startup log. */
  source: 'file' | 'defaults';
}

/**
 * The EXP/level table, read once at startup from a JSON file the operator
 * edits (restart to apply). A missing file means the defaults; a broken one
 * stops the server with a message saying what's wrong, rather than quietly
 * running with numbers nobody chose.
 */
export function loadLevelConfig(path: string): LoadedLevelConfig {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { config: DEFAULT_LEVEL_CONFIG, source: 'defaults' };
    }
    throw error;
  }
  let json: unknown;
  try {
    // Windows tools (Notepad, PowerShell 5) like to start UTF-8 with a BOM.
    json = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`Level config ${path} is not valid JSON: ${(error as Error).message}`, {
      cause: error,
    });
  }
  const parsed = levelConfigSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(`Level config ${path} is invalid:\n${z.prettifyError(parsed.error)}`);
  }
  return { config: parsed.data, source: 'file' };
}
