import { history } from '@codemirror/commands';
import { Prec } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { vim as vimKeys } from '@replit/codemirror-vim';
import CodeMirror from '@uiw/react-codemirror';
import { useEffect, useImperativeHandle, useMemo, useRef, type Ref } from 'react';
import { useCodeMirrorFocus } from './cmFocus';
import { singleLine, vimCtrlBracket, vimExitKey } from './vim';

export interface FieldHandle {
  /** Focuses the field; `selectAll` selects its text (Visual mode under vim). */
  focus: (selectAll?: boolean) => void;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  label: string;
  invalid: boolean;
  vim: boolean;
  /** Enter (or "j" in vim Normal mode): go on to the content. */
  onExit: () => void;
  handle: Ref<FieldHandle>;
}

const always = () => true;

/**
 * The node title: a plain input, or, with vim keys on, a one-line CodeMirror
 * so Normal/Insert/Visual work there too.
 */
export function TitleField({ value, onChange, label, invalid, vim, onExit, handle }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { cmRef, focus, onCreateEditor } = useCodeMirrorFocus();

  useImperativeHandle(
    handle,
    () => ({
      focus: (selectAll = false) => {
        if (!vim) {
          inputRef.current?.focus();
          if (selectAll) inputRef.current?.select();
          return;
        }
        focus(selectAll);
      },
    }),
    [vim, focus],
  );

  // Stable per label (cheaper reconfigures); vim keeps its state either way.
  const extensions = useMemo(
    () => [
      Prec.highest(vimKeys()),
      singleLine,
      history(), // vim u / Ctrl+R
      EditorView.contentAttributes.of({ 'aria-label': label, 'aria-multiline': 'false' }),
    ],
    [label],
  );
  // Not via contentAttributes: changing those would rebuild the extensions.
  useEffect(() => {
    cmRef.current?.view?.contentDOM.setAttribute('aria-invalid', String(invalid));
  }, [cmRef, invalid]);

  if (!vim) {
    return (
      <input
        ref={inputRef}
        className="title-input"
        aria-label={label}
        aria-invalid={invalid}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            onExit();
          }
        }}
      />
    );
  }
  return (
    <div
      className="title-input title-vim"
      data-km-vim=""
      // Capture: before CodeMirror (and vim) get the key.
      onKeyDownCapture={(e) => {
        const view = cmRef.current?.view;
        // Only keys typed in the editor itself, not in vim's / and : prompts.
        if (!(e.target instanceof Node) || !view?.contentDOM.contains(e.target)) return;
        if (vimCtrlBracket(e, view)) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        const enter = e.key === 'Enter' && !e.nativeEvent.isComposing;
        if (enter || vimExitKey(e, view, 'j', always)) {
          e.preventDefault();
          e.stopPropagation();
          onExit();
        }
      }}
    >
      <CodeMirror
        ref={cmRef}
        onCreateEditor={(view) => {
          view.contentDOM.setAttribute('aria-invalid', String(invalid));
          onCreateEditor(view);
        }}
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme="dark"
        basicSetup={false}
      />
    </div>
  );
}
