import { nodeTitleSchema, nodeTypeSchema, type GraphNode } from '@km/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useUpdateNode } from '../../api/queries';
import { useCommandHandler } from '../../commands/registry';
import { useCommandTooltip } from '../../commands/useCommandTooltip';
import { useAutosave } from '../../hooks/useAutosave';
import { useI18n } from '../../i18n/context';
import { JumpHint } from './JumpHint';
import { MarkdownEditor } from './MarkdownEditor';
import { wantsTitleFocus } from './navState';
import { draftToPatch, type NodeDraft as Draft } from './nodeDraft';
import { TitleField, type FieldHandle } from './TitleField';
import { setVimMode, useVimMode } from '../../settings/vimSetting';

/**
 * Owns the local draft. It is initialised from the server once (the parent
 * keys this component by node id) and never overwritten by refetches, so a
 * background refresh can't clobber what the user is typing.
 */
export function NodeEditor({ node }: { node: GraphNode }) {
  const [draft, setDraft] = useState<Draft>({
    title: node.title,
    type: node.type,
    content: node.content,
  });
  const { mutateAsync: updateNode } = useUpdateNode();
  const save = useCallback(
    (value: Draft) => updateNode({ id: node.id, patch: draftToPatch(value) }),
    [node.id, updateNode],
  );
  const autosave = useAutosave(save);
  const { t } = useI18n();
  const vim = useVimMode();
  // Toggling vim swaps the title's element (input <-> CodeMirror), dropping
  // focus; if the title was the last field in use, put the caret back.
  const titleWasLast = useRef(false);
  const prevVim = useRef(vim);
  useEffect(() => {
    const changed = prevVim.current !== vim;
    prevVim.current = vim;
    if (!changed || !titleWasLast.current) return;
    // After the palette (if that's where it came from) has restored focus.
    const frame = requestAnimationFrame(() => {
      // Only if focus was dropped (or is still here), not moved elsewhere.
      const active = document.activeElement;
      if (active && active !== document.body && !active.closest('.node-editor')) return;
      titleRef.current?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [vim]);
  const vimTip = useCommandTooltip('km.editor.toggleVim');
  const titleRef = useRef<FieldHandle>(null);
  const contentRef = useRef<FieldHandle>(null);
  const focusTitle = useCallback(() => {
    titleRef.current?.focus();
  }, []);
  const focusContent = useCallback(() => {
    contentRef.current?.focus();
  }, []);
  useCommandHandler('km.node.rename', () => {
    titleRef.current?.focus(true);
  });
  useCommandHandler('km.node.focusTitle', focusTitle);
  useCommandHandler('km.node.focusContent', focusContent);

  const location = useLocation();
  const navigate = useNavigate();
  const isNew = wantsTitleFocus(location.state);
  useEffect(() => {
    if (!isNew) return;
    titleRef.current?.focus(true);
    // Once only: not again on reload or when coming back to this entry.
    void navigate(location, { replace: true, state: null });
  }, [isNew, location, navigate]);

  const titleValid = nodeTitleSchema.safeParse(draft.title).success;
  const typeValid = nodeTypeSchema.safeParse(draft.type).success;

  const change = (patch: Partial<Draft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    autosave.update(next); // invalid fields are dropped per-field in draftToPatch
  };

  return (
    <div
      className="node-editor"
      onFocusCapture={(e) => {
        if (e.target instanceof Element && e.target.closest('.vim-toggle')) return;
        titleWasLast.current =
          e.target instanceof Element && e.target.closest('.title-input') !== null;
      }}
    >
      <div className="node-editor-header">
        <TitleField
          handle={titleRef}
          label={t('editor.title')}
          invalid={!titleValid}
          vim={vim}
          value={draft.title}
          onChange={(title) => {
            change({ title });
          }}
          onExit={focusContent}
        />
        <button
          type="button"
          className="subtle small vim-toggle"
          aria-pressed={vim}
          {...vimTip}
          onClick={() => {
            setVimMode(!vim);
          }}
        >
          {t('editor.vim')}
        </button>
        <span className={`save-status ${autosave.status}`} data-testid="save-status">
          {t(`editor.status.${autosave.status}`)}
        </span>
      </div>
      <JumpHint vim={vim} />
      <label className="inline-field">
        {t('editor.type')}
        <input
          aria-label={t('editor.type')}
          aria-invalid={!typeValid}
          value={draft.type}
          onChange={(e) => {
            change({ type: e.target.value });
          }}
        />
      </label>
      {!titleValid && <p className="error">{t('editor.titleInvalid')}</p>}
      {!typeValid && <p className="error">{t('editor.typeInvalid')}</p>}
      <MarkdownEditor
        handle={contentRef}
        vim={vim}
        onExitUp={focusTitle}
        value={draft.content}
        onChange={(content) => {
          change({ content });
        }}
      />
    </div>
  );
}
