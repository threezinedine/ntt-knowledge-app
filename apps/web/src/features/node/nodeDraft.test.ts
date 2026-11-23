import { describe, expect, it } from 'vitest';
import { draftToPatch } from './nodeDraft';

describe('draftToPatch', () => {
  it('sends every field when all are valid (trimmed by schema)', () => {
    expect(draftToPatch({ title: ' T ', type: 'note', content: 'c' })).toEqual({
      title: 'T',
      type: 'note',
      content: 'c',
    });
  });

  it('still saves content when the title is blank', () => {
    expect(draftToPatch({ title: '   ', type: 'note', content: 'keep me' })).toEqual({
      type: 'note',
      content: 'keep me',
    });
  });

  it('drops an invalid type but keeps the rest', () => {
    expect(draftToPatch({ title: 'T', type: '', content: '' })).toEqual({
      title: 'T',
      content: '',
    });
  });
});
