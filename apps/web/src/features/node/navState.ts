/**
 * Navigation state for a node that was just created: its page opens with the
 * (placeholder) title focused and selected, so typing replaces it.
 */
export const NEW_NODE_STATE = { focusTitle: true } as const;

export function wantsTitleFocus(state: unknown): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    'focusTitle' in state &&
    state.focusTitle === true
  );
}
