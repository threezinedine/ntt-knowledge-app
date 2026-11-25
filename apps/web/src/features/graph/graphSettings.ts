import { useSyncExternalStore } from 'react';
import { readJson, writeJson } from '../../commands/storage';
import type { MessageKey } from '../../i18n/catalog';

/**
 * How the 2D graph looks and how dragging pushes dots aside, tuned by the
 * user like Obsidian's graph settings. Per device (localStorage), never sent
 * to the server. Every value is clamped to its range on read, so a stale or
 * hand-edited entry can't break the canvas.
 */
export interface GraphSettings {
  unlinkedRadius: number;
  linkedMinRadius: number;
  maxRadius: number;
  nodeLabelSize: number;
  nodeLabelOpacity: number;
  /** Below this zoom, node labels hide (the hovered one still shows). */
  labelMinZoom: number;
  linkWidth: number;
  showArrows: boolean;
  showLinkLabels: boolean;
  linkLabelSize: number;
  linkLabelOpacity: number;
  pushGap: number;
  pushReach: number;
  pushSoftness: number;
  /** Dots arrange themselves (forces); off = they stay where you put them. */
  autoLayout: boolean;
  centerForce: number;
  repelForce: number;
  linkForce: number;
  linkDistance: number;
  /** Experimental: colour the dots by their tags, spreading from the biggest ones. */
  tagColors: boolean;
  /** What makes a dot "big" for the tag colours. */
  colorRank: ColorRank;
  colorHubs: number;
  colorFade: number;
  colorReach: number;
}

export const COLOR_RANKS = ['links', 'exp'] as const;
export type ColorRank = (typeof COLOR_RANKS)[number];

type NumberKey = {
  [K in keyof GraphSettings]: GraphSettings[K] extends number ? K : never;
}[keyof GraphSettings];
type BooleanKey = {
  [K in keyof GraphSettings]: GraphSettings[K] extends boolean ? K : never;
}[keyof GraphSettings];
type ChoiceKey = Exclude<keyof GraphSettings, NumberKey | BooleanKey>;

export type SettingField =
  | {
      kind: 'number';
      key: NumberKey;
      label: MessageKey;
      min: number;
      max: number;
      step: number;
      default: number;
    }
  | { kind: 'boolean'; key: BooleanKey; label: MessageKey; default: boolean }
  | {
      kind: 'choice';
      key: ChoiceKey;
      label: MessageKey;
      options: readonly { value: ColorRank; label: MessageKey }[];
      default: ColorRank;
    };

/** Settings that only do something with tag colours on. */
export const TAG_COLOR_KEYS: ReadonlySet<keyof GraphSettings> = new Set([
  'colorRank',
  'colorHubs',
  'colorFade',
  'colorReach',
]);

/** Sliders that only do something with auto layout on. */
export const FORCE_KEYS: ReadonlySet<keyof GraphSettings> = new Set([
  'centerForce',
  'repelForce',
  'linkForce',
  'linkDistance',
]);

export interface SettingGroup {
  id: 'nodes' | 'nodeLabels' | 'links' | 'linkLabels' | 'forces' | 'push' | 'colors';
  title: MessageKey;
  /** Shown in read-only mode (the phone app); dragging settings aren't. */
  display: boolean;
  /** Only shown with auto layout on (true) or off (false). */
  whenAutoLayout?: boolean;
  fields: readonly SettingField[];
}

const num = (
  key: NumberKey,
  label: MessageKey,
  min: number,
  max: number,
  step: number,
  def: number,
): SettingField => ({ kind: 'number', key, label, min, max, step, default: def });
const bool = (key: BooleanKey, label: MessageKey, def: boolean): SettingField => ({
  kind: 'boolean',
  key,
  label,
  default: def,
});

