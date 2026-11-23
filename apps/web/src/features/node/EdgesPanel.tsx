import { relationNameSchema, type EdgeWithNeighbor } from '@km/core';
import { useId, useState, type SubmitEvent } from 'react';
import { Link } from 'react-router';
import { errorMessage } from '../../api/client';
import {
  useCreateEdge,
  useDeleteEdge,
  useGraph,
  useNodeEdges,
  useRelationNames,
} from '../../api/queries';

type Direction = 'outgoing' | 'incoming';

export function EdgesPanel({ nodeId }: { nodeId: string }) {
  const edges = useNodeEdges(nodeId);
  const deleteEdge = useDeleteEdge();

  return (
    <section className="panel" aria-label="Links">
      <h3>Links</h3>
      {edges.isError && <p className="error">{errorMessage(edges.error)}</p>}
      {edges.data && (
        <>
          <EdgeList
            label="Outgoing"
            items={edges.data.outgoing}
            direction="outgoing"
            onDelete={(id) => {
              deleteEdge.mutate(id);
            }}
          />
          <EdgeList
            label="Incoming"
            items={edges.data.incoming}
            direction="incoming"
            onDelete={(id) => {
              deleteEdge.mutate(id);
            }}
          />
        </>
      )}
      {deleteEdge.isError && <p className="error">{errorMessage(deleteEdge.error)}</p>}
      <AddEdgeForm nodeId={nodeId} />
    </section>
  );
}

function EdgeList(props: {
  label: string;
  items: EdgeWithNeighbor[];
  direction: Direction;
  onDelete: (edgeId: string) => void;
}) {
  return (
    <div className="edge-group">
      <h4>{props.label}</h4>
      {props.items.length === 0 ? (
        <p className="muted">None</p>
      ) : (
        <ul className="edge-list" data-testid={`edges-${props.direction}`}>
          {props.items.map(({ edge, neighbor }) => (
            <li key={edge.id}>
              {props.direction === 'incoming' && (
                <Link to={`/nodes/${neighbor.id}`}>{neighbor.title}</Link>
              )}
              <span className="relation">—[{edge.name}]→</span>
              {props.direction === 'outgoing' && (
                <Link to={`/nodes/${neighbor.id}`}>{neighbor.title}</Link>
              )}
              <button
                type="button"
                className="icon danger subtle"
                aria-label={`Remove link ${edge.name} ${neighbor.title}`}
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

  const candidates = [...(graph.data?.nodes ?? [])].sort((a, b) => a.title.localeCompare(b.title));

  return (
    <form className="add-edge-form" onSubmit={submit} aria-label="Add link">
      <select
        aria-label="Direction"
        value={direction}
        onChange={(e) => {
          setDirection(e.target.value as Direction);
        }}
      >
        <option value="outgoing">this →</option>
        <option value="incoming">→ this</option>
      </select>
      <input
        aria-label="Relation"
        placeholder="RELATION"
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
        aria-label="Target node"
        value={otherId}
        onChange={(e) => {
          setOtherId(e.target.value);
        }}
      >
        <option value="">Select node…</option>
        {candidates.map((n) => (
          <option key={n.id} value={n.id}>
            {n.id === nodeId ? `${n.title} (self)` : n.title}
          </option>
        ))}
      </select>
      <button type="submit" disabled={!nameValid || !otherId || createEdge.isPending}>
        Link
      </button>
      {createEdge.isError && <p className="error">{errorMessage(createEdge.error)}</p>}
    </form>
  );
}
