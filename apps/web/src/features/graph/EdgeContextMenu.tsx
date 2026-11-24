import { useCallback, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useBindings } from '../../commands/keybindingStore';
import { ContextMenu, type MenuItem } from '../../components/ContextMenu';
import { useI18n } from '../../i18n/context';
import { useReadOnly } from '../readOnly';

export interface MenuEdge {
  id: string;
  name: string;
  from: { id: string; title: string };
  to: { id: string; title: string };
}

const READ_ONLY_ITEMS = new Set(['open-from', 'open-to']);

/**
 * Right-click menu for a link on the graph: rename, open either end, delete.
 * Deleting needs no confirmation, like the Delete key on a selected link:
 * a link is cheap to draw again. Read-only (phone app): only the two "open"s.
 */
export function useEdgeContextMenu({
  onRename,
  onDelete,
}: {
  onRename: (edge: MenuEdge) => void;
  onDelete: (edge: MenuEdge) => void;
}): { open: (edge: MenuEdge, x: number, y: number) => void; element: ReactNode } {
  const { t } = useI18n();
  const navigate = useNavigate();
  const bindings = useBindings();
  const readOnly = useReadOnly();
  const [menu, setMenu] = useState<{ edge: MenuEdge; x: number; y: number } | null>(null);

  const open = useCallback((edge: MenuEdge, x: number, y: number) => {
    setMenu({ edge, x, y });
  }, []);
  const close = useCallback(() => {
    setMenu(null);
  }, []);

  const items = (edge: MenuEdge): MenuItem[] =>
    [
      {
        id: 'rename',
        label: t('edgeMenu.rename'),
        keys: bindings.get('km.edge.rename')?.[0],
        onSelect: () => {
          onRename(edge);
        },
      },
      {
        id: 'open-from',
        label: t('edgeMenu.openNode', { title: edge.from.title }),
        separatorBefore: !readOnly,
        onSelect: () => void navigate(`/nodes/${edge.from.id}`),
      },
      {
        id: 'open-to',
        label: t('edgeMenu.openNode', { title: edge.to.title }),
        onSelect: () => void navigate(`/nodes/${edge.to.id}`),
      },
      {
        id: 'delete',
        label: t('edgeMenu.delete'),
        danger: true,
        separatorBefore: true,
        onSelect: () => {
          onDelete(edge);
        },
      },
    ]
      .filter((i) => !readOnly || READ_ONLY_ITEMS.has(i.id))
      // A self-loop has one node at both ends: one "open" is enough.
      .filter((i) => i.id !== 'open-to' || edge.to.id !== edge.from.id);

  const element = menu && (
    <ContextMenu
      label={t('edgeMenu.label', {
        name: menu.edge.name,
        from: menu.edge.from.title,
        to: menu.edge.to.title,
      })}
      x={menu.x}
      y={menu.y}
      items={items(menu.edge)}
      onClose={close}
    />
  );
  return { open, element };
}
