import { describe, expect, it } from 'vitest';
import { commandTooltipProps } from './useCommandTooltip';

describe('commandTooltipProps', () => {
  it('shows the first binding and lists single presses for screen readers', () => {
    expect(commandTooltipProps('Show All Commands', ['Ctrl+Shift+P', 'F1'])).toEqual({
      'data-tooltip': 'Show All Commands',
      'data-tooltip-keys': 'Ctrl+Shift+P',
      'aria-keyshortcuts': 'Control+Shift+P F1',
    });
  });

  it('keeps a chord in the tooltip but not in aria-keyshortcuts', () => {
    expect(commandTooltipProps('Toggle Preview', ['Ctrl+K Ctrl+V'])).toEqual({
      'data-tooltip': 'Toggle Preview',
      'data-tooltip-keys': 'Ctrl+K Ctrl+V',
    });
  });

  it('adds nothing for an unbound command, unless always', () => {
    expect(commandTooltipProps('Delete Node…', [])).toEqual({});
    expect(commandTooltipProps('Zoom In', [], true)).toEqual({ 'data-tooltip': 'Zoom In' });
  });
});
