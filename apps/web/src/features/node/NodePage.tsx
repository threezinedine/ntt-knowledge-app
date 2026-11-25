import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ApiError } from '../../api/client';
import { useDeleteNode, useNode } from '../../api/queries';
import { useCommandHandler } from '../../commands/registry';
import { useCommandTooltip } from '../../commands/useCommandTooltip';
import { useI18n } from '../../i18n/context';
import { EdgesPanel } from './EdgesPanel';
import { NodeEditor } from './NodeEditor';
import { NodeTagsPanel } from './NodeTagsPanel';
import { PropsEditor } from './PropsEditor';
import { NodeView } from './NodeView';
import { useReadOnly } from '../readOnly';
import { WhysPanel } from '../whys/WhysPanel';
import { LinkCheckPanel } from '../linkCheck/LinkCheckPanel';

export function NodePage() {
  const { id = '' } = useParams();
  const node = useNode(id);
  const { t, errorText } = useI18n();
  const readOnly = useReadOnly();

  if (node.isPending) return <p className="muted">{t('common.loading')}</p>;
  if (node.isError) {
    const notFound = node.error instanceof ApiError && node.error.status === 404;
    return <p className="empty">{notFound ? t('node.notFound') : errorText(node.error)}</p>;
  }

  if (readOnly) return <NodeView key={node.data.id} node={node.data} />;
  // Keyed by id so local drafts reset cleanly when switching nodes.
  return (
    <div className="node-page" key={node.data.id}>
      <section className="node-main">
        <NodeEditor node={node.data} />
      </section>
      <aside className="node-side">
        <NodeTagsPanel node={node.data} />
        <EdgesPanel nodeId={node.data.id} />
        <WhysPanel node={node.data} />
        <LinkCheckPanel nodeId={node.data.id} />
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
  const deleteTip = useCommandTooltip('km.node.delete');
  useCommandHandler('km.node.delete', () => {
    setConfirming(true);
  });

  if (!confirming) {
    return (
      <button
        type="button"
        className="danger subtle"
        {...deleteTip}
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
        autoFocus
        disabled={deleteNode.isPending}
        onClick={() => {
          // Not mutate's own onSuccess: the node's query 404s first and this
          // button unmounts, and TanStack skips callbacks of unmounted callers.
          void deleteNode.mutateAsync(nodeId).then(
            () => void navigate('/'),
            () => undefined, // shown below via deleteNode.isError
          );
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
