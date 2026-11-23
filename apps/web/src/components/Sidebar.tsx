import { useDeferredValue, useState } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { useCreateNode, useNodeList } from '../api/queries';
import { useCommandHandler } from '../commands/registry';
import { useCommandTooltip } from '../commands/useCommandTooltip';
import { NEW_NODE_STATE } from '../features/node/navState';
import { useI18n } from '../i18n/context';

/** The search box's id, for the "Search Nodes" command. */
export const SIDEBAR_SEARCH_ID = 'km-node-search';

export function Sidebar({ hidden = false }: { hidden?: boolean }) {
  const [search, setSearch] = useState('');
  const query = useDeferredValue(search.trim());
  const nodes = useNodeList(query);
  const createNode = useCreateNode();
  const navigate = useNavigate();
  const { t, errorText } = useI18n();

  const handleCreate = () => {
    createNode.mutate(
      { title: t('sidebar.untitled') },
      { onSuccess: (node) => void navigate(`/nodes/${node.id}`, { state: NEW_NODE_STATE }) },
    );
  };
  const newTip = useCommandTooltip('km.node.new');
  const searchTip = useCommandTooltip('km.sidebar.focusSearch');
  useCommandHandler('km.node.new', () => {
    if (!createNode.isPending) handleCreate();
  });

  return (
    <aside className="sidebar" hidden={hidden}>
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
        <button type="button" onClick={handleCreate} disabled={createNode.isPending} {...newTip}>
          {t('sidebar.new')}
        </button>
      </div>
      {createNode.isError && <p className="error">{errorText(createNode.error)}</p>}

      <nav aria-label={t('sidebar.listLabel')} className="node-list">
        {nodes.isPending && <p className="muted">{t('common.loading')}</p>}
        {nodes.isError && <p className="error">{errorText(nodes.error)}</p>}
        {nodes.data?.length === 0 && (
          <p className="muted">{t(query ? 'sidebar.noMatch' : 'sidebar.empty')}</p>
        )}
        {nodes.data?.map((node) => (
          <NavLink key={node.id} to={`/nodes/${node.id}`} className="node-list-item">
            <span className="node-type">{node.type}</span>
            <span className="node-title">{node.title}</span>
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
