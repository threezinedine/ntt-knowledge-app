import type { TagTreeNode } from '@km/core';
import type { CSSProperties } from 'react';
import { useI18n } from '../../i18n/context';
import { tagDragSource } from './dnd';
import { useTagColor } from './useTagIndex';

interface Props {
  node: TagTreeNode;
  /** Show "Work / Backend" instead of just "Backend". */
  showPath?: boolean;
  /** Renders a × button. */
  onRemove?: () => void;
  /** Click handler (e.g. palette: click to attach, for touch users). */
  onClick?: () => void;
  /** With onClick: already applied, so the button is pressed and inert. */
  pressed?: boolean;
  draggable?: boolean;
}

export function TagChip({
  node,
  showPath = false,
  onRemove,
  onClick,
  pressed = false,
  draggable = false,
}: Props) {
  const { t } = useI18n();
  const label = showPath ? node.path.join(' / ') : node.tag.name;
  const style = { '--tag-color': useTagColor(node.tag.id) } as CSSProperties;
  const body = (
    <>
      <span className="color-dot" />
      <span className="tag-chip-label">{label}</span>
    </>
  );

  return (
    <span
      className={`tag-chip${draggable ? ' is-draggable' : ''}`}
      style={style}
      title={node.path.join(' / ')}
      data-testid={`tag-chip-${node.tag.name}`}
      {...(draggable ? tagDragSource(node.tag.id) : {})}
    >
      {onClick ? (
        <button
          type="button"
          className="tag-chip-main"
          onClick={onClick}
          aria-pressed={pressed}
          disabled={pressed}
          aria-label={t('tags.chipAdd', { label })}
        >
          {body}
        </button>
      ) : (
        body
      )}
      {onRemove && (
        <button
          type="button"
          className="tag-chip-remove"
          aria-label={t('tags.chipRemove', { name: node.tag.name })}
          onClick={onRemove}
        >
          ×
        </button>
      )}
    </span>
  );
}
