import { relationNameSchema } from '@km/core';
import { useEffect, useId, useRef, useState, type SubmitEvent } from 'react';
import { useRelationNames } from '../../api/queries';

interface Props {
  sourceTitle: string;
  targetTitle: string;
  error: string | null;
  pending: boolean;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

/** Asks for the relation name after the user drags a connection between two nodes. */
export function RelationDialog({
  sourceTitle,
  targetTitle,
  error,
  pending,
  onSubmit,
  onCancel,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const relations = useRelationNames();
  const listId = useId();
  const valid = relationNameSchema.safeParse(name).success;

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const submit = (e: SubmitEvent) => {
    e.preventDefault();
    if (valid) onSubmit(name);
  };

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-label="New relation"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <form onSubmit={submit}>
        <p>
          <strong>{sourceTitle}</strong> → <strong>{targetTitle}</strong>
        </p>
        <input
          autoFocus
          aria-label="Relation name"
          placeholder="RELATION"
          list={listId}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
          }}
        />
        <datalist id={listId}>
          {relations.data?.map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
        {error && <p className="error">{error}</p>}
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" disabled={!valid || pending}>
            Create link
          </button>
        </div>
      </form>
    </dialog>
  );
}
