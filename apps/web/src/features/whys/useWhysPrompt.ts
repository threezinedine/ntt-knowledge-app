import type { GraphNode, NodeEdges, WhySession } from '@km/core';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/client';
import { keys } from '../../api/queries';
import { readJson, writeJson } from '../../commands/storage';
import { showToast } from '../../components/toast';
import { flushAllAutosaves } from '../../hooks/useAutosave';
import { useI18n } from '../../i18n/context';
import { buildWhysPrompt, PROMPT_LANGUAGES, type PromptInput, type PromptLanguage } from './prompt';

const LANG_KEY = 'km.whys.promptLanguage';

/** The prompt language last picked on this device; else the UI language. */
export function usePromptLanguage(): [PromptLanguage, (lang: PromptLanguage) => void] {
  const { locale } = useI18n();
  const [lang, setLangState] = useState<PromptLanguage>(() => {
    const saved = readJson(LANG_KEY);
    if (PROMPT_LANGUAGES.includes(saved as PromptLanguage)) return saved as PromptLanguage;
    return locale.startsWith('vi') ? 'vi' : 'en';
  });
  const setLang = (next: PromptLanguage) => {
    setLangState(next);
    writeJson(LANG_KEY, next);
  };
  return [lang, setLang];
}

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
 * links, every earlier session in full).
 *
 * Call it straight from the click/keydown handler: the clipboard write starts
 * synchronously with a promise of the text (ClipboardItem), so browsers that
 * drop the user gesture across awaits (Safari) still allow it. Where that form
 * isn't supported, it falls back to writeText after the awaits.
 */
export function useCopyWhysPrompt(nodeId: string) {
  const qc = useQueryClient();
  const { t } = useI18n();
  return (lang: PromptLanguage): Promise<void> => {
    // staleTime 0: always a round-trip, so nothing invalidated but not yet
    // refetched (a link just added, a session just saved) is quoted stale.
    const fresh = <T>(queryKey: readonly unknown[], queryFn: () => Promise<T>) =>
      qc.query({ queryKey, queryFn, staleTime: 0 });
    const built = (async () => {
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
    })();

    const write = async (): Promise<void> => {
      if (typeof ClipboardItem !== 'undefined') {
        const blob = built.then(({ text }) => new Blob([text], { type: 'text/plain' }));
        try {
          await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
          return;
        } catch {
          // Older engines refuse a promise in ClipboardItem: try plain text.
        }
      }
      await navigator.clipboard.writeText((await built).text);
    };

    return write().then(
      async () => {
        const { text, sessions } = await built;
        showToast(t('whys.promptCopiedFull', { count: sessions, chars: text.length }));
      },
      () => {
        showToast(t('whys.copyPromptFailed'));
      },
    );
  };
}
