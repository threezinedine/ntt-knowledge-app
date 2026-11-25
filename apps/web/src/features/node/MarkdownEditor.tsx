import { markdown } from '@codemirror/lang-markdown';
import { Prec } from '@codemirror/state';
import { vim as vimKeys } from '@replit/codemirror-vim';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { Fragment, useEffect, useImperativeHandle, useMemo, useState, type Ref } from 'react';
import { useGraph } from '../../api/queries';
import { Keys } from '../../commands/Keys';
import { useBindings } from '../../commands/keybindingStore';
import { useCommandHandler } from '../../commands/registry';
import { useCommandTooltip, type TooltipProps } from '../../commands/useCommandTooltip';
import { useI18n } from '../../i18n/context';
import { WikiMarkdown } from './WikiMarkdown';
import { wikilinkCompletion } from './wikilinkCompletion';
import type { FieldHandle } from './TitleField';
import { useCodeMirrorFocus } from './cmFocus';
import { onFirstLine, relativeLineNumbers, vimCtrlBracket, vimExitKey } from './vim';

interface Props {
  value: string;
  onChange: (value: string) => void;
  vim: boolean;
  /** "k" on the first line in vim Normal mode: back up to the title. */
  onExitUp: () => void;
  handle: Ref<FieldHandle>;
}

type Mode = 'edit' | 'preview' | 'split';
/** Tab order, and the order Alt+V cycles through. */
const MODES: readonly Mode[] = ['edit', 'split', 'preview'];

export function MarkdownEditor({ value, onChange, vim, onExitUp, handle }: Props) {
  const [mode, setMode] = useState<Mode>('edit');
  const { t } = useI18n();
  const { cmRef, focus, onCreateEditor } = useCodeMirrorFocus();
  const label = t('editor.content');
  // Titles for `[[` suggestions: read when suggesting, so no reconfigure per graph change.
  const graphNodes = useGraph().data?.nodes;
  const [titles] = useState(() => {
    let list: string[] = [];
    return {
      get: () => list,
      set: (next: string[]) => {
        list = next;
      },
    };
  });
  useEffect(() => {
    titles.set((graphNodes ?? []).map((n) => n.title));
  }, [graphNodes, titles]);
  // Stable per (vim, label): cheaper reconfigures.
  const extensions = useMemo(
    () => [
      // Vim first, so it sees keys before the other keymaps.
      ...(vim ? [Prec.highest(vimKeys({ status: true })), relativeLineNumbers] : []),
      markdown(),
      wikilinkCompletion(titles.get),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': label }),
    ],
    [vim, label, titles],
  );

  // From Preview: switch to the editor; it focuses once its view exists.
  useImperativeHandle(
    handle,
    () => ({
      focus: () => {
        if (mode === 'preview') setMode('edit');
        focus();
      },
    }),
    [mode, focus],
  );
  useCommandHandler('km.markdown.togglePreview', () => {
    setMode((m) => (m === 'preview' ? 'edit' : 'preview'));
  });
  useCommandHandler('km.markdown.openPreviewToSide', () => {
    setMode('split');
  });
  useCommandHandler('km.markdown.cycleMode', () => {
    const next = MODES[(MODES.indexOf(mode) + 1) % MODES.length] ?? 'edit';
    setMode(next);
    if (next === 'edit') focus(); // back to typing
  });
  useCommandHandler('km.markdown.showEditor', () => {
    setMode('edit');
    focus(); // once its view exists
  });

  const tips: Record<Mode, TooltipProps> = {
    edit: useCommandTooltip('km.markdown.showEditor'),
    preview: useCommandTooltip('km.markdown.togglePreview'),
    split: useCommandTooltip('km.markdown.openPreviewToSide'),
  };

  return (
    <div className={`markdown-editor mode-${mode}`}>
      <div className="markdown-toolbar">
        <div className="segmented" role="tablist" aria-label={t('markdown.modes')}>
          {MODES.map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              {...tips[m]}
              onClick={() => {
                setMode(m);
              }}
            >
              {t(`markdown.mode.${m}`)}
            </button>
          ))}
        </div>
        <ModeHint />
      </div>
      <div
        className="markdown-panes"
        data-km-vim={vim ? '' : undefined}
        // Capture: before CodeMirror (and vim) get the key.
        onKeyDownCapture={(e) => {
          const view = cmRef.current?.view;
          if (!vim || !(e.target instanceof Node) || !view?.contentDOM.contains(e.target)) return;
          if (vimCtrlBracket(e, view)) {
            e.preventDefault();
            e.stopPropagation();
          } else if (vimExitKey(e, view, 'k', onFirstLine)) {
            e.preventDefault();
            e.stopPropagation();
            onExitUp();
          }
        }}
      >
        {mode !== 'preview' && (
          <CodeMirror
            ref={cmRef}
            onCreateEditor={onCreateEditor}
            className="markdown-source"
            value={value}
            onChange={onChange}
            extensions={extensions}
            theme="dark"
            placeholder={t('markdown.placeholder')}
            // Under vim, relative numbers replace the absolute ones.
            basicSetup={{ foldGutter: false, highlightActiveLine: false, lineNumbers: !vim }}
          />
        )}
        {mode !== 'edit' && (
          <article className="markdown-preview" data-testid="markdown-preview">
            <WikiMarkdown>{value}</WikiMarkdown>
          </article>
        )}
      </div>
    </div>
  );
}

/**
 * The keys for the modes, with the user's current bindings, like the
 * title/content hint above: "[Alt+V] edit → split → preview" (or, with that
 * one unbound, each mode's own key).
 */
function ModeHint() {
  const { tx } = useI18n();
  const bindings = useBindings();
  const cycle = bindings.get('km.markdown.cycleMode')?.[0];
  if (cycle) {
    return (
      <p className="editor-hint mode-hint" data-testid="mode-hint">
        {tx('markdown.hintCycle', { keys: <Keys binding={cycle} /> })}
      </p>
    );
  }
  const parts = (
    [
      ['km.markdown.showEditor', 'markdown.hintEdit'],
      ['km.markdown.openPreviewToSide', 'markdown.hintSplit'],
      ['km.markdown.togglePreview', 'markdown.hintPreview'],
    ] as const
  ).flatMap(([id, key]) => {
    const binding = bindings.get(id)?.[0];
    return binding ? [{ id, text: tx(key, { keys: <Keys binding={binding} /> }) }] : [];
  });
  if (parts.length === 0) return null;
  return (
    <p className="editor-hint mode-hint" data-testid="mode-hint">
      {parts.map((part, i) => (
        <Fragment key={part.id}>
          {i > 0 && ' · '}
          {part.text}
        </Fragment>
      ))}
    </p>
  );
}
