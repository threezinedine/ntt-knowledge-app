import { useI18n } from '../i18n/context';
import { COMMAND_BY_ID, type CommandId } from './catalog';
import { ariaKeyShortcut, type Keybinding } from './keybinding';
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
 * "Label [first binding]", like VS Code's buttons. Unbound commands get no
 * tooltip (the control's own text says it already) unless `always` is set,
 * for icon-only buttons. Screen readers get every single-press binding.
 */
export function commandTooltipProps(
  label: string,
  keys: readonly Keybinding[],
  always = false,
): TooltipProps {
  const first = keys.at(0);
  if (first === undefined && !always) return {};
  const props: TooltipProps = { 'data-tooltip': label };
  if (first !== undefined) props['data-tooltip-keys'] = first;
  const aria = keys
    .map(ariaKeyShortcut)
    .filter((k): k is string => k !== null)
    .join(' ');
  if (aria) props['aria-keyshortcuts'] = aria;
  return props;
}

/** Tooltip for a control that does what command `id` does; follows rebinding. */
export function useCommandTooltip(
  id: CommandId,
  { label, always = false }: { label?: string; always?: boolean } = {},
): TooltipProps {
  const { t } = useI18n();
  const keys = useBindings().get(id) ?? [];
  const spec = COMMAND_BY_ID.get(id);
  return commandTooltipProps(label ?? (spec ? t(spec.title) : id), keys, always);
}
