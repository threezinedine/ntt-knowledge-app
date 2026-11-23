import { describe, expect, it } from 'vitest';
import { fold, fuzzyFilter, fuzzyMatch } from './fuzzy';

describe('fold', () => {
  it('drops Vietnamese diacritics, including đ', () => {
    expect(fold('Đồ thị tri thức')).toBe('do thi tri thuc');
  });
});

describe('fuzzyMatch', () => {
  it('matches characters in order, with indices into the original text', () => {
    expect(fuzzyMatch('tgs', 'Go to Tags')?.indices).toEqual([3, 8, 9]);
    expect(fuzzyMatch('sgt', 'Go to Tags')).toBeNull();
  });

  it('ignores diacritics and spaces in the query', () => {
    expect(fuzzyMatch('do thi', 'Đồ thị')).not.toBeNull();
    expect(fuzzyMatch('đồ', 'do thi')).not.toBeNull();
  });

  it('indexes by code point, as the highlighter renders (emoji titles)', () => {
    expect(fuzzyMatch('plan', '🙂 Plan')?.indices).toEqual([2, 3, 4, 5]);
  });

  it('empty query matches everything', () => {
    expect(fuzzyMatch('', 'anything')).toEqual({ score: 0, indices: [] });
  });

  it('prefers word starts and runs ("ts" → Toggle Sidebar over Tags)', () => {
    const ranked = fuzzyFilter(
      ['View: Go to Tags', 'View: Toggle Sidebar Visibility'],
      'tsv',
      (s) => s,
    ).map((r) => r.item);
    expect(ranked[0]).toBe('View: Toggle Sidebar Visibility');
  });

  it('keeps input order for equal scores', () => {
    const ranked = fuzzyFilter(['b', 'a'], '', (s) => s).map((r) => r.item);
    expect(ranked).toEqual(['b', 'a']);
  });
});
