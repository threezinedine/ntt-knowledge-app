import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ApiError, errorMessage } from '../../api/client';
import { useDeleteNode, useNode } from '../../api/queries';
import { EdgesPanel } from './EdgesPanel';
import { NodeEditor } from './NodeEditor';
import { PropsEditor } from './PropsEditor';
import { TasksPanel } from './TasksPanel';

export function NodePage() {
  const { id = '' } = useParams();
  const node = useNode(id);

  if (node.isPending) return <p className="muted">Loading…</p>;
  if (node.isError) {
    const notFound = node.error instanceof ApiError && node.error.status === 404;
    return (
      <p className="empty">{notFound ? 'This node does not exist.' : errorMessage(node.error)}</p>
    );
  }

  // Keyed by id so local drafts reset cleanly when switching nodes.
  return (
    <div className="node-page" key={node.data.id}>
      <section className="node-main">
        <NodeEditor node={node.data} />
      </section>
      <aside className="node-side">
        <EdgesPanel nodeId={node.data.id} />
        <TasksPanel nodeId={node.data.id} />
        <PropsEditor node={node.data} />
        <DeleteNodeButton nodeId={node.data.id} />
      </aside>
    </div>
  );
}

function DeleteNodeButton({ nodeId }: { nodeId: string }) {
  const [confirming, setConfirming] = useState(false);
  const deleteNode = useDeleteNode();
  const navigate = useNavigate();

  if (!confirming) {
    return (
      <button
        type="button"
        className="danger subtle"
        onClick={() => {
          setConfirming(true);
        }}
      >
        Delete node
      </button>
    );
  }
  return (
    <div className="confirm-row">
      <span>Delete node, its links and tasks?</span>
      <button
        type="button"
        className="danger"
        disabled={deleteNode.isPending}
        onClick={() => {
          deleteNode.mutate(nodeId, { onSuccess: () => void navigate('/') });
        }}
      >
        Confirm delete
      </button>
      <button
        type="button"
        onClick={() => {
          setConfirming(false);
        }}
      >
        Cancel
      </button>
      {deleteNode.isError && <p className="error">{errorMessage(deleteNode.error)}</p>}
    </div>
  );
}
