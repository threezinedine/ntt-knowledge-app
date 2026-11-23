import { useDeferredValue, useState } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { useCreateNode, useNodeList } from '../api/queries';
import { useI18n } from '../i18n/context';

export function Sidebar() {
  const [search, setSearch] = useState('');
  const query = useDeferredValue(search.trim());
  const nodes = useNodeList(query);
  const createNode = useCreateNode();
  const navigate = useNavigate();
  const { t, errorText } = useI18n();

  const handleCreate = () => {
    createNode.mutate(
      { title: t('sidebar.untitled') },
      { onSuccess: (node) => void navigate(`/nodes/${node.id}`) },
    );
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-actions">
        <input
          type="search"
          placeholder={t('sidebar.searchPlaceholder')}
          aria-label={t('sidebar.searchLabel')}
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
          }}
        />
        <button type="button" onClick={handleCreate} disabled={createNode.isPending}>
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
