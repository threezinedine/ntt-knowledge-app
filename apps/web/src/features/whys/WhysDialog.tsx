import {
  flattenWhys,
  newId,
  parseWhysText,
  updateWhySessionInputSchema,
  whysDepth,
  whysDocument,
  type GraphNode,
  type WhyItem,
  type WhySession,
} from '@km/core';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  useCreateWhySession,
  useDeleteWhySession,
  useNodeEdges,
  useUpdateWhySession,
  useWhySessions,
} from '../../api/queries';
import { CloseIcon } from '../../components/icons';
import { showToast } from '../../components/toast';
import { useI18n } from '../../i18n/context';
import { useReadOnly } from '../readOnly';
import { buildWhysPrompt, PROMPT_LANGUAGES, WHYS_COMMANDS, type PromptLanguage } from './prompt';
import { promptInput, usePromptLanguage } from './useWhysPrompt';
import { WhyTreeEditor, WhyTreeView } from './WhyTree';

type View = { kind: 'list' } | { kind: 'add' } | { kind: 'session'; id: string };

interface Props {
  node: GraphNode;
  onClose: () => void;
}

/**
 * The 5 Whys of one node: past sessions, a new one (prompt for an AI chat,
 * then paste its JSON back), and editing a saved one. Read-only mode only
 * shows them. Leaving a view with unsaved edits asks first.
 */
export function WhysDialog({ node, onClose }: Props) {
  const { t, errorText } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const sessions = useWhySessions(node.id);
  const [view, setView] = useState<View>({ kind: 'list' });
  const [dirty, setDirty] = useState(false);
  /** What to do once the user agrees to drop unsaved edits. */
  const [pending, setPending] = useState<(() => void) | null>(null);
  const titleId = useId();

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  // Drafts here are not autosaved: closing or reloading the tab asks first.
  // Back navigation inside the app (browser/mouse Back) is not guarded.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [dirty]);

  const guard = (action: () => void) => {
    if (dirty) setPending(() => action);
    else action();
  };
  const go = (next: View) => {
    guard(() => {
      setDirty(false);
      setView(next);
    });
  };
  const close = () => {
    guard(onClose);
  };

  const list = sessions.data ?? [];
  const current = view.kind === 'session' ? list.find((s) => s.id === view.id) : undefined;

  return (
    <dialog
      ref={ref}
      className="dialog whys-dialog"
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header className="whys-header">
        {view.kind !== 'list' && (
          <button
            type="button"
            className="subtle"
            onClick={() => {
              go({ kind: 'list' });
            }}
          >
            {t('whys.back')}
          </button>
        )}
        <h2 id={titleId}>{t('whys.dialog', { title: node.title })}</h2>
        <button type="button" className="whys-close" aria-label={t('whys.close')} onClick={close}>
          <CloseIcon />
        </button>
      </header>

      {pending && (
        <div className="whys-confirm" role="alert">
          <span>{t('whys.unsavedConfirm')}</span>
          <button
            type="button"
            className="danger"
            onClick={() => {
              const action = pending;
              setPending(null);
              setDirty(false);
              action();
            }}
          >
            {t('whys.discard')}
          </button>
          <button
            type="button"
            className="subtle"
            autoFocus
            onClick={() => {
              setPending(null);
            }}
          >
            {t('whys.keepEditing')}
          </button>
        </div>
      )}

      <div className="whys-body">
        {sessions.isError && <p className="error">{errorText(sessions.error)}</p>}
        {view.kind === 'list' && (
          <SessionList
            sessions={list}
            loading={sessions.isPending}
            onAdd={() => {
              go({ kind: 'add' });
            }}
            onOpen={(id) => {
              go({ kind: 'session', id });
            }}
          />
        )}
        {view.kind === 'add' && (
          <AddSession
            node={node}
            sessions={list}
            onDirtyChange={setDirty}
            onSaved={(id) => {
              setDirty(false);
              setView({ kind: 'session', id });
            }}
          />
        )}
        {view.kind === 'session' && current && (
          <SessionDetail
            key={current.id}
            session={current}
            onDirtyChange={setDirty}
            onDeleted={() => {
              setDirty(false);
              setView({ kind: 'list' });
            }}
          />
        )}
        {view.kind === 'session' && !current && sessions.isSuccess && (
          <p className="muted">{t('whys.missing')}</p>
        )}
      </div>
    </dialog>
  );
}

