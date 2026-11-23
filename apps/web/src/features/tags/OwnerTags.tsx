import type { TaggableKind } from '@km/core';
import { useTagLink } from '../../api/queries';
import { useI18n } from '../../i18n/context';
import { useTagDropTarget } from './dnd';
import { TagChip } from './TagChip';
import { sortTagIds, type TagIndex } from './useTagIndex';

interface Props {
  kind: TaggableKind;
  ownerId: string;
  /** For accessible names, e.g. the node or task title. */
  ownerLabel: string;
  tagIds: readonly string[];
  index: TagIndex;
  /** Compact = inline on a task row (no empty-state hint). */
  compact?: boolean;
  /** Set false when an enclosing element (e.g. the task row) is the drop target. */
  droppable?: boolean;
}

/**
 * The tags on one node/task: chips with ×, a drop zone for dragged tags, and
 * a select as the touch/keyboard fallback for attaching.
 */
export function OwnerTags({
  kind,
  ownerId,
  ownerLabel,
  tagIds,
  index,
  compact = false,
  droppable = true,
}: Props) {
  const link = useTagLink(kind);
  const { t, errorText } = useI18n();
  const attached = new Set(tagIds);
  const attach = (tagId: string) => {
    link.mutate({ ownerId, tagId, attached: true });
  };
  const { isOver, dropProps } = useTagDropTarget(attach, (tagId) => !attached.has(tagId));
  const chips = sortTagIds(tagIds, index);
  const available = index.flat.filter((n) => !attached.has(n.tag.id));

  return (
    <div
      className={`owner-tags${compact ? ' compact' : ''}${isOver ? ' is-drop-target' : ''}`}
      role="group"
      aria-label={t('tags.of', { owner: ownerLabel })}
      data-testid={`tags-of-${ownerLabel}`}
      {...(droppable ? dropProps : {})}
    >
      {chips.map((node) => (
        <TagChip
          key={node.tag.id}
          node={node}
          showPath={!compact}
          onRemove={() => {
            link.mutate({ ownerId, tagId: node.tag.id, attached: false });
          }}
        />
      ))}
      {!compact && chips.length === 0 && (
        <span className="muted drop-hint">{t('tags.dropHint')}</span>
      )}
      {available.length > 0 && (
        <select
          className="tag-picker"
          aria-label={t('tags.addTo', { owner: ownerLabel })}
          value=""
          onChange={(e) => {
            if (e.target.value) attach(e.target.value);
          }}
        >
          <option value="">{t('tags.picker')}</option>
          {available.map((n) => (
            <option key={n.tag.id} value={n.tag.id}>
              {n.path.join(' / ')}
            </option>
          ))}
        </select>
      )}
      {link.isError && <span className="error">{errorText(link.error)}</span>}
    </div>
  );
}
