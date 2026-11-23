import { Fragment, type ReactNode } from 'react';
import { useBindings } from '../../commands/keybindingStore';
import { Keys } from '../../commands/Keys';
import { useI18n } from '../../i18n/context';

/**
 * How to move between title and content, with the user's current keys:
 * "[Alt+K] title · [Alt+J] content · [Enter] from the title", plus the vim
 * keys when vim mode is on.
 */
export function JumpHint({ vim }: { vim: boolean }) {
  const { tx } = useI18n();
  const bindings = useBindings();
  const toTitle = bindings.get('km.node.focusTitle')?.[0];
  const toContent = bindings.get('km.node.focusContent')?.[0];
  const parts: ReactNode[] = [];
  if (toTitle) parts.push(tx('editor.hintTitle', { keys: <Keys binding={toTitle} /> }));
  if (toContent) parts.push(tx('editor.hintContent', { keys: <Keys binding={toContent} /> }));
  parts.push(tx('editor.hintEnter', { enter: <kbd>Enter</kbd> }));
  if (vim) {
    parts.push(
      tx('editor.hintVim', {
        j: <kbd>j</kbd>,
        k: <kbd>k</kbd>,
        esc: <Keys binding="Ctrl+[" />,
      }),
    );
  }
  return (
    <p className="editor-hint" data-testid="jump-hint">
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && ' · '}
          {part}
        </Fragment>
      ))}
    </p>
  );
}
