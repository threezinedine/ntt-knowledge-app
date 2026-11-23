import { tagNameSchema, wouldCreateTagCycle, type Tag, type TagTreeNode } from '@km/core';
import { useMemo, useRef, useState, type KeyboardEvent, type Ref, type SubmitEvent } from 'react';
import { useCreateTag, useDeleteTag, useUpdateTag } from '../../api/queries';
import { useCommandHandler } from '../../commands/registry';
import { tooltip, useCommandTooltip, type TooltipProps } from '../../commands/useCommandTooltip';
import { useI18n } from '../../i18n/context';
import { DEFAULT_TAG_COLOR } from './colors';
import { tagDragSource, useTagDropTarget } from './dnd';
import { useTagIndex } from './useTagIndex';

export function TagsPage() {
  const index = useTagIndex();
  const updateTag = useUpdateTag();
  const { t, tx, errorText } = useI18n();
  const newTagRef = useRef<HTMLInputElement>(null);
  const newTagTip = useCommandTooltip('km.tags.new');
  useCommandHandler('km.tags.new', () => {
    newTagRef.current?.focus();
  });
  const move = (tagId: string, parentId: string | null) => {
    updateTag.mutate({ id: tagId, patch: { parentId } });
  };

  // The whole page is the "top level" drop target: dropping a nested tag
  // anywhere that isn't a tag row un-nests it. Rows claim their own drops
  // (even rejected ones), so this only ever sees the leftovers.
  const parentOf = useMemo(() => new Map(index.all.map((t) => [t.id, t.parentId])), [index.all]);
  const { isOver, dropProps } = useTagDropTarget(
    (tagId) => {
      move(tagId, null);
    },
    (tagId) => (parentOf.get(tagId) ?? null) !== null,
  );

  return (
    <div
      className={`tags-page${isOver ? ' is-root-target' : ''}`}
      data-testid="tags-page"
      {...dropProps}
    >
      <h2>{t('tags.heading')}</h2>
      <p className="muted">
        {tx('tags.help', { top: <kbd>⤒</kbd>, add: <kbd>+</kbd>, edit: <kbd>✎</kbd> })}
      </p>
      <NewTagForm
        parentId={null}
        label={t('tags.newTopLevel')}
        inputRef={newTagRef}
        submitTooltip={newTagTip}
      />
      {index.error && <p className="error">{errorText(index.error)}</p>}
      {updateTag.isError && <p className="error">{errorText(updateTag.error)}</p>}
      {!index.isPending && index.all.length === 0 && <p className="muted">{t('tags.empty')}</p>}
      {index.all.length > 0 && (
        <div className="root-drop" data-testid="tag-root-drop">
          {t('tags.rootDrop')}
        </div>
      )}
      <TagList nodes={index.tree} all={index.all} onMove={move} />
    </div>
  );
}

type MoveFn = (tagId: string, parentId: string | null) => void;

function TagList(props: { nodes: TagTreeNode[]; all: Tag[]; onMove: MoveFn }) {
  if (props.nodes.length === 0) return null;
  return (
    <ul className="tag-tree">
      {props.nodes.map((node) => (
        <TagRow key={node.tag.id} node={node} all={props.all} onMove={props.onMove} />
      ))}
    </ul>
  );
}

type Mode = 'view' | 'edit' | 'add-child' | 'confirm-delete';

function TagRow({ node, all, onMove }: { node: TagTreeNode; all: Tag[]; onMove: MoveFn }) {
  const { tag, children } = node;
  const [mode, setMode] = useState<Mode>('view');
  const [expanded, setExpanded] = useState(true);
  const deleteTag = useDeleteTag();
  const { t, errorText } = useI18n();
  const hasChildren = children.length > 0;
  const backToView = () => {
    setMode('view');
  };

  // Dropping a tag on this row nests it here, unless that would be a no-op or a cycle.
  const { isOver, dropProps } = useTagDropTarget(
    (draggedId) => {
      onMove(draggedId, tag.id);
      setExpanded(true);
    },
    (draggedId) =>
      all.find((t) => t.id === draggedId)?.parentId !== tag.id &&
      !wouldCreateTagCycle(all, draggedId, tag.id),
  );

  return (
    <li data-testid={`tag-${tag.name}`}>
      {mode === 'edit' ? (
        <EditTagForm tag={tag} all={all} onDone={backToView} />
      ) : (
        <div
          className={`tag-row${isOver ? ' is-drop-target' : ''}`}
          data-testid={`tag-row-${tag.name}`}
          {...tagDragSource(tag.id)}
          {...dropProps}
        >
          <button
            type="button"
            className="icon subtle toggle"
            aria-label={t(expanded ? 'tags.collapse' : 'tags.expand', { name: tag.name })}
            aria-expanded={hasChildren ? expanded : undefined}
            disabled={!hasChildren}
            onClick={() => {
              setExpanded((v) => !v);
            }}
          >
            {hasChildren ? (expanded ? '▾' : '▸') : '·'}
          </button>
          <span className="drag-grip" aria-hidden="true">
            ⠿
          </span>
          <span className="color-dot" style={{ background: tag.color ?? DEFAULT_TAG_COLOR }} />
          <span className="tag-name">{tag.name}</span>
          {hasChildren && <span className="muted count">{children.length}</span>}
          <span className="row-actions">
            <button
              type="button"
              className="icon subtle"
              aria-label={t('tags.addChild', { name: tag.name })}
              onClick={() => {
                setMode('add-child');
                setExpanded(true);
              }}
            >
              +
            </button>
            {tag.parentId !== null && (
              <button
                type="button"
                className="icon subtle"
                aria-label={t('tags.moveTop', { name: tag.name })}
                {...tooltip(t('tags.moveTopTitle'))}
                onClick={() => {
                  onMove(tag.id, null);
                }}
              >
                ⤒
              </button>
            )}
            <button
              type="button"
              className="icon subtle"
              aria-label={t('tags.edit', { name: tag.name })}
              onClick={() => {
                setMode('edit');
              }}
            >
              ✎
            </button>
            <button
              type="button"
              className="icon danger subtle"
              aria-label={t('tags.delete', { name: tag.name })}
              // The server refuses too (409); don't offer a dead end.
              disabled={hasChildren}
              title={hasChildren ? t('tags.deleteBlocked') : undefined}
              onClick={() => {
                setMode('confirm-delete');
              }}
            >
              ×
            </button>
          </span>
        </div>
      )}

      {mode === 'confirm-delete' && (
        <div className="confirm-row inset">
          <span>{t('tags.deleteConfirm', { name: tag.name })}</span>
          <button
            type="button"
            className="danger"
            disabled={deleteTag.isPending}
            onClick={() => {
              deleteTag.mutate(tag.id, { onSuccess: backToView });
            }}
          >
            {t('common.delete')}
          </button>
          <button
            type="button"
            className="subtle"
            onClick={() => {
              deleteTag.reset();
              backToView();
            }}
          >
            {t('common.cancel')}
          </button>
          {deleteTag.isError && <p className="error">{errorText(deleteTag.error)}</p>}
        </div>
      )}

      {mode === 'add-child' && (
        <div className="inset">
          <NewTagForm
            parentId={tag.id}
            label={t('tags.newChild', { name: tag.name })}
            autoFocus
            onDone={backToView}
          />
        </div>
      )}

      {expanded && <TagList nodes={children} all={all} onMove={onMove} />}
    </li>
  );
}

