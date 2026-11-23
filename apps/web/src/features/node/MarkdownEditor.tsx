import { markdown } from '@codemirror/lang-markdown';
import CodeMirror, { EditorView } from '@uiw/react-codemirror';
import { useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const extensions = [markdown(), EditorView.lineWrapping];

interface Props {
  value: string;
  onChange: (value: string) => void;
}

type Mode = 'edit' | 'preview' | 'split';

export function MarkdownEditor({ value, onChange }: Props) {
  const [mode, setMode] = useState<Mode>('edit');

  return (
    <div className={`markdown-editor mode-${mode}`}>
      <div className="segmented" role="tablist" aria-label="Editor mode">
        {(['edit', 'split', 'preview'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m);
            }}
          >
            {m[0]?.toUpperCase()}
            {m.slice(1)}
          </button>
        ))}
      </div>
      <div className="markdown-panes">
        {mode !== 'preview' && (
          <CodeMirror
            className="markdown-source"
            value={value}
            onChange={onChange}
            extensions={extensions}
            theme="dark"
            placeholder="Write markdown…"
            basicSetup={{ foldGutter: false, highlightActiveLine: false }}
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
