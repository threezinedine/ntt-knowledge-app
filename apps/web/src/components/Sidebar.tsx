import { useDeferredValue, useState } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { useCreateNode, useNodeList } from '../api/queries';
import { runCommand, useCommandHandler } from '../commands/registry';
import { showToast } from './toast';
import { useCommandTooltip } from '../commands/useCommandTooltip';
import { FieldLevels } from '../features/exp/FieldLevels';
import { useNodeContextMenu } from '../features/node/NodeContextMenu';
import { NEW_NODE_STATE } from '../features/node/navState';
import { useI18n } from '../i18n/context';
import { useReadOnly } from '../features/readOnly';

/** The search box's id, for the "Search Nodes" command. */
export const SIDEBAR_SEARCH_ID = 'km-node-search';

/**
 * The desktop sidebar: the node list on top, the fields below. On a phone
 * (narrow screen) there is no sidebar: each part is a tab of its own
 * (`/nodes`, `/fields`).
 */
export function Sidebar({ hidden = false }: { hidden?: boolean }) {
  return (
    <aside className="sidebar" hidden={hidden}>
      <NodeListPane />
      <FieldLevels />
    </aside>
  );
}

/** Search, New, and the node list (with its context menu and commands). */
/**
 * "New Node" (Alt+N, and the list's + New): always available, wherever the
 * node list is (on a phone it is a tab of its own). Mounted once, by App.
 */
export function NewNodeCommand() {
  const createNode = useCreateNode();
  const navigate = useNavigate();
  const { t, errorText } = useI18n();
  const readOnly = useReadOnly();
  useCommandHandler(
    'km.node.new',
    () => {
      if (createNode.isPending) return;
      createNode.mutate(
        { title: t('sidebar.untitled') },
        {
          onSuccess: (node) => void navigate(`/nodes/${node.id}`, { state: NEW_NODE_STATE }),
          onError: (error) => {
            showToast(errorText(error));
          },
        },
      );
    },
    !readOnly,
  );
  return null;
}

export function NodeListPane() {
  const [search, setSearch] = useState('');
  const query = useDeferredValue(search.trim());
  const nodes = useNodeList(query);
  const { t, errorText } = useI18n();
  const newTip = useCommandTooltip('km.node.new');
  const nodeMenu = useNodeContextMenu();
  const searchTip = useCommandTooltip('km.sidebar.focusSearch');
  const readOnly = useReadOnly();

  return (
    <>
      <div className="sidebar-actions">
        <input
          type="search"
          id={SIDEBAR_SEARCH_ID}
          placeholder={t('sidebar.searchPlaceholder')}
          aria-label={t('sidebar.searchLabel')}
          {...searchTip}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
          }}
        />
        {!readOnly && (
          <button
            type="button"
            onClick={() => {
              runCommand('km.node.new');
            }}
            {...newTip}
          >
            {t('sidebar.new')}
          </button>
        )}
      </div>

      <nav aria-label={t('sidebar.listLabel')} className="node-list">
        {nodes.isPending && <p className="muted">{t('common.loading')}</p>}
        {nodes.isError && <p className="error">{errorText(nodes.error)}</p>}
        {nodes.data?.length === 0 && (
          <p className="muted">{t(query ? 'sidebar.noMatch' : 'sidebar.empty')}</p>
        )}
        {nodes.data?.map((node) => (
          <NavLink
            key={node.id}
            to={`/nodes/${node.id}`}
            className="node-list-item"
            onContextMenu={(e) => {
              e.preventDefault();
              // From the keyboard (Menu key, Shift+F10) there is no pointer: use the item.
              const keyboard = e.clientX === 0 && e.clientY === 0;
              const rect = e.currentTarget.getBoundingClientRect();
              nodeMenu.open(
                node,
                keyboard ? rect.left + 12 : e.clientX,
                keyboard ? rect.bottom : e.clientY,
              );
            }}
          >
            <span className="node-type">{node.type}</span>
            <span className="node-title">{node.title}</span>
          </NavLink>
        ))}
      </nav>
      {nodeMenu.element}
    </>
  );
}