function NewTagForm({
  parentId,
  label,
  autoFocus,
  inputRef,
  submitTooltip,
  onDone,
}: {
  parentId: string | null;
  label: string;
  autoFocus?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  /** For the top-level form, whose input the "New Top-Level Tag" command focuses. */
  submitTooltip?: TooltipProps;
  /** When set, the form is transient: closes after a successful add or on Escape. */
  onDone?: () => void;
}) {
  const [name, setName] = useState('');
  const createTag = useCreateTag();
  const { t, errorText } = useI18n();
  const valid = tagNameSchema.safeParse(name).success;

  const submit = (e: SubmitEvent) => {
    e.preventDefault();
    if (!valid) return;
    createTag.mutate(
      { name, parentId },
      {
        onSuccess: () => {
          setName('');
          onDone?.();
        },
      },
    );
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') onDone?.();
  };

  return (
    <form className="toolbar" onSubmit={submit} aria-label={label}>
      <input
        ref={inputRef}
        aria-label={label}
        placeholder={label}
        autoFocus={autoFocus}
        value={name}
        onKeyDown={onKeyDown}
        onChange={(e) => {
          setName(e.target.value);
        }}
      />
      <button type="submit" disabled={!valid || createTag.isPending} {...submitTooltip}>
        {t('common.add')}
      </button>
      {onDone && (
        <button type="button" className="subtle" onClick={onDone}>
          {t('common.cancel')}
        </button>
      )}
      {createTag.isError && <span className="error">{errorText(createTag.error)}</span>}
    </form>
  );
}

function EditTagForm(props: { tag: Tag; all: Tag[]; onDone: () => void }) {
  const { tag, all } = props;
  const index = useTagIndex();
  const [name, setName] = useState(tag.name);
  const [color, setColor] = useState(tag.color);
  const [parentId, setParentId] = useState(tag.parentId ?? '');
  const updateTag = useUpdateTag();
  const { t, errorText } = useI18n();
  const valid = tagNameSchema.safeParse(name).success;

  // Only parents that can't create a cycle (not itself, not its descendants).
  const parentOptions = useMemo(
    () => index.flat.filter((n) => !wouldCreateTagCycle(all, tag.id, n.tag.id)),
    [index.flat, all, tag.id],
  );

  const submit = (e: SubmitEvent) => {
    e.preventDefault();
    if (!valid) return;
    updateTag.mutate(
      { id: tag.id, patch: { name, color, parentId: parentId || null } },
      { onSuccess: props.onDone },
    );
  };

  return (
    <form
      className="toolbar tag-edit"
      onSubmit={submit}
      aria-label={t('tags.editForm', { name: tag.name })}
      onKeyDown={(e) => {
        if (e.key === 'Escape') props.onDone();
      }}
    >
      <input
        aria-label={t('tags.name')}
        autoFocus
        value={name}
        onChange={(e) => {
          setName(e.target.value);
        }}
      />
      <input
        type="color"
        aria-label={t('tags.color')}
        value={color ?? DEFAULT_TAG_COLOR}
        onChange={(e) => {
          setColor(e.target.value);
        }}
      />
      {color !== null && (
        <button
          type="button"
          className="subtle small"
          onClick={() => {
            setColor(null);
          }}
        >
          {t('tags.noColor')}
        </button>
      )}
      <select
        aria-label={t('tags.parent')}
        value={parentId}
        onChange={(e) => {
          setParentId(e.target.value);
        }}
      >
        <option value="">{t('tags.topLevel')}</option>
        {parentOptions.map((n) => (
          <option key={n.tag.id} value={n.tag.id}>
            {n.path.join(' / ')}
          </option>
        ))}
      </select>
      <button type="submit" disabled={!valid || updateTag.isPending}>
        {t('common.save')}
      </button>
      <button type="button" className="subtle" onClick={props.onDone}>
        {t('common.cancel')}
      </button>
      {updateTag.isError && <span className="error">{errorText(updateTag.error)}</span>}
    </form>
  );
}
