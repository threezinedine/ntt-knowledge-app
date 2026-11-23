import { EditorState, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { getCM, Vim } from '@replit/codemirror-vim';

/**
 * True in Normal mode with nothing typed yet (no count, operator or pending
 * keys), i.e. when a plain key would start a new command. That is the only
 * time "j"/"k" may leave the editor instead of moving the cursor.
 */
export function vimIdle(view: EditorView): boolean {
  const state = getCM(view)?.state.vim;
  if (!state) return false;
  const input = state.inputState;
  return (
    !state.insertMode &&
    !state.visualMode &&
    !state.exMode &&
    !input.operator &&
    !input.motion &&
    input.keyBuffer.length === 0 &&
    input.prefixRepeat.length === 0 &&
    input.motionRepeat.length === 0
  );
}

/**
 * Whether a keydown should leave the editor instead of reaching vim: a plain `key`
 * ("j" from the title, "k" on the content's first line) in idle
 * Normal mode, with the cursor at that edge. Call it from a capture-phase
 * handler so it runs before CodeMirror sees the key.
 */
export function vimExitKey(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'metaKey'>,
  view: EditorView | undefined,
  key: 'j' | 'k',
  atEdge: (view: EditorView) => boolean,
): boolean {
  if (e.key !== key || e.ctrlKey || e.altKey || e.metaKey || !view) return false;
  return atEdge(view) && vimIdle(view);
}

export const onFirstLine = (view: EditorView) =>
  view.state.doc.lineAt(view.state.selection.main.head).number === 1;

/** One line only: typed or vim-made newlines are refused, pasted ones become spaces. */
export const singleLine: Extension = [
  EditorState.transactionFilter.of((tr) => (tr.newDoc.lines > 1 ? [] : tr)),
  EditorView.clipboardInputFilter.of((text) => text.replace(/\s*[\r\n]+\s*/g, ' ')),
];

/**
 * Ctrl+[ is Esc in vim. The vim package matches it by the typed character,
 * which Vietnamese Telex and other layouts change ("[" types "ơ"), so match
 * the physical key and send Esc ourselves. Returns whether it handled `e`.
 */
export function vimCtrlBracket(
  e: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'metaKey' | 'shiftKey'>,
  view: EditorView | undefined,
): boolean {
  if (e.code !== 'BracketLeft' || !e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return false;
  const cm = view ? getCM(view) : null;
  if (!cm) return false;
  Vim.handleKey(cm, '<Esc>', 'user');
  return true;
}
