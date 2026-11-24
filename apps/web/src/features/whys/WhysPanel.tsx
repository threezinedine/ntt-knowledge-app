import type { GraphNode } from '@km/core';
import { useState } from 'react';
import { useWhySessions } from '../../api/queries';
import { useCommandHandler } from '../../commands/registry';
import { useCommandTooltip } from '../../commands/useCommandTooltip';
import { flushAllAutosaves } from '../../hooks/useAutosave';
import { useI18n } from '../../i18n/context';
import { useReadOnly } from '../readOnly';
import { PROMPT_LANGUAGES, type PromptLanguage } from './prompt';
import { useCopyWhysPrompt, usePromptLanguage } from './useWhysPrompt';
import { WhysDialog } from './WhysDialog';

/**
 * Side panel of a node: how many 5 Whys sessions it has, the way in, and a
 * one-press copy of the full prompt for an AI chat (button or shortcut).
 */
export function WhysPanel({ node }: { node: GraphNode }) {
  const { t } = useI18n();
  const readOnly = useReadOnly();
  const sessions = useWhySessions(node.id);
  const [open, setOpenState] = useState(false);
  // The prompt quotes the saved notes: save what is still being typed first.
  const setOpen = (value: boolean) => {
    if (value) void flushAllAutosaves();
    setOpenState(value);
  };
  const [lang, setLang] = usePromptLanguage();
  const copyPrompt = useCopyWhysPrompt(node.id);
  const tip = useCommandTooltip('km.node.whys');
  const copyTip = useCommandTooltip('km.node.whysCopyPrompt');
  useCommandHandler('km.node.whys', () => {
    setOpen(true);
  });
  // Its result can only be saved by a writer, so read-only mode has no copy.
  useCommandHandler(
    'km.node.whysCopyPrompt',
    () => {
      void copyPrompt(lang);
    },
    !readOnly,
  );
  const count = sessions.data?.length;

  return (
    <section className="panel whys-panel" aria-label={t('whys.heading')}>
      <h3>{t('whys.heading')}</h3>
      <p className="muted">
        {count === undefined
          ? t('common.loading')
          : count === 0
            ? t('whys.none')
            : t('whys.count', { count })}
      </p>
      <div className="whys-panel-actions">
        <button
          type="button"
          {...tip}
          onClick={() => {
            setOpen(true);
          }}
        >
          {t('whys.open')}
        </button>
        {!readOnly && (
          <span className="whys-panel-copy">
            <button
              type="button"
              className="subtle"
              {...copyTip}
              onClick={() => {
                void copyPrompt(lang);
              }}
            >
              {t('whys.copyPrompt')}
            </button>
            <select
              aria-label={t('whys.promptLang')}
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
          </span>
        )}
      </div>
      {open && (
        <WhysDialog
          node={node}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </section>
  );
}
