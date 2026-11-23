import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { api, ApiError } from '../../api/client';
import { keys, useDeleteNode, useTagLink } from '../../api/queries';
import { useBindings } from '../../commands/keybindingStore';
import { openQuickPick } from '../../commands/quickInputStore';
import { ContextMenu, type MenuItem } from '../../components/ContextMenu';
import { showToast } from '../../components/toast';
import { useI18n } from '../../i18n/context';
import { useTagIndex } from '../tags/useTagIndex';
import { NEW_NODE_STATE } from './navState';

export interface MenuNode {
  id: string;
  title: string;
}

/** Navigation state asking the graph to centre on a node. */
export interface RevealState {
  revealNodeId: string;
}

export function revealNodeId(state: unknown): string | null {
  return typeof state === 'object' &&
    state !== null &&
    'revealNodeId' in state &&
    typeof state.revealNodeId === 'string'
    ? state.revealNodeId
    : null;
}

/**
 * Right-click menu for a node, wherever it is shown (sidebar list, graph):
 * open, rename, tags, reveal in graph, copy title/link, delete. Returns an
 * opener and the element to render.
 */
export function useNodeContextMenu(): {
  open: (node: MenuNode, x: number, y: number) => void;
  element: ReactNode;
} {
  const { t, errorText } = useI18n();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const index = useTagIndex();
  const link = useTagLink('nodes');
  const deleteNode = useDeleteNode();
  const bindings = useBindings();
  const [menu, setMenu] = useState<{ node: MenuNode; x: number; y: number } | null>(null);
  const [confirming, setConfirming] = useState<MenuNode | null>(null);

  const close = useCallback(() => {
    setMenu(null);
  }, []);
  const open = useCallback((node: MenuNode, x: number, y: number) => {
    setMenu({ node, x, y });
  }, []);

  const pickTags = async (node: MenuNode) => {
    try {
      const fresh = await qc.query({
        queryKey: keys.node(node.id),
        queryFn: () => api.nodes.get(node.id),
      });
      const attached = new Set(fresh.tagIds);
      openQuickPick({
        placeholder: t('nodeMenu.tagsPlaceholder', { title: node.title }),
        items: index.flat.map((n) => ({
          id: n.tag.id,
          label: n.path.join(' / '),
          current: attached.has(n.tag.id),
          description: attached.has(n.tag.id) ? t('nodeMenu.tagRemove') : t('nodeMenu.tagAdd'),
          run: () => {
            link.mutate(
              { ownerId: node.id, tagId: n.tag.id, attached: !attached.has(n.tag.id) },
              {
                onError: (err) => {
                  showToast(errorText(err));
                },
              },
            );
          },
        })),
      });
    } catch (err) {
      showToast(errorText(err));
    }
  };

  const copy = (text: string, done: string) => {
    navigator.clipboard.writeText(text).then(
      () => {
        showToast(done);
      },
      () => {
        showToast(t('nodeMenu.copyFailed'));
      },
    );
  };

  const items = (node: MenuNode): MenuItem[] => [
    {
      id: 'open',
      label: t('nodeMenu.open'),
      onSelect: () => void navigate(`/nodes/${node.id}`),
    },
    {
      id: 'rename',
      label: t('nodeMenu.rename'),
      keys: bindings.get('km.node.rename')?.[0],
      // The node page opens with the title selected (as for a new node).
      onSelect: () => void navigate(`/nodes/${node.id}`, { state: NEW_NODE_STATE }),
    },
    {
      id: 'tags',
      label: t('nodeMenu.tags'),
      disabled: index.flat.length === 0,
      onSelect: () => void pickTags(node),
    },
    {
      id: 'reveal',
      label: t('nodeMenu.reveal'),
      onSelect: () =>
        void navigate('/', {
          state: { revealNodeId: node.id } satisfies RevealState,
          replace: location.pathname === '/', // no duplicate history entry
        }),
    },
    {
      id: 'copy-title',
      label: t('nodeMenu.copyTitle'),
      separatorBefore: true,
      onSelect: () => {
        copy(node.title, t('nodeMenu.copiedTitle'));
      },
    },
    {
      id: 'copy-link',
      label: t('nodeMenu.copyLink'),
      onSelect: () => {
        copy(`${window.location.origin}/nodes/${node.id}`, t('nodeMenu.copiedLink'));
      },
    },
    {
      id: 'delete',
      label: t('nodeMenu.delete'),
      danger: true,
      separatorBefore: true,
      onSelect: () => {
        setConfirming(node);
      },
    },
  ];

  const element = (
    <>
      {menu && (
        <ContextMenu
          label={t('nodeMenu.label', { title: menu.node.title })}
          x={menu.x}
          y={menu.y}
          items={items(menu.node)}
          onClose={close}
        />
      )}
      {confirming && (
        <ConfirmDelete
          node={confirming}
          pending={deleteNode.isPending}
          error={deleteNode.isError ? errorText(deleteNode.error) : null}
          onCancel={() => {
            deleteNode.reset();
            setConfirming(null);
          }}
          onConfirm={() => {
            const done = () => {
              setConfirming(null);
              showToast(t('nodeMenu.deleted', { title: confirming.title }));
              if (location.pathname === `/nodes/${confirming.id}`) void navigate('/');
            };
            deleteNode.mutate(confirming.id, {
              onSuccess: done,
              // Already deleted (another tab/device): that is what was asked for.
              onError: (err) => {
                if (err instanceof ApiError && err.status === 404) {
                  deleteNode.reset();
                  void qc.invalidateQueries({ queryKey: keys.nodes });
                  void qc.invalidateQueries({ queryKey: keys.graph });
                  done();
                }
              },
            });
          }}
        />
      )}
    </>
  );
  return { open, element };
}

function ConfirmDelete({
  node,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  node: MenuNode;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const returnTo = document.activeElement;
    ref.current?.showModal();
    return () => {
      if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-label={t('nodeMenu.deleteTitle')}
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <p>{t('nodeMenu.deleteConfirm', { title: node.title })}</p>
      {error && <p className="error">{error}</p>}
      <div className="dialog-actions">
        <button type="button" onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button type="button" className="danger" autoFocus disabled={pending} onClick={onConfirm}>
          {t('nodeMenu.delete')}
        </button>
      </div>
    </dialog>
  );
}
