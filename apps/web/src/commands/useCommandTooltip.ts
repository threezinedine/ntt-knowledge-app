import { useI18n } from '../i18n/context';
import { COMMAND_BY_ID, type CommandId } from './catalog';
import { ariaKeyShortcut } from './keybinding';
import { useBindings } from './keybindingStore';

/** Attributes read by `<TooltipLayer>`; spread them onto any element. */
export interface TooltipProps {
  'data-tooltip'?: string;
  'data-tooltip-keys'?: string;
  'aria-keyshortcuts'?: string;
}

/** A plain hover/focus tooltip (no command behind it). */
export function tooltip(label: string): TooltipProps {
  return { 'data-tooltip': label };
}

/**
 * Tooltip for a control that does what command `id` does: "Label [Alt+N]",
 * like VS Code's buttons. Follows the user's rebindings; shows the first one.
 * Unbound commands get no tooltip (the control's own text says it already)
 * unless `always` is set, for icon-only buttons.
 */
export function useCommandTooltip(
  id: CommandId,
  { label, always = false }: { label?: string; always?: boolean } = {},
): TooltipProps {
  const { t } = useI18n();
  const keys = useBindings().get(id) ?? [];
  const first = keys.at(0);
  if (first === undefined && !always) return {};
  const spec = COMMAND_BY_ID.get(id);
  const props: TooltipProps = { 'data-tooltip': label ?? (spec ? t(spec.title) : id) };
  if (first !== undefined) props['data-tooltip-keys'] = first;
  const aria = keys
    .map(ariaKeyShortcut)
    .filter((k): k is string => k !== null)
    .join(' ');
  if (aria) props['aria-keyshortcuts'] = aria;
  return props;
}
