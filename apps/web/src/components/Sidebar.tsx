import { useDeferredValue, useState } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { errorMessage } from '../api/client';
import { useCreateNode, useNodeList } from '../api/queries';

export function Sidebar() {
  const [search, setSearch] = useState('');
  const query = useDeferredValue(search.trim());
  const nodes = useNodeList(query);
  const createNode = useCreateNode();
  const navigate = useNavigate();

  const handleCreate = () => {
    createNode.mutate(
      { title: 'Untitled' },
      { onSuccess: (node) => void navigate(`/nodes/${node.id}`) },
    );
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-actions">
        <input
          type="search"
          placeholder="Search nodes…"
          aria-label="Search nodes"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
          }}
        />
        <button type="button" onClick={handleCreate} disabled={createNode.isPending}>
          + New
        </button>
      </div>
      {createNode.isError && <p className="error">{errorMessage(createNode.error)}</p>}

      <nav aria-label="Nodes" className="node-list">
        {nodes.isPending && <p className="muted">Loading…</p>}
        {nodes.isError && <p className="error">{errorMessage(nodes.error)}</p>}
        {nodes.data?.length === 0 && <p className="muted">No nodes{query && ' match'}.</p>}
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
