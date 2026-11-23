import { describe, expect, it } from 'vitest';
import { newId } from '../ids.js';
import { createEdgeInputSchema } from './edge.js';
import { createNodeInputSchema, updateNodeInputSchema } from './node.js';

describe('createNodeInputSchema', () => {
  it('applies defaults and trims the title', () => {
    expect(createNodeInputSchema.parse({ title: '  Hello  ' })).toEqual({
      type: 'note',
      title: 'Hello',
      content: '',
      props: {},
      position: null,
    });
  });

  it('rejects blank titles and unknown keys', () => {
    expect(createNodeInputSchema.safeParse({ title: '   ' }).success).toBe(false);
    expect(createNodeInputSchema.safeParse({ title: 'x', id: newId() }).success).toBe(false);
  });

  it('accepts nested JSON props', () => {
    const props = { tags: ['a', 'b'], meta: { level: 3, ok: true, none: null } };
    expect(createNodeInputSchema.parse({ title: 'x', props }).props).toEqual(props);
  });
});

describe('updateNodeInputSchema', () => {
  it('allows clearing position with null', () => {
    expect(updateNodeInputSchema.parse({ position: null })).toEqual({ position: null });
  });
});

describe('createEdgeInputSchema', () => {
  it('requires uuid endpoints and a non-empty relation name', () => {
    const ok = createEdgeInputSchema.safeParse({
      fromId: newId(),
      toId: newId(),
      name: ' phụ thuộc ',
    });
    expect(ok.success && ok.data.name).toBe('phụ thuộc');
    expect(createEdgeInputSchema.safeParse({ fromId: 'x', toId: newId(), name: 'A' }).success).toBe(
      false,
    );
  });
});
