import { nodeTitleSchema, nodeTypeSchema, type GraphNode } from '@km/core';
import { useCallback, useState } from 'react';
import { useUpdateNode } from '../../api/queries';
import { useAutosave, type SaveStatus } from '../../hooks/useAutosave';
import { MarkdownEditor } from './MarkdownEditor';
import { draftToPatch, type NodeDraft as Draft } from './nodeDraft';

const STATUS_LABEL: Record<SaveStatus, string> = {
  saved: 'Saved',
  dirty: 'Unsaved',
  saving: 'Saving…',
  error: 'Save failed',
};

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
          aria-label="Title"
          aria-invalid={!titleValid}
          value={draft.title}
          onChange={(e) => {
            change({ title: e.target.value });
          }}
        />
        <span className={`save-status ${autosave.status}`} data-testid="save-status">
          {STATUS_LABEL[autosave.status]}
        </span>
      </div>
      <label className="inline-field">
        Type
        <input
          aria-label="Type"
          aria-invalid={!typeValid}
          value={draft.type}
          onChange={(e) => {
            change({ type: e.target.value });
          }}
        />
      </label>
      {!titleValid && (
        <p className="error">Title is required (max 200 characters). Content is still saved.</p>
      )}
      {!typeValid && <p className="error">Type is required (max 32 characters).</p>}
      <MarkdownEditor
        value={draft.content}
        onChange={(content) => {
          change({ content });
        }}
      />
    </div>
  );
}
