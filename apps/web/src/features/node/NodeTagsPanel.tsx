import type { GraphNode } from '@km/core';
import { useRef, useState } from 'react';
import { useTagLink } from '../../api/queries';
import { useCommandHandler } from '../../commands/registry';
import { useI18n } from '../../i18n/context';
import { OwnerTags } from '../tags/OwnerTags';
import { TagPalette } from '../tags/TagPalette';
import { useTagIndex } from '../tags/useTagIndex';

/**
 * The node's own tags (a drop zone) plus a palette of every tag to drag onto
 * the node or onto any task below. Clicking a palette chip tags the node.
 */
export function NodeTagsPanel({ node }: { node: GraphNode }) {
  const index = useTagIndex();
  const link = useTagLink('nodes');
  const [showPalette, setShowPalette] = useState(true);
  const { t, errorText } = useI18n();
  const sectionRef = useRef<HTMLElement>(null);
  // Focus the node's own "+ tag" picker (absent once every tag is attached).
  useCommandHandler('km.node.addTag', () => {
    sectionRef.current
      ?.querySelector<HTMLSelectElement>('.owner-tags > select.tag-picker')
      ?.focus();
  });

  return (
    <section className="panel" aria-label={t('tags.heading')} ref={sectionRef}>
      <h3>{t('tags.heading')}</h3>
      <OwnerTags
        kind="nodes"
        ownerId={node.id}
        ownerLabel={node.title}
        tagIds={node.tagIds}
        index={index}
      />
      <button
        type="button"
        className="subtle small palette-toggle"
        aria-expanded={showPalette}
        onClick={() => {
          setShowPalette((v) => !v);
        }}
      >
        {t(showPalette ? 'tags.paletteHide' : 'tags.paletteShow')}
      </button>
      {showPalette && (
        <TagPalette
          index={index}
          pickedIds={node.tagIds}
          onPick={(tagId) => {
            link.mutate({ ownerId: node.id, tagId, attached: true });
          }}
        />
      )}
      {link.isError && <p className="error">{errorText(link.error)}</p>}
    </section>
  );
}