/** Step by step, with the chat commands in both languages. */
function Guide({ open }: { open: boolean }) {
  const { t, tx } = useI18n();
  const cmd = (k: keyof typeof WHYS_COMMANDS) => (
    <span>
      <kbd>{WHYS_COMMANDS[k].en}</kbd> / <kbd>{WHYS_COMMANDS[k].vi}</kbd>
    </span>
  );
  return (
    <details className="whys-guide" open={open}>
      <summary>{t('whys.guide.title')}</summary>
      <p>{t('whys.guide.what')}</p>
      <ol>
        <li>{t('whys.guide.step1')}</li>
        <li>{t('whys.guide.step2')}</li>
        <li>{tx('whys.guide.step3', { deeper: cmd('deeper'), next: cmd('next') })}</li>
        <li>{tx('whys.guide.step4', { end: cmd('end') })}</li>
        <li>{t('whys.guide.step5')}</li>
      </ol>
      <p className="muted">{t('whys.guide.tree')}</p>
    </details>
  );
}

function SessionList({
  sessions,
  loading,
  onAdd,
  onOpen,
}: {
  sessions: readonly WhySession[];
  loading: boolean;
  onAdd: () => void;
  onOpen: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const readOnly = useReadOnly();
  const date = useMemo(
    () => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }),
    [locale],
  );
  return (
    <>
      <Guide open={!loading && sessions.length === 0} />
      <div className="whys-list-header">
        <h3>{t('whys.list')}</h3>
        {!readOnly && (
          <button type="button" onClick={onAdd}>
            {t('whys.add')}
          </button>
        )}
      </div>
      {loading && <p className="muted">{t('common.loading')}</p>}
      {!loading && sessions.length === 0 && <p className="muted">{t('whys.none')}</p>}
      <ul className="whys-sessions">
        {sessions.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              className="whys-session"
              onClick={() => {
                onOpen(s.id);
              }}
            >
              <span className="whys-session-summary">{s.summary || t('whys.noSummary')}</span>
              {s.conclusion && <span className="whys-session-conclusion">{s.conclusion}</span>}
              <span className="muted">
                {t('whys.sessionMeta', {
                  date: date.format(s.createdAt),
                  count: flattenWhys(s.whys).length,
                  depth: whysDepth(s.whys),
                })}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

function useCopy() {
  const { t } = useI18n();
  return (text: string, done: string) => {
    navigator.clipboard.writeText(text).then(
      () => {
        showToast(done);
      },
      () => {
        showToast(t('whys.copyFailed'));
      },
    );
  };
}

function AddSession({
  node,
  sessions,
  onDirtyChange,
  onSaved,
}: {
  node: GraphNode;
  sessions: readonly WhySession[];
  onDirtyChange: (dirty: boolean) => void;
  onSaved: (id: string) => void;
}) {
  const { t, errorText } = useI18n();
  const edges = useNodeEdges(node.id);
  const create = useCreateWhySession(node.id);
  const copy = useCopy();
  const [lang, setLang] = usePromptLanguage();
  const [pasted, setPasted] = useState('');
  const prompt = useMemo(
    () => buildWhysPrompt(promptInput(node, edges.data, sessions), lang),
    [node, edges.data, sessions, lang],
  );
  const parsed = useMemo(() => (pasted.trim() ? parseWhysText(pasted) : null), [pasted]);
  const promptId = useId();
  const pasteId = useId();
  const errorId = useId();

  useEffect(() => {
    onDirtyChange(pasted.trim() !== '');
  }, [pasted, onDirtyChange]);

  return (
    <div className="whys-add">
      <section className="whys-step" aria-labelledby={`${promptId}-h`}>
        <h3 id={`${promptId}-h`}>{t('whys.step1')}</h3>
        <p className="muted">{t('whys.step1Help')}</p>
        <div className="whys-row">
          <label className="whys-inline">
            <span>{t('whys.promptLang')}</span>
            <select
              value={lang}
              onChange={(e) => {
                setLang(e.target.value as PromptLanguage);
              }}
            >
              {PROMPT_LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {t(`whys.lang.${l}`)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => {
              copy(prompt, t('whys.promptCopied'));
            }}
          >
            {t('whys.copyPrompt')}
          </button>
        </div>
        <label htmlFor={promptId} className="visually-hidden">
          {t('whys.prompt')}
        </label>
        <textarea
          id={promptId}
          className="whys-prompt"
          readOnly
          rows={8}
          value={prompt}
          onFocus={(e) => {
            e.currentTarget.select();
          }}
        />
      </section>

      <section className="whys-step" aria-labelledby={`${pasteId}-h`}>
        <h3 id={`${pasteId}-h`}>{t('whys.step2')}</h3>
        <p className="muted">{t('whys.step2Help')}</p>
        <label htmlFor={pasteId} className="visually-hidden">
          {t('whys.paste')}
        </label>
        <textarea
          id={pasteId}
          className="whys-paste"
          rows={6}
          placeholder={t('whys.pastePlaceholder')}
          value={pasted}
          aria-invalid={parsed?.ok === false || undefined}
          aria-describedby={parsed?.ok === false ? errorId : undefined}
          onChange={(e) => {
            setPasted(e.target.value);
          }}
        />
        {parsed?.ok === false && (
          <p id={errorId} className="error">
            {parsed.error.kind === 'badShape'
              ? t('whys.parse.badShape', { path: parsed.error.path || '-' })
              : t(`whys.parse.${parsed.error.kind}`)}
          </p>
        )}
        {parsed?.ok && (
          <div className="whys-preview">
            <h4>{t('whys.preview')}</h4>
            <SessionTexts summary={parsed.value.summary} conclusion={parsed.value.conclusion} />
            <WhyTreeView items={parsed.value.whys} label={t('whys.tree')} />
          </div>
        )}
        {create.isError && <p className="error">{errorText(create.error)}</p>}
        <div className="dialog-actions">
          <button
            type="button"
            className="primary"
            disabled={!parsed?.ok || create.isPending}
            onClick={() => {
              if (!parsed?.ok) return;
              create.mutate(parsed.value, {
                onSuccess: (s) => {
                  showToast(t('whys.saved'));
                  onSaved(s.id);
                },
              });
            }}
          >
            {t('whys.save')}
          </button>
        </div>
      </section>
    </div>
  );
}

function SessionTexts({ summary, conclusion }: { summary: string; conclusion: string }) {
  const { t } = useI18n();
  return (
    <dl className="whys-texts">
      <div>
        <dt>{t('whys.summary')}</dt>
        <dd>{summary || '-'}</dd>
      </div>
      <div>
        <dt>{t('whys.conclusion')}</dt>
        <dd>{conclusion || '-'}</dd>
      </div>
    </dl>
  );
}

interface Draft {
  summary: string;
  conclusion: string;
  whys: WhyItem[];
}

function SessionDetail({
  session,
  onDirtyChange,
  onDeleted,
}: {
  session: WhySession;
  onDirtyChange: (dirty: boolean) => void;
  onDeleted: () => void;
}) {
  const { t, errorText } = useI18n();
  const readOnly = useReadOnly();
  const update = useUpdateWhySession(session.nodeId);
  const remove = useDeleteWhySession(session.nodeId);
  const copy = useCopy();
  const saved: Draft = useMemo(
    () => ({ summary: session.summary, conclusion: session.conclusion, whys: session.whys }),
    [session],
  );
  const [draft, setDraft] = useState<Draft>(saved);
  const [mode, setMode] = useState<'fields' | 'json'>('fields');
  const [json, setJson] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(saved) ||
    (mode === 'json' && json !== whysDocument(draft));
  const valid = updateWhySessionInputSchema.safeParse(draft).success;

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  if (readOnly) {
    return (
      <div className="whys-session-detail">
        <SessionTexts summary={session.summary} conclusion={session.conclusion} />
        <WhyTreeView items={session.whys} label={t('whys.tree')} />
        <div className="dialog-actions">
          <button
            type="button"
            className="subtle"
            onClick={() => {
              copy(whysDocument(session), t('whys.jsonCopied'));
            }}
          >
            {t('whys.copyJson')}
          </button>
        </div>
      </div>
    );
  }

  const applyJson = () => {
    const res = parseWhysText(json);
    if (!res.ok) {
      setJsonError(
        res.error.kind === 'badShape'
          ? t('whys.parse.badShape', { path: res.error.path || '-' })
          : t(`whys.parse.${res.error.kind}`),
      );
      return;
    }
    // Whys without an id (added by hand in the JSON) get one now.
    const withIds = (items: typeof res.value.whys): WhyItem[] =>
      items.map((w) => ({
        id: w.id ?? newId(),
        question: w.question,
        answer: w.answer,
        takeaway: w.takeaway,
        children: withIds(w.children),
      }));
    setDraft({
      summary: res.value.summary,
      conclusion: res.value.conclusion,
      whys: withIds(res.value.whys),
    });
    setJsonError(null);
    setMode('fields');
  };

  return (
    <div className="whys-session-detail">
      <div className="whys-row">
        <div className="segmented" role="tablist" aria-label={t('whys.editMode')}>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'fields'}
            onClick={() => {
              setMode('fields');
              setJsonError(null);
            }}
          >
            {t('whys.editFields')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'json'}
            onClick={() => {
              setJson(whysDocument(draft));
              setJsonError(null);
              setMode('json');
            }}
          >
            {t('whys.editJson')}
          </button>
        </div>
        <button
          type="button"
          className="subtle"
          onClick={() => {
            copy(whysDocument(draft), t('whys.jsonCopied'));
          }}
        >
          {t('whys.copyJson')}
        </button>
      </div>

      {mode === 'fields' ? (
        <>
          <label className="why-field">
            <span>{t('whys.summary')}</span>
            <textarea
              rows={2}
              value={draft.summary}
              onChange={(e) => {
                setDraft({ ...draft, summary: e.target.value });
              }}
            />
          </label>
          <label className="why-field">
            <span>{t('whys.conclusion')}</span>
            <textarea
              rows={2}
              value={draft.conclusion}
              onChange={(e) => {
                setDraft({ ...draft, conclusion: e.target.value });
              }}
            />
          </label>
          <WhyTreeEditor
            items={draft.whys}
            onChange={(whys) => {
              setDraft({ ...draft, whys });
            }}
          />
        </>
      ) : (
        <>
          <label className="why-field">
            <span>{t('whys.json')}</span>
            <textarea
              className="whys-paste"
              rows={14}
              value={json}
              aria-invalid={jsonError !== null || undefined}
              onChange={(e) => {
                setJson(e.target.value);
              }}
            />
          </label>
          {jsonError && <p className="error">{jsonError}</p>}
          <div className="whys-row">
            <button type="button" onClick={applyJson}>
              {t('whys.applyJson')}
            </button>
          </div>
        </>
      )}

      {mode === 'fields' && !valid && <p className="error">{t('whys.invalid')}</p>}
      {update.isError && <p className="error">{errorText(update.error)}</p>}
      {remove.isError && <p className="error">{errorText(remove.error)}</p>}
      <div className="dialog-actions whys-actions">
        {confirmDelete ? (
          <span className="confirm-row">
            <span>{t('whys.deleteConfirm')}</span>
            <button
              type="button"
              className="danger"
              autoFocus
              disabled={remove.isPending}
              onClick={() => {
                remove.mutate(session.id, {
                  onSuccess: () => {
                    showToast(t('whys.deleted'));
                    onDeleted();
                  },
                });
              }}
            >
              {t('whys.deleteConfirmButton')}
            </button>
            <button
              type="button"
              className="subtle"
              onClick={() => {
                setConfirmDelete(false);
              }}
            >
              {t('common.cancel')}
            </button>
          </span>
        ) : (
          <button
            type="button"
            className="danger subtle"
            onClick={() => {
              setConfirmDelete(true);
            }}
          >
            {t('whys.deleteSession')}
          </button>
        )}
        <span className="whys-spacer" />
        {dirty && mode === 'fields' && (
          <button
            type="button"
            className="subtle"
            onClick={() => {
              setDraft(saved);
            }}
          >
            {t('whys.discard')}
          </button>
        )}
        <button
          type="button"
          className="primary"
          disabled={mode !== 'fields' || !dirty || !valid || update.isPending}
          onClick={() => {
            update.mutate(
              { id: session.id, patch: draft },
              {
                onSuccess: (s) => {
                  setDraft({ summary: s.summary, conclusion: s.conclusion, whys: s.whys });
                  showToast(t('whys.saved'));
                },
              },
            );
          }}
        >
          {t('whys.saveChanges')}
        </button>
      </div>
    </div>
  );
}
