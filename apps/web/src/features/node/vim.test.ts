import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { singleLine } from './vim';

describe('singleLine (vim title)', () => {
  const state = EditorState.create({ doc: 'Title', extensions: [singleLine] });

  it('refuses edits that would add a line (o, Enter, linewise p)', () => {
    expect(state.update({ changes: { from: 5, insert: '\nmore' } }).state.doc.toString()).toBe(
      'Title',
    );
  });

  it('keeps ordinary edits', () => {
    expect(state.update({ changes: { from: 5, insert: ' two' } }).state.doc.toString()).toBe(
      'Title two',
    );
  });
});

describe('singleLine paste', () => {
  it('turns pasted line breaks into spaces', () => {
    const state = EditorState.create({ extensions: [singleLine] });
    const filters = state.facet(EditorView.clipboardInputFilter);
    const pasted = filters.reduce((text, f) => f(text, state), 'one\n  two\r\nthree');
    expect(pasted).toBe('one two three');
  });
});
