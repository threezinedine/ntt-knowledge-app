import {
  buildTagTree,
  flattenTagTree,
  LOCAL_GRAPH_MAX_DEPTH,
  type LocalGraph,
  type Tag,
} from '@km/core';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '../../api/client';
import { keys, useLocalGraph } from '../../api/queries';
import { readJson, writeJson } from '../../commands/storage';
import { useCommandHandler } from '../../commands/registry';
import { useCommandTooltip } from '../../commands/useCommandTooltip';
import { showToast } from '../../components/toast';
import { flushAllAutosaves } from '../../hooks/useAutosave';
import { useI18n } from '../../i18n/context';
import { useTagIndex } from '../tags/useTagIndex';
import {
  copyTextWhenReady,
  PROMPT_LANGUAGES,
  usePromptLanguage,
  type PromptLanguage,
} from '../ai/copyPrompt';
import { buildLinkCheckPrompt, type TagPaths } from './prompt';

const DEPTH_KEY = 'km.linkCheck.depth';
const DEPTHS = Array.from({ length: LOCAL_GRAPH_MAX_DEPTH }, (_, i) => i + 1);

function readDepth(): number {
  const saved = readJson(DEPTH_KEY);
  return typeof saved === 'number' && DEPTHS.includes(saved) ? saved : 1;
}

function tagPathsOf(tags: readonly Tag[]): TagPaths {
  const byId = new Map(flattenTagTree(buildTagTree(tags)).map((n) => [n.tag.id, n.path]));
  return (ids) => ids.flatMap((id) => (byId.has(id) ? [(byId.get(id) ?? []).join(' / ')] : []));
}

/**
 * Side panel of a node: copy a prompt for any AI chat to fact-check every
 * link in this node's local graph (level 1–3), with a preview of its size.
 * Nothing comes back into the app, so it works in read-only mode too.
 */
export function LinkCheckPanel({ nodeId }: { nodeId: string }) {
  const { t, errorText } = useI18n();
  const qc = useQueryClient();
  const index = useTagIndex();
  const [depth, setDepthState] = useState(readDepth);
  const setDepth = (d: number) => {
    setDepthState(d);
    writeJson(DEPTH_KEY, d);
  };
  const [lang, setLang] = usePromptLanguage('km.linkCheck.promptLanguage');
  const graph = useLocalGraph(nodeId, depth);
  const tagPaths = useMemo(() => tagPathsOf(index.all), [index.all]);
  const chars = useMemo(
    () => (graph.data ? buildLinkCheckPrompt(graph.data, tagPaths, lang).length : null),
    [graph.data, tagPaths, lang],
  );
  const copyTip = useCommandTooltip('km.node.copyLinkCheckPrompt');

  /** From the event handler itself (see copyTextWhenReady). Fresh data, typed text saved first. */
  const copy = () => {
    const fresh = <T,>(queryKey: readonly unknown[], queryFn: () => Promise<T>) =>
      qc.query({ queryKey, queryFn, staleTime: 0 });
    const built = (async () => {
      await flushAllAutosaves();
      const [local, tags]: [LocalGraph, Tag[]] = await Promise.all([
        fresh(keys.localGraph(nodeId, depth), () => api.nodes.localGraph(nodeId, depth)),
        fresh(keys.tags, api.tags.list),
      ]);
      return { local, text: buildLinkCheckPrompt(local, tagPathsOf(tags), lang) };
    })();
    void copyTextWhenReady(built.then((b) => b.text)).then(
      async () => {
        const { local, text } = await built;
        showToast(
          t('linkCheck.copied', {
            notes: local.nodes.length,
            links: local.edges.length,
            chars: text.length,
          }),
        );
      },
      () => {
        showToast(t('linkCheck.copyFailed'));
      },
    );
  };
  useCommandHandler('km.node.copyLinkCheckPrompt', copy);

  return (
    <section className="panel link-check-panel" aria-label={t('linkCheck.heading')}>
      <h3>{t('linkCheck.heading')}</h3>
      <p className="muted">{t('linkCheck.help')}</p>
      <div className="link-check-row">
        <select
          aria-label={t('linkCheck.level')}
          value={depth}
          onChange={(e) => {
            setDepth(Number(e.target.value));
          }}
        >
          {DEPTHS.map((d) => (
            <option key={d} value={d}>
              {t('linkCheck.levelN', { level: d })}
            </option>
          ))}
        </select>
        <select
          aria-label={t('linkCheck.promptLang')}
          value={lang}
          onChange={(e) => {
            setLang(e.target.value as PromptLanguage);
          }}
        >
          {PROMPT_LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {l.toUpperCase()}
            </option>
          ))}
        </select>
        <button type="button" {...copyTip} onClick={copy}>
          {t('linkCheck.copy')}
        </button>
      </div>
      {graph.isError && <p className="error">{errorText(graph.error)}</p>}
      <p className="muted link-check-preview" data-testid="link-check-preview">
        {graph.data && chars !== null
          ? t('linkCheck.preview', {
              notes: graph.data.nodes.length,
              links: graph.data.edges.length,
              chars,
            })
          : t('common.loading')}
      </p>
      {graph.data?.edges.length === 0 && <p className="muted">{t('linkCheck.noLinks')}</p>}
    </section>
  );
}
