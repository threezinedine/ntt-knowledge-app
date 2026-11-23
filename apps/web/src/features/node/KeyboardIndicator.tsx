import { tooltip } from '../../commands/useCommandTooltip';
import type { MessageKey } from '../../i18n/catalog';
import { useI18n } from '../../i18n/context';
import { useInputKind, type InputKind } from '../../settings/keyboardInput';

const TEXT: Record<InputKind, { label: MessageKey; tip: MessageKey }> = {
  unknown: { label: 'keyboard.unknown', tip: 'keyboard.unknownTip' },
  latin: { label: 'keyboard.latin', tip: 'keyboard.latinTip' },
  vietnamese: { label: 'keyboard.vietnamese', tip: 'keyboard.vietnameseTip' },
  ime: { label: 'keyboard.ime', tip: 'keyboard.imeTip' },
  other: { label: 'keyboard.other', tip: 'keyboard.otherTip' },
};

/**
 * Next to the Vim toggle: which input language the keyboard seems to type,
 * flagged when it would break vim's letter commands.
 */
export function KeyboardIndicator() {
  const { t } = useI18n();
  const kind = useInputKind();
  const { label, tip } = TEXT[kind];
  const bad = kind === 'vietnamese' || kind === 'ime' || kind === 'other';
  return (
    <span
      className={`keyboard-indicator${bad ? ' warn' : ''}`}
      data-testid="keyboard-indicator"
      data-kind={kind}
      aria-label={t(tip)}
      {...tooltip(t(tip))}
    >
      ⌨ {t(label)}
    </span>
  );
}
