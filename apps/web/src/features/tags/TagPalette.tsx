import { Link } from 'react-router';
import { useI18n } from '../../i18n/context';
import { TagChip } from './TagChip';
import type { TagIndex } from './useTagIndex';

/**
 * Every tag as a draggable chip, indented by depth. Drag one onto the node's
 * tag zone or onto any task. Clicking attaches to `onPick` (touch fallback).
 */
export function TagPalette({
  index,
  onPick,
  pickedIds = [],
}: {
  index: TagIndex;
  onPick?: (tagId: string) => void;
  /** Tags already applied to the pick target (shown pressed, not clickable). */
  pickedIds?: readonly string[];
}) {
  const { t, tx } = useI18n();
  if (index.flat.length === 0) {
    return (
      <p className="muted">
        {tx('tags.paletteEmpty', { link: <Link to="/tags">{t('tags.paletteCreate')}</Link> })}
      </p>
    );
  }
  return (
    <ul className="tag-palette" aria-label={t('tags.palette')}>
      {index.flat.map((node) => (
        <li key={node.tag.id} style={{ paddingLeft: node.depth * 12 }}>
          <TagChip
            node={node}
            draggable
            pressed={pickedIds.includes(node.tag.id)}
            {...(onPick
              ? {
                  onClick: () => {
                    onPick(node.tag.id);
                  },
                }
              : {})}
          />
        </li>
      ))}
    </ul>
  );
}
