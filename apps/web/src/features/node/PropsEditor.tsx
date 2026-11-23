import { propsSchema, type GraphNode } from '@km/core';
import { useState } from 'react';
import { errorMessage } from '../../api/client';
import { useUpdateNode } from '../../api/queries';
import { useI18n } from '../../i18n/context';

const format = (props: GraphNode['props']) => JSON.stringify(props, null, 2);

/** Raw JSON editor for node properties; validates and saves on blur. */
export function PropsEditor({ node }: { node: GraphNode }) {
  const [text, setText] = useState(() => format(node.props));
  const [parseError, setParseError] = useState<string | null>(null);
  const updateNode = useUpdateNode();
  const { t, errorText } = useI18n();

  const commit = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text || '{}');
    } catch (error) {
      setParseError(t('props.invalidJson', { detail: errorMessage(error) }));
      return;
    }
    const result = propsSchema.safeParse(parsed);
    if (!result.success) {
      setParseError(t('props.invalidShape'));
      return;
    }
    setParseError(null);
    if (JSON.stringify(result.data) === JSON.stringify(node.props)) return;
    updateNode.mutate({ id: node.id, patch: { props: result.data } });
  };

  return (
    <section className="panel">
      <h3>{t('props.heading')}</h3>
      <textarea
        className="props-editor"
        aria-label={t('props.label')}
        spellCheck={false}
        rows={6}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
        }}
        onBlur={commit}
      />
      {parseError && <p className="error">{parseError}</p>}
      {updateNode.isError && <p className="error">{errorText(updateNode.error)}</p>}
    </section>
  );
}
