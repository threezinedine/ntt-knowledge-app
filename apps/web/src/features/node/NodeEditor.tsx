import { nodeTitleSchema, nodeTypeSchema, type GraphNode } from '@km/core';
import { useCallback, useState } from 'react';
import { useUpdateNode } from '../../api/queries';
import { useAutosave } from '../../hooks/useAutosave';
import { useI18n } from '../../i18n/context';
import { MarkdownEditor } from './MarkdownEditor';
import { draftToPatch, type NodeDraft as Draft } from './nodeDraft';

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

  const titleValid = nodeTitleSchema.safeParse(draft.title).success;
  const typeValid = nodeTypeSchema.safeParse(draft.type).success;

  const change = (patch: Partial<Draft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    autosave.update(next); // invalid fields are dropped per-field in draftToPatch
  };

  return (
    <div className="node-editor">
      <div className="node-editor-header">
        <input
          className="title-input"
          aria-label={t('editor.title')}
          aria-invalid={!titleValid}
          value={draft.title}
          onChange={(e) => {
            change({ title: e.target.value });
          }}
        />
        <span className={`save-status ${autosave.status}`} data-testid="save-status">
          {t(`editor.status.${autosave.status}`)}
        </span>
      </div>
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
        value={draft.content}
        onChange={(content) => {
          change({ content });
        }}
      />
    </div>
  );
}
