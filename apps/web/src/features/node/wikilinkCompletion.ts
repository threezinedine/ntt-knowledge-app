import type { CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/**
 * Typing `[[` suggests node titles; picking one completes `[[Title]]`
 * (reusing the `]]` that bracket auto-closing may already have typed).
 * `titles` is read on every completion, so it can follow the graph.
 */
export function wikilinkCompletion(titles: () => readonly string[]) {
  const source = (ctx: CompletionContext): CompletionResult | null => {
    const typed = ctx.matchBefore(/\[\[[^[\]|\n]*$/);
    if (!typed) return null;
    return {
      from: typed.from + 2,
      options: [...new Set(titles())].map((title) => ({
        label: title,
        type: 'text',
        apply: (view: EditorView, _c: unknown, from: number, to: number) => {
          const closed = view.state.sliceDoc(to, to + 2) === ']]';
          view.dispatch({
            changes: { from, to: closed ? to + 2 : to, insert: `${title}]]` },
            selection: { anchor: from + title.length + 2 },
          });
        },
      })),
      validFor: /^[^[\]|\n]*$/,
    };
  };
  // As language data, so the editor's own autocompletion (basicSetup) uses it.
  return EditorState.languageData.of(() => [{ autocomplete: source }]);
}
