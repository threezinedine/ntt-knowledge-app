import type { EdgeWithNeighbor, GraphNode } from '@km/core';
import Markdown from 'react-markdown';
import { Link } from 'react-router';
import remarkGfm from 'remark-gfm';
import { useNodeEdges } from '../../api/queries';
import { useI18n } from '../../i18n/context';
import { TagChip } from '../tags/TagChip';
import { sortTagIds, useTagIndex } from '../tags/useTagIndex';
import { WhysPanel } from '../whys/WhysPanel';
import { LinkCheckPanel } from '../linkCheck/LinkCheckPanel';

/** A node to read, not edit (read-only mode, e.g. the phone app). */
export function NodeView({ node }: { node: GraphNode }) {
  const { t, errorText } = useI18n();
  const index = useTagIndex();
  const edges = useNodeEdges(node.id);
  const tags = sortTagIds(node.tagIds, index);
  const props = Object.entries(node.props);

  return (
    <div className="node-page node-view">
      <section className="node-main">
        <span className="node-type">{node.type}</span>
        <h1 className="node-view-title">{node.title}</h1>
        {tags.length > 0 && (
          <div className="tag-chips" role="group" aria-label={t('tags.heading')}>
            {tags.map((tag) => (
              <TagChip key={tag.tag.id} node={tag} showPath />
            ))}
          </div>
        )}
        <article className="markdown-preview" data-testid="markdown-preview">
          {/* react-markdown does not render raw HTML by default, so this is XSS-safe. */}
          <Markdown remarkPlugins={[remarkGfm]}>{node.content}</Markdown>
        </article>
      </section>
      <aside className="node-side">
        <section className="panel" aria-label={t('links.heading')}>
          <h3>{t('links.heading')}</h3>
          {edges.isError && <p className="error">{errorText(edges.error)}</p>}
          {edges.data && (
            <>
              <LinkList label={t('links.outgoing')} items={edges.data.outgoing} outgoing />
              <LinkList label={t('links.incoming')} items={edges.data.incoming} />
            </>
          )}
        </section>
        <WhysPanel node={node} />
        <LinkCheckPanel nodeId={node.id} />
        {props.length > 0 && (
          <section className="panel" aria-label={t('props.heading')}>
            <h3>{t('props.heading')}</h3>
            <dl className="props-view">
              {props.map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{typeof value === 'string' ? value : JSON.stringify(value)}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
      </aside>
    </div>
  );
}

function LinkList(props: { label: string; items: EdgeWithNeighbor[]; outgoing?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="edge-group">
      <h4>{props.label}</h4>
      {props.items.length === 0 ? (
        <p className="muted">{t('links.none')}</p>
      ) : (
        <ul className="edge-list" data-testid={`edges-${props.outgoing ? 'outgoing' : 'incoming'}`}>
          {props.items.map(({ edge, neighbor }) => (
            <li key={edge.id}>
              {!props.outgoing && <Link to={`/nodes/${neighbor.id}`}>{neighbor.title}</Link>}
              <span className="relation">—[{edge.name}]→</span>
              {props.outgoing && <Link to={`/nodes/${neighbor.id}`}>{neighbor.title}</Link>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