export const SETTING_GROUPS: readonly SettingGroup[] = [
  {
    id: 'nodes',
    title: 'graphSettings.group.nodes',
    display: true,
    fields: [
      num('unlinkedRadius', 'graphSettings.unlinkedRadius', 2, 30, 1, 6),
      num('linkedMinRadius', 'graphSettings.linkedMinRadius', 2, 60, 1, 12),
      num('maxRadius', 'graphSettings.maxRadius', 4, 120, 1, 32),
    ],
  },
  {
    id: 'nodeLabels',
    title: 'graphSettings.group.nodeLabels',
    display: true,
    fields: [
      num('nodeLabelSize', 'graphSettings.nodeLabelSize', 8, 28, 1, 12),
      num('nodeLabelOpacity', 'graphSettings.nodeLabelOpacity', 0.1, 1, 0.05, 1),
      num('labelMinZoom', 'graphSettings.labelMinZoom', 0, 2, 0.05, 0.45),
    ],
  },
  {
    id: 'links',
    title: 'graphSettings.group.links',
    display: true,
    fields: [
      num('linkWidth', 'graphSettings.linkWidth', 0.5, 6, 0.1, 1.2),
      bool('showArrows', 'graphSettings.showArrows', true),
    ],
  },
  {
    id: 'linkLabels',
    title: 'graphSettings.group.linkLabels',
    display: true,
    fields: [
      bool('showLinkLabels', 'graphSettings.showLinkLabels', true),
      num('linkLabelSize', 'graphSettings.linkLabelSize', 6, 24, 1, 10),
      num('linkLabelOpacity', 'graphSettings.linkLabelOpacity', 0.1, 1, 0.05, 0.6),
    ],
  },
  {
    id: 'forces',
    title: 'graphSettings.group.forces',
    display: true,
    fields: [
      bool('autoLayout', 'graphSettings.autoLayout', true),
      num('centerForce', 'graphSettings.centerForce', 0, 1, 0.01, 0.08),
      num('repelForce', 'graphSettings.repelForce', 0, 2000, 10, 400),
      num('linkForce', 'graphSettings.linkForce', 0, 2, 0.05, 0.6),
      num('linkDistance', 'graphSettings.linkDistance', 20, 500, 5, 110),
    ],
  },
  {
    id: 'colors',
    title: 'graphSettings.group.colors',
    display: true,
    fields: [
      bool('tagColors', 'graphSettings.tagColors', false),
      {
        kind: 'choice',
        key: 'colorRank',
        label: 'graphSettings.colorRank',
        options: [
          { value: 'links', label: 'graphSettings.colorRank.links' },
          { value: 'exp', label: 'graphSettings.colorRank.exp' },
        ],
        default: 'links',
      },
      num('colorHubs', 'graphSettings.colorHubs', 1, 50, 1, 5),
      num('colorFade', 'graphSettings.colorFade', 0.1, 0.95, 0.05, 0.6),
      num('colorReach', 'graphSettings.colorReach', 1, 10, 1, 3),
    ],
  },
  {
    id: 'push',
    title: 'graphSettings.group.push',
    display: false,
    whenAutoLayout: false,
    fields: [
      num('pushGap', 'graphSettings.pushGap', 0, 120, 1, 28),
      num('pushReach', 'graphSettings.pushReach', 0, 400, 5, 110),
      num('pushSoftness', 'graphSettings.pushSoftness', 0, 1, 0.05, 0.45),
    ],
  },
];

const FIELDS = SETTING_GROUPS.flatMap((g) => g.fields);

export const DEFAULT_GRAPH_SETTINGS = Object.fromEntries(
  FIELDS.map((f) => [f.key, f.default]),
) as unknown as GraphSettings;

/** Anything (stored JSON, a partial patch) → valid settings; bad values fall back to defaults. */
export function sanitizeGraphSettings(raw: unknown): GraphSettings {
  const source: Record<string, unknown> =
    typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const out: Record<string, number | boolean | string> = {};
  for (const field of FIELDS) {
    const value = source[field.key];
    if (field.kind === 'choice') {
      out[field.key] = field.options.some((o) => o.value === value)
        ? (value as string)
        : field.default;
    } else if (field.kind === 'boolean') {
      out[field.key] = typeof value === 'boolean' ? value : field.default;
    } else {
      out[field.key] =
        typeof value === 'number' && Number.isFinite(value)
          ? Math.min(field.max, Math.max(field.min, value))
          : field.default;
    }
  }
  const settings = out as unknown as GraphSettings;
  // The best-linked dot is never smaller than the least-linked one.
  if (settings.maxRadius < settings.linkedMinRadius) settings.maxRadius = settings.linkedMinRadius;
  return settings;
}

// ---------- the per-device store ----------

const KEY = 'km.graph.settings';
let current: GraphSettings = sanitizeGraphSettings(readJson(KEY));
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const l of listeners) l();
}

/** Another tab changed them: take its values, or this tab would write its stale ones back. */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    current = sanitizeGraphSettings(readJson(KEY));
    notify();
  });
}

export function setGraphSettings(patch: Partial<GraphSettings>): void {
  current = sanitizeGraphSettings(withOrderedRadii(current, patch));
  writeJson(KEY, current);
  notify();
}

/**
 * The smallest and largest linked dots push each other along instead of the
 * one being dragged getting stuck at the other (sanitize alone would snap it back).
 */
export function withOrderedRadii(
  base: GraphSettings,
  patch: Partial<GraphSettings>,
): GraphSettings {
  const next = { ...base, ...patch };
  if (patch.maxRadius !== undefined && next.maxRadius < next.linkedMinRadius) {
    next.linkedMinRadius = next.maxRadius;
  } else if (patch.linkedMinRadius !== undefined && next.linkedMinRadius > next.maxRadius) {
    next.maxRadius = next.linkedMinRadius;
  }
  return next;
}

export function resetGraphSettings(groupId?: SettingGroup['id']): void {
  const fields = groupId
    ? (SETTING_GROUPS.find((g) => g.id === groupId)?.fields ?? []).filter(
        // Resetting a group resets its numbers, not the choice to use it.
        (f) => f.key !== 'autoLayout' && f.key !== 'tagColors',
      )
    : FIELDS;
  setGraphSettings(Object.fromEntries(fields.map((f) => [f.key, f.default])));
}

export function useGraphSettings(): GraphSettings {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
}
