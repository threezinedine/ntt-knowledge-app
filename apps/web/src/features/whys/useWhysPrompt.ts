import type { GraphNode, NodeEdges, WhySession } from '@km/core';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { keys } from '../../api/queries';
import { showToast } from '../../components/toast';
import { flushAllAutosaves } from '../../hooks/useAutosave';
import { useI18n } from '../../i18n/context';
import { copyPrompt, usePromptLanguage as usePromptLanguageFor } from '../ai/copyPrompt';
import type { PromptLanguage } from '../ai/copyPrompt';
import { buildWhysPrompt, type PromptInput } from './prompt';

/** The 5 Whys prompt language last picked on this device; else the UI language. */
export const usePromptLanguage = () => usePromptLanguageFor('km.whys.promptLanguage');

/** API order is newest first; the prompt tells the story oldest first. */
export function promptInput(
  node: Pick<GraphNode, 'title' | 'content'>,
  edges: NodeEdges | undefined,
  sessions: readonly WhySession[],
): PromptInput {
  return { title: node.title, content: node.content, edges, sessions: [...sessions].reverse() };
}

/**
 * Copies the full prompt for a node in one go (button or shortcut): saves
 * what is still being typed, then builds it from fresh data (title, notes,
 * links, every earlier session in full). Call it from the event handler
 * itself (see `copyTextWhenReady`).
 */
export function useCopyWhysPrompt(nodeId: string) {
  const qc = useQueryClient();
  const { t } = useI18n();
  return (lang: PromptLanguage): Promise<void> => {
    // staleTime 0: always a round-trip, so nothing invalidated but not yet
    // refetched (a link just added, a session just saved) is quoted stale.
    const fresh = <T>(queryKey: readonly unknown[], queryFn: () => Promise<T>) =>
      qc.query({ queryKey, queryFn, staleTime: 0 });
    const later = async () => {
      await flushAllAutosaves();
      const [node, edges, sessions] = await Promise.all([
        fresh(keys.node(nodeId), () => api.nodes.get(nodeId)),
        fresh(keys.nodeEdges(nodeId), () => api.nodes.edges(nodeId)),
        fresh(keys.whys(nodeId), () => api.whys.list(nodeId)),
      ]);
      return {
        text: buildWhysPrompt(promptInput(node, edges, sessions), lang),
        sessions: sessions.length,
      };
    };
    // Plain http (no Clipboard API): what is cached, built in the gesture.
    const now = () => {
      const node = qc.getQueryData<GraphNode>(keys.node(nodeId));
      const sessions = qc.getQueryData<WhySession[]>(keys.whys(nodeId));
      if (!node || !sessions) return null;
      const edges = qc.getQueryData<NodeEdges>(keys.nodeEdges(nodeId));
      return {
        text: buildWhysPrompt(promptInput(node, edges, sessions), lang),
        sessions: sessions.length,
      };
    };
    return copyPrompt(later, now).then(
      ({ text, sessions }) => {
        showToast(t('whys.promptCopiedFull', { count: sessions, chars: text.length }));
      },
      () => {
        showToast(t('whys.copyPromptFailed'));
      },
    );
  };
}
