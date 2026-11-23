import { EditorSelection } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { useCallback, useRef } from 'react';

/**
 * Focus for a `<CodeMirror>` that may not have its view yet: @uiw creates it
 * a render after mounting, so a focus asked for on mount (a new node, Alt+J
 * from Preview) waits for `onCreateEditor`.
 */
export function useCodeMirrorFocus() {
  const cmRef = useRef<ReactCodeMirrorRef>(null);
  const pending = useRef<{ selectAll: boolean } | null>(null);

  const apply = (view: EditorView, selectAll: boolean) => {
    view.focus();
    if (selectAll) view.dispatch({ selection: EditorSelection.single(0, view.state.doc.length) });
  };
  const focus = useCallback((selectAll = false) => {
    const view = cmRef.current?.view;
    if (view) apply(view, selectAll);
    else pending.current = { selectAll };
  }, []);
  const onCreateEditor = useCallback((view: EditorView) => {
    if (!pending.current) return;
    apply(view, pending.current.selectAll);
    pending.current = null;
  }, []);
  return { cmRef, focus, onCreateEditor };
}
