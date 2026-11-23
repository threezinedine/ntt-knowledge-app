import { relationNameSchema, type EdgeWithNeighbor } from '@km/core';
import { useEffect, useId, useRef, useState, type SubmitEvent } from 'react';
import { Link } from 'react-router';
import {
  useCreateEdge,
  useDeleteEdge,
  useGraph,
  useNodeEdges,
  useRelationNames,
  useUpdateEdge,
} from '../../api/queries';
import { useCommandHandler } from '../../commands/registry';
import { tooltip, useCommandTooltip } from '../../commands/useCommandTooltip';
import { useI18n } from '../../i18n/context';
import { EdgeNameEditor } from '../graph/EdgeNameEditor';

type Direction = 'outgoing' | 'incoming';

export function EdgesPanel({ nodeId }: { nodeId: string }) {
  const edges = useNodeEdges(nodeId);
  const deleteEdge = useDeleteEdge();
  const updateEdge = useUpdateEdge();
  const { t, errorText } = useI18n();
  const rename = (id: string, name: string) => {
    updateEdge.mutate({ id, patch: { name } });
  };

  return (
    <section className="panel" aria-label={t('links.heading')}>
      <h3>{t('links.heading')}</h3>
      {edges.isError && <p className="error">{errorText(edges.error)}</p>}
      {edges.data && (
        <>
          <EdgeList
            label={t('links.outgoing')}
            items={edges.data.outgoing}
            direction="outgoing"
            onRename={rename}
            onDelete={(id) => {
              deleteEdge.mutate(id);
            }}
          />
          <EdgeList
            label={t('links.incoming')}
            items={edges.data.incoming}
            direction="incoming"
            onRename={rename}
            onDelete={(id) => {
              deleteEdge.mutate(id);
            }}
          />
        </>
      )}
      {deleteEdge.isError && <p className="error">{errorText(deleteEdge.error)}</p>}
      {updateEdge.isError && <p className="error">{errorText(updateEdge.error)}</p>}
      <AddEdgeForm nodeId={nodeId} />
    </section>
  );
}

function EdgeList(props: {
  label: string;
  items: EdgeWithNeighbor[];
  direction: Direction;
  onDelete: (edgeId: string) => void;
  onRename: (edgeId: string, name: string) => void;
}) {
  const { t } = useI18n();
  const [editingId, setEditingId] = useState<string | null>(null);
  // After a rename (or Escape) put focus back on the name the editor replaced.
  const returnFocusTo = useRef<string | null>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  useEffect(() => {
    if (editingId !== null || returnFocusTo.current === null) return;
    buttons.current.get(returnFocusTo.current)?.focus();
    returnFocusTo.current = null;
  }, [editingId]);
  const startEditing = (id: string) => {
    returnFocusTo.current = id;
    setEditingId(id);
  };
  return (
    <div className="edge-group">
      <h4>{props.label}</h4>
      {props.items.length === 0 ? (
        <p className="muted">{t('links.none')}</p>
      ) : (
        <ul className="edge-list" data-testid={`edges-${props.direction}`}>
          {props.items.map(({ edge, neighbor }) => (
            <li key={edge.id}>
              {props.direction === 'incoming' && (
                <Link to={`/nodes/${neighbor.id}`}>{neighbor.title}</Link>
              )}
              {editingId === edge.id ? (
                <span className="relation">
                  —[
                  <EdgeNameEditor
                    className="relation-input"
                    initial={edge.name}
                    onCommit={(name) => {
                      setEditingId(null);
                      props.onRename(edge.id, name);
                    }}
                    onCancel={() => {
                      setEditingId(null);
                    }}
                  />
                  ]→
                </span>
              ) : (
                <button
                  type="button"
                  className="relation relation-button"
                  aria-label={t('links.rename', { relation: edge.name, node: neighbor.title })}
                  {...tooltip(t('cmd.renameLink'))}
                  ref={(el) => {
                    if (el) buttons.current.set(edge.id, el);
                    else buttons.current.delete(edge.id);
                  }}
                  onClick={() => {
                    startEditing(edge.id);
                  }}
                >
                  —[{edge.name}]→
                </button>
              )}
              {props.direction === 'outgoing' && (
                <Link to={`/nodes/${neighbor.id}`}>{neighbor.title}</Link>
              )}
              <button
                type="button"
                className="icon danger subtle"
                aria-label={t('links.remove', { relation: edge.name, node: neighbor.title })}
                onClick={() => {
                  props.onDelete(edge.id);
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddEdgeForm({ nodeId }: { nodeId: string }) {
  const [direction, setDirection] = useState<Direction>('outgoing');
  const [name, setName] = useState('');
  const [otherId, setOtherId] = useState('');
  const graph = useGraph(); // node summaries for the picker
  const relations = useRelationNames();
  const createEdge = useCreateEdge();
  const listId = useId();
  const { t, errorText, locale } = useI18n();
  const relationRef = useRef<HTMLInputElement>(null);
  const addTip = useCommandTooltip('km.node.addLink');
  useCommandHandler('km.node.addLink', () => {
    relationRef.current?.focus();
  });

  const nameValid = relationNameSchema.safeParse(name).success;

  const submit = (e: SubmitEvent) => {
    e.preventDefault();
    if (!nameValid || !otherId) return;
    const [fromId, toId] = direction === 'outgoing' ? [nodeId, otherId] : [otherId, nodeId];
    createEdge.mutate(
      { fromId, toId, name },
      {
        onSuccess: () => {
          setName('');
          setOtherId('');
        },
      },
    );
  };

  const candidates = [...(graph.data?.nodes ?? [])].sort((a, b) =>
    a.title.localeCompare(b.title, locale),
  );

  return (
    <form className="add-edge-form" onSubmit={submit} aria-label={t('links.addForm')}>
      <select
        aria-label={t('links.direction')}
        value={direction}
        onChange={(e) => {
          setDirection(e.target.value as Direction);
        }}
      >
        <option value="outgoing">{t('links.directionOut')}</option>
        <option value="incoming">{t('links.directionIn')}</option>
      </select>
      <input
        ref={relationRef}
        aria-label={t('links.relation')}
        placeholder={t('relation.placeholder')}
        list={listId}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
        }}
      />
      <datalist id={listId}>
        {relations.data?.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      <select
        aria-label={t('links.target')}
        value={otherId}
        onChange={(e) => {
          setOtherId(e.target.value);
        }}
      >
        <option value="">{t('links.selectNode')}</option>
        {candidates.map((n) => (
          <option key={n.id} value={n.id}>
            {n.id === nodeId ? t('links.self', { title: n.title }) : n.title}
          </option>
        ))}
      </select>
      <button type="submit" disabled={!nameValid || !otherId || createEdge.isPending} {...addTip}>
        {t('links.submit')}
      </button>
      {createEdge.isError && <p className="error">{errorText(createEdge.error)}</p>}
    </form>
  );
}
