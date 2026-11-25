import { createWikilinkResolver } from '@km/core';
import { useMemo } from 'react';
import Markdown, { type Components } from 'react-markdown';
import { Link } from 'react-router';
import remarkGfm from 'remark-gfm';
import { useGraph } from '../../api/queries';
import { remarkWikilinks } from './remarkWikilinks';

const components: Components = {
  // Wikilinks stay in the app (router links); other links are left as they are.
  a: ({ href, className, children, node: _node, ...rest }) =>
    className === 'wikilink' && href ? (
      <Link to={href} className={className}>
        {children}
      </Link>
    ) : (
      <a href={href} className={className} {...rest}>
        {children}
      </a>
    ),
};

/** A node's markdown with its [[wikilinks]] as links to the nodes they name. */
export function WikiMarkdown({ children }: { children: string }) {
  const nodes = useGraph().data?.nodes;
  const plugins = useMemo(
    () => [remarkGfm, remarkWikilinks(createWikilinkResolver(nodes ?? []))],
    [nodes],
  );
  // react-markdown does not render raw HTML by default, so this is XSS-safe.
  return (
    <Markdown remarkPlugins={plugins} components={components}>
      {children}
    </Markdown>
  );
}
