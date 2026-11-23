import { propsSchema, type GraphNode } from '@km/core';
import { useState } from 'react';
import { errorMessage } from '../../api/client';
import { useUpdateNode } from '../../api/queries';

const format = (props: GraphNode['props']) => JSON.stringify(props, null, 2);

/** Raw JSON editor for node properties; validates and saves on blur. */
export function PropsEditor({ node }: { node: GraphNode }) {
  const [text, setText] = useState(() => format(node.props));
  const [parseError, setParseError] = useState<string | null>(null);
  const updateNode = useUpdateNode();

  const commit = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text || '{}');
    } catch (error) {
      setParseError(`Invalid JSON: ${errorMessage(error)}`);
      return;
    }
    const result = propsSchema.safeParse(parsed);
    if (!result.success) {
      setParseError('Properties must be a JSON object with short, non-empty keys.');
      return;
    }
    setParseError(null);
    if (JSON.stringify(result.data) === JSON.stringify(node.props)) return;
    updateNode.mutate({ id: node.id, patch: { props: result.data } });
  };

  return (
    <section className="panel">
      <h3>Properties</h3>
      <textarea
        className="props-editor"
        aria-label="Properties JSON"
        spellCheck={false}
        rows={6}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
        }}
        onBlur={commit}
      />
      {parseError && <p className="error">{parseError}</p>}
      {updateNode.isError && <p className="error">{errorMessage(updateNode.error)}</p>}
    </section>
  );
}
