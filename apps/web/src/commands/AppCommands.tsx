import { useNavigate } from 'react-router';
import { useI18n } from '../i18n/context';
import { useChordStatus, useKeybindingDispatcher } from './dispatch';
import { formatBinding, formatPress } from './keybinding';
import { openQuickInput, openQuickPick } from './quickInputStore';
import { useCommandHandler } from './registry';

/** App-wide commands, the keyboard dispatcher and the chord status line. */
export function AppCommands({
  onToggleSidebar,
  onFocusSearch,
}: {
  onToggleSidebar: () => void;
  onFocusSearch: () => void;
}) {
  const navigate = useNavigate();
  const { t, locale, locales, setLocale } = useI18n();
  useKeybindingDispatcher();

  useCommandHandler('workbench.action.showCommands', () => {
    openQuickInput('>');
  });
  useCommandHandler('workbench.action.quickOpen', () => {
    openQuickInput('');
  });
  useCommandHandler('workbench.action.openGlobalKeybindings', () => void navigate('/shortcuts'));
  useCommandHandler('workbench.action.toggleSidebarVisibility', onToggleSidebar);
  useCommandHandler('km.sidebar.focusSearch', onFocusSearch);
  useCommandHandler('km.go.graph', () => void navigate('/'));
  useCommandHandler('km.go.tags', () => void navigate('/tags'));
  useCommandHandler('km.language.change', () => {
    openQuickPick({
      placeholder: t('quick.languagePlaceholder'),
      items: locales.map((l) => ({
        id: l.code,
        label: l.name,
        description: l.code,
        current: l.code === locale,
        run: () => {
          setLocale(l.code);
        },
      })),
    });
  });

  return <ChordStatusLine />;
}

function ChordStatusLine() {
  const { t } = useI18n();
  const status = useChordStatus();
  if (!status) return null;
  return (
    <div className="chord-status" role="status">
      {status.kind === 'waiting'
        ? t('shortcuts.chordWaiting', { keys: formatPress(status.prefix) })
        : t('shortcuts.chordMiss', { keys: formatBinding(status.binding) })}
    </div>
  );
}
