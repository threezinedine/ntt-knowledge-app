import { markdown } from '@codemirror/lang-markdown';
import { Prec } from '@codemirror/state';
import { vim as vimKeys } from '@replit/codemirror-vim';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { useImperativeHandle, useMemo, useState, type Ref } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useCommandHandler } from '../../commands/registry';
import { useCommandTooltip, type TooltipProps } from '../../commands/useCommandTooltip';
import { useI18n } from '../../i18n/context';
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

export function MarkdownEditor({ value, onChange, vim, onExitUp, handle }: Props) {
  const [mode, setMode] = useState<Mode>('edit');
  const { t } = useI18n();
  const { cmRef, focus, onCreateEditor } = useCodeMirrorFocus();
  const label = t('editor.content');
  // Stable per (vim, label): cheaper reconfigures.
  const extensions = useMemo(
    () => [
      // Vim first, so it sees keys before the other keymaps.
      ...(vim ? [Prec.highest(vimKeys({ status: true })), relativeLineNumbers] : []),
      markdown(),
      EditorView.lineWrapping,
      EditorView.contentAttributes.of({ 'aria-label': label }),
    ],
    [vim, label],
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

  const tips: Partial<Record<Mode, TooltipProps>> = {
    preview: useCommandTooltip('km.markdown.togglePreview'),
    split: useCommandTooltip('km.markdown.openPreviewToSide'),
  };

  return (
    <div className={`markdown-editor mode-${mode}`}>
      <div className="segmented" role="tablist" aria-label={t('markdown.modes')}>
        {(['edit', 'split', 'preview'] as const).map((m) => (
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
            {/* react-markdown does not render raw HTML by default, so this is XSS-safe. */}
            <Markdown remarkPlugins={[remarkGfm]}>{value}</Markdown>
          </article>
        )}
      </div>
    </div>
  );
}
