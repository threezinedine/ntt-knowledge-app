import { describe, expect, it } from 'vitest';
import en from '../../i18n/locales/en.json';
import { PUSH_DEFAULTS } from './collide';
import { DEFAULT_SIZES } from './graphGeometry';
import {
  DEFAULT_GRAPH_SETTINGS,
  sanitizeGraphSettings,
  SETTING_GROUPS,
  withOrderedRadii,
} from './graphSettings';

describe('graph settings', () => {
  it('default to what the graph did before it had settings', () => {
    expect(DEFAULT_GRAPH_SETTINGS).toMatchObject(DEFAULT_SIZES);
    expect(DEFAULT_GRAPH_SETTINGS).toMatchObject({
      pushGap: PUSH_DEFAULTS.gap,
      pushReach: PUSH_DEFAULTS.reach,
      pushSoftness: PUSH_DEFAULTS.softness,
    });
  });

  it('fall back to defaults for missing or wrong values, and clamp numbers', () => {
    expect(sanitizeGraphSettings(undefined)).toEqual(DEFAULT_GRAPH_SETTINGS);
    expect(sanitizeGraphSettings('junk')).toEqual(DEFAULT_GRAPH_SETTINGS);
    const s = sanitizeGraphSettings({
      nodeLabelSize: 1000,
      linkWidth: -3,
      showArrows: 'no',
      pushReach: Number.NaN,
      extra: 1,
    });
    expect(s.nodeLabelSize).toBe(28);
    expect(s.linkWidth).toBe(0.5);
    expect(s.showArrows).toBe(true);
    expect(s.pushReach).toBe(DEFAULT_GRAPH_SETTINGS.pushReach);
    expect(s).not.toHaveProperty('extra');
  });

  it('never makes the largest dot smaller than the smallest linked one', () => {
    const s = sanitizeGraphSettings({ linkedMinRadius: 40, maxRadius: 10 });
    expect(s.maxRadius).toBe(40);
  });

  it('moving one end of the linked dot sizes past the other pushes it along', () => {
    const base = { ...DEFAULT_GRAPH_SETTINGS, linkedMinRadius: 12, maxRadius: 32 };
    expect(withOrderedRadii(base, { maxRadius: 8 })).toMatchObject({
      linkedMinRadius: 8,
      maxRadius: 8,
    });
    expect(withOrderedRadii(base, { linkedMinRadius: 50 })).toMatchObject({
      linkedMinRadius: 50,
      maxRadius: 50,
    });
    expect(withOrderedRadii(base, { maxRadius: 20 })).toMatchObject({
      linkedMinRadius: 12,
      maxRadius: 20,
    });
  });

  it('every default is inside its range, and every label is translated', () => {
    for (const group of SETTING_GROUPS) {
      expect(en).toHaveProperty([group.title]);
      for (const field of group.fields) {
        expect(en).toHaveProperty([field.label]);
        if (field.kind === 'number') {
          expect(field.default).toBeGreaterThanOrEqual(field.min);
          expect(field.default).toBeLessThanOrEqual(field.max);
        }
      }
    }
  });
});
