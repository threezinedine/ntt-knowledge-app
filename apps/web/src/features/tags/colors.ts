import type { Tag } from '@km/core';

/** Dot colour for tags without an explicit colour. */
export const DEFAULT_TAG_COLOR = '#8b929c';

// ---------- colour maths (#rrggbb in, #rrggbb out) ----------

export type Rgb = readonly [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  const part = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** sRGB channel (0–255) → linear light (0–1): averages there don't go muddy. */
const toLinear = (v: number) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (c: number) =>
  255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

/** Weighted average of colours (weights > 0), mixed in linear light. */
export function mixColors(parts: readonly { color: string; weight: number }[]): string | null {
  let total = 0;
  const sum = [0, 0, 0];
  for (const { color, weight } of parts) {
    if (!(weight > 0)) continue;
    const rgb = hexToRgb(color);
    for (let i = 0; i < 3; i++) sum[i] = (sum[i] ?? 0) + toLinear(rgb[i] ?? 0) * weight;
    total += weight;
  }
  if (total === 0) return null;
  return rgbToHex([
    fromLinear((sum[0] ?? 0) / total),
    fromLinear((sum[1] ?? 0) / total),
    fromLinear((sum[2] ?? 0) / total),
  ]);
}

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h =
    max === rn
      ? (gn - bn) / d + (gn < bn ? 6 : 0)
      : max === gn
        ? (bn - rn) / d + 2
        : (rn - gn) / d + 4;
  return [h * 60, s, l];
}

function hslToRgb([h, s, l]: [number, number, number]): Rgb {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** The same hue at full strength: what a big dot on the graph shows. */
export function vivid(color: string): string {
  const [h, s, l] = rgbToHsl(hexToRgb(color));
  if (s < 0.05) return color; // grey stays grey
  return rgbToHex(hslToRgb([h, Math.max(s, 0.85), Math.min(0.6, Math.max(0.45, l))]));
}

/**
 * A pale tint of the colour, `strength` 1 = itself, toward 0 = washed out
 * (less saturated, lighter): how a big dot's colour looks further away.
 */
export function tint(color: string, strength: number): string {
  const [h, s, l] = rgbToHsl(hexToRgb(color));
  const k = Math.min(1, Math.max(0, strength));
  const lightness = l + (0.8 - l) * (1 - k) * 0.85;
  return rgbToHex(hslToRgb([h, s * (0.3 + 0.7 * k), lightness]));
}

/** How far apart (in hue degrees) the first and last child of a tag end up. */
const CHILD_HUE_SPREAD = 40;
/** Each level down moves this share of the way to white: always paler, never white. */
const CHILD_PALER = 0.28;
/** ...and keeps this much of its parent's saturation (a parent looks bolder). */
const CHILD_SATURATION = 0.8;
/** Grey parents have no hue to spread: siblings differ by how much paler they get. */
const GREY_PALER_SPREAD = 0.3;

/** HSL lightness (0–1) of a colour. */
export function lightnessOf(color: string): number {
  return rgbToHsl(hexToRgb(color))[2];
}

/**
 * The i-th of n children's shade of its parent's colour: always paler (lighter,
 * less saturated) than the parent, so the parent looks the boldest, and set
 * apart from its siblings by a small hue shift. (Pure white has nothing paler:
 * its children stay white.)
 */
export function childShade(parent: string, index: number, count: number): string {
  const [h, s, l] = rgbToHsl(hexToRgb(parent));
  const spread = count <= 1 ? 0 : index / (count - 1) - 0.5; // -0.5 … 0.5
  const grey = s < 0.05;
  const hue = grey ? h : (h + spread * CHILD_HUE_SPREAD + 360) % 360;
  const paler = grey ? CHILD_PALER + (spread + 0.5) * GREY_PALER_SPREAD : CHILD_PALER;
  return rgbToHex(hslToRgb([hue, s * CHILD_SATURATION, l + (1 - l) * paler]));
}

/**
 * Every tag's colour: a top-level tag uses its own (or none), a tag below
 * it gets a shade of its parent's, set apart from its siblings (ordered by
 * id, so renaming doesn't shuffle them). Colours picked for nested tags are
 * ignored. A tag under an uncoloured root has none either.
 */
export function resolveTagColors(tags: readonly Tag[]): Map<string, string | null> {
  const known = new Set(tags.map((t) => t.id));
  const children = new Map<string | null, Tag[]>();
  for (const tag of tags) {
    // A parent that isn't here (deleted) makes it a root, like the tag tree does.
    const parent = tag.parentId !== null && known.has(tag.parentId) ? tag.parentId : null;
    const list = children.get(parent) ?? [];
    list.push(tag);
    children.set(parent, list);
  }
  const out = new Map<string, string | null>();
  const visit = (tag: Tag, color: string | null) => {
    if (out.has(tag.id)) return; // cycle guard
    out.set(tag.id, color);
    const kids = [...(children.get(tag.id) ?? [])].sort((a, b) => (a.id < b.id ? -1 : 1));
    kids.forEach((kid, i) => {
      visit(kid, color === null ? null : childShade(color, i, kids.length));
    });
  };
  for (const root of children.get(null) ?? []) visit(root, root.color);
  return out;
}
