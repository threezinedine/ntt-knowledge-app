import { useState, type DragEvent } from 'react';

/** Custom MIME type so only our tag chips are accepted by tag drop zones. */
export const TAG_MIME = 'application/x-km-tag';

/**
 * Browsers hide dataTransfer *values* during dragover (only types are
 * readable), but drop targets need the id to validate early (e.g. "can't
 * drop a tag into its own subtree"), so the active drag is mirrored here.
 */
let activeTagDrag: string | null = null;

export const activeDraggedTag = (): string | null => activeTagDrag;

/** Props that make an element a draggable tag. */
export function tagDragSource(tagId: string) {
  return {
    draggable: true,
    onDragStart: (e: DragEvent) => {
      e.stopPropagation(); // nested tree rows: only the grabbed tag drags
      e.dataTransfer.setData(TAG_MIME, tagId);
      e.dataTransfer.setData('text/plain', tagId);
      e.dataTransfer.effectAllowed = 'copyMove';
      activeTagDrag = tagId;
    },
    onDragEnd: () => {
      activeTagDrag = null;
    },
  };
}

const isTagDrag = (e: DragEvent) => e.dataTransfer.types.includes(TAG_MIME);

/**
 * Drop-target behaviour for tags. `accepts` can veto a specific tag (checked
 * on hover so the cursor shows "not allowed"); `onDropTag` runs on drop.
 */
export function useTagDropTarget(
  onDropTag: (tagId: string) => void,
  accepts: (tagId: string) => boolean = () => true,
) {
  const [isOver, setIsOver] = useState(false);

  const canAccept = (e: DragEvent) => {
    if (!isTagDrag(e)) return false;
    const dragged = activeTagDrag;
    return dragged === null || accepts(dragged);
  };

  // The innermost tag target always owns the event, even when it rejects the
  // tag: a rejected drop must not fall through to an enclosing target (e.g.
  // dropping a tag on its current parent must not make it top-level).
  const claim = (e: DragEvent) => {
    if (isTagDrag(e)) e.stopPropagation();
  };

  return {
    isOver,
    dropProps: {
      onDragOver: (e: DragEvent) => {
        claim(e);
        if (!canAccept(e)) return; // no preventDefault → "not allowed" cursor
        e.preventDefault(); // allow drop
        e.dataTransfer.dropEffect = 'copy';
        setIsOver(true);
      },
      onDragLeave: (e: DragEvent) => {
        // Ignore leave events fired when moving onto a child element.
        if (e.currentTarget.contains(e.relatedTarget as globalThis.Node | null)) return;
        setIsOver(false);
      },
      onDrop: (e: DragEvent) => {
        claim(e);
        setIsOver(false);
        if (!canAccept(e)) return;
        e.preventDefault();
        e.stopPropagation();
        const tagId = e.dataTransfer.getData(TAG_MIME);
        if (tagId && accepts(tagId)) onDropTag(tagId);
        activeTagDrag = null;
      },
    },
  };
}
