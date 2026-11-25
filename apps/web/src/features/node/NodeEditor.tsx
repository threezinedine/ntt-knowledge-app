import { nodeTitleSchema, nodeTypeSchema, type GraphNode } from '@km/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useSyncWikilinks, useUpdateNode } from '../../api/queries';
import { useCommandHandler } from '../../commands/registry';
import { useCommandTooltip } from '../../commands/useCommandTooltip';
import { useAutosave } from '../../hooks/useAutosave';
import { isCoarsePointer } from '../../hooks/pointer';
import { useI18n } from '../../i18n/context';
import { JumpHint } from './JumpHint';
import { KeyboardIndicator } from './KeyboardIndicator';
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

  // [[Wikilinks]]: once the user leaves a node they edited (not while typing,
  // so half-typed words and titles never get linked), link its mentions and,
  // if it was renamed, rewrite links to its old title (the engine remembers
  // it, also across a closed tab). After the last save.
  const syncWikilinks = useSyncWikilinks();
  const syncRef = useRef(syncWikilinks);
  useEffect(() => {
    syncRef.current = syncWikilinks;
  });
  const edited = useRef(false);
  const { flush } = autosave;
  useEffect(
    () => () => {
      if (!edited.current) return;
      const sync = syncRef.current;
      void flush()
        // Not after a failed save: the retry would then overwrite the rewrite.
        .then((saved) => (saved ? sync(node.id, false) : undefined))
        .catch((error: unknown) => {
          console.error('Wikilink update failed', error);
        });
    },
    [flush, node.id],
  );

  // Text rewritten elsewhere (another node's rename linked a mention here):
  // take it, unless the user has edits of their own since the last save.
  const serverContent = useRef(node.content);
  const statusRef = useRef(autosave.status);
  useEffect(() => {
    statusRef.current = autosave.status;
  });
  useEffect(() => {
    const before = serverContent.current;
    if (node.content === before) return;
    serverContent.current = node.content;
    if (statusRef.current === 'saved') {
      setDraft((d) => (d.content === before ? { ...d, content: node.content } : d));
    }
  }, [node.content]);
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
  // Opening a node puts the caret in its content, ready to type (a new node,
  // or Rename, focuses the title instead, below). Once per node: this
  // component is keyed by node id. Not on touch screens: the on-screen
  // keyboard would cover half the note every time it is opened to read.
  const contentOnOpen = useRef(!isNew && !isCoarsePointer());
  useEffect(() => {
    if (contentOnOpen.current) contentRef.current?.focus();
  }, []);
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
    if (next.title !== draft.title || next.content !== draft.content) edited.current = true;
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
        {vim && <KeyboardIndicator />}
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
