import type { Tag } from '@km/core';
import { describe, expect, it } from 'vitest';
import { childShade, hexToRgb, lightnessOf, mixColors, resolveTagColors, rgbToHex } from './colors';

const tag = (id: string, parentId: string | null, color: string | null = null): Tag => ({
  id,
  name: id,
  parentId,
  color,
  createdAt: 0,
  updatedAt: 0,
});

describe('colour maths', () => {
  it('round-trips hex', () => {
    expect(rgbToHex(hexToRgb('#12ab9f'))).toBe('#12ab9f');
  });

  it('mixes in linear light, by weight', () => {
    expect(mixColors([{ color: '#ff0000', weight: 1 }])).toBe('#ff0000');
    expect(mixColors([])).toBeNull();
    // Linear-light half of red + green is brighter than the sRGB average (#808000).
    const mid = hexToRgb(
      mixColors([
        { color: '#ff0000', weight: 1 },
        { color: '#00ff00', weight: 1 },
      ]) ?? '#000000',
    );
    expect(mid[0]).toBeGreaterThan(0x80);
    expect(mid[0]).toBe(mid[1]);
    // More weight pulls toward that colour.
    const red = hexToRgb(
      mixColors([
        { color: '#ff0000', weight: 3 },
        { color: '#0000ff', weight: 1 },
      ]) ?? '#000000',
    );
    expect(red[0]).toBeGreaterThan(red[2]);
  });
});

describe('resolveTagColors', () => {
  it('roots keep their colour, children get distinct shades of it', () => {
    const colors = resolveTagColors([
      tag('root', null, '#3366cc'),
      tag('a', 'root', '#ff0000'), // its own colour is ignored
      tag('b', 'root'),
      tag('a1', 'a'),
    ]);
    expect(colors.get('root')).toBe('#3366cc');
    const a = colors.get('a');
    const b = colors.get('b');
    expect(a).toBe(childShade('#3366cc', 0, 2));
    expect(b).toBe(childShade('#3366cc', 1, 2));
    expect(a).not.toBe(b);
    expect(a).not.toBe('#ff0000');
    expect(colors.get('a1')).toBe(childShade(a ?? '', 0, 1));
  });

  it('a parent is always bolder than its children: every level down is paler', () => {
    for (const root of ['#f0b0b0', '#c8c8ff', '#3366cc', '#202020', '#ff0000']) {
      const colors = resolveTagColors([tag('r', null, root), tag('c', 'r'), tag('g', 'c')]);
      const [r, c, g] = ['r', 'c', 'g'].map((id) => lightnessOf(colors.get(id) ?? '#000000'));
      expect(c, root).toBeGreaterThan(r ?? 1);
      expect(g, root).toBeGreaterThan(c ?? 1);
    }
  });

  it('a chain under a light root never repeats a colour', () => {
    for (const root of ['#f0b0b0', '#c8c8ff', '#3366cc', '#e0e0e0']) {
      const colors = resolveTagColors([
        tag('r', null, root),
        tag('c', 'r'),
        tag('g', 'c'),
        tag('gg', 'g'),
      ]);
      expect(new Set(colors.values()).size, root).toBe(4);
    }
  });

  it('siblings under a grey root still differ (by lightness)', () => {
    const colors = resolveTagColors([
      tag('r', null, '#808080'),
      tag('a', 'r'),
      tag('b', 'r'),
      tag('c', 'r'),
    ]);
    expect(new Set([colors.get('a'), colors.get('b'), colors.get('c')]).size).toBe(3);
  });

  it('an uncoloured root leaves its whole subtree uncoloured', () => {
    const colors = resolveTagColors([tag('root', null), tag('kid', 'root', '#ff0000')]);
    expect(colors.get('root')).toBeNull();
    expect(colors.get('kid')).toBeNull();
  });

  it('a tag whose parent is gone counts as a root', () => {
    expect(resolveTagColors([tag('orphan', 'missing', '#00ff00')]).get('orphan')).toBe('#00ff00');
  });
});
