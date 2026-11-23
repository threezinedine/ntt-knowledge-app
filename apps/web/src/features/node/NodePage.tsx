import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ApiError } from '../../api/client';
import { useDeleteNode, useNode } from '../../api/queries';
import { useI18n } from '../../i18n/context';
import { EdgesPanel } from './EdgesPanel';
import { NodeEditor } from './NodeEditor';
import { NodeTagsPanel } from './NodeTagsPanel';
import { PropsEditor } from './PropsEditor';
import { TasksPanel } from './TasksPanel';

export function NodePage() {
  const { id = '' } = useParams();
  const node = useNode(id);
  const { t, errorText } = useI18n();

  if (node.isPending) return <p className="muted">{t('common.loading')}</p>;
  if (node.isError) {
    const notFound = node.error instanceof ApiError && node.error.status === 404;
    return <p className="empty">{notFound ? t('node.notFound') : errorText(node.error)}</p>;
  }

  // Keyed by id so local drafts reset cleanly when switching nodes.
  return (
    <div className="node-page" key={node.data.id}>
      <section className="node-main">
        <NodeEditor node={node.data} />
      </section>
      <aside className="node-side">
        <NodeTagsPanel node={node.data} />
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
  const { t, errorText } = useI18n();

  if (!confirming) {
    return (
      <button
        type="button"
        className="danger subtle"
        onClick={() => {
          setConfirming(true);
        }}
      >
        {t('node.delete')}
      </button>
    );
  }
  return (
    <div className="confirm-row">
      <span>{t('node.deleteConfirm')}</span>
      <button
        type="button"
        className="danger"
        disabled={deleteNode.isPending}
        onClick={() => {
          deleteNode.mutate(nodeId, { onSuccess: () => void navigate('/') });
        }}
      >
        {t('node.deleteConfirmButton')}
      </button>
      <button
        type="button"
        onClick={() => {
          setConfirming(false);
        }}
      >
        {t('common.cancel')}
      </button>
      {deleteNode.isError && <p className="error">{errorText(deleteNode.error)}</p>}
    </div>
  );
}
