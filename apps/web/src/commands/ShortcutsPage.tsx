import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useI18n } from '../i18n/context';
import { COMMAND_LIST, COMMAND_BY_ID, type CommandId, type CommandSpec } from './catalog';
import { suspendKeybindings } from './dispatch';
import { fold, fuzzyMatch } from './fuzzy';
import { formatBinding, parseBinding, pressFromEvent, type KeyPress } from './keybinding';
import {
  addBinding,
  clashingCommands,
  findConflicts,
  isUserBinding,
  resetBinding,
  setBinding,
  useBindings,
} from './keybindingStore';
import { Keys } from './Keys';
import { tooltip } from './useCommandTooltip';

type RecordMode = 'replace' | 'add';
interface Recording {
  id: CommandId;
  mode: RecordMode;
}

/** VS Code's "Keyboard Shortcuts" editor: every command, its keys, and rebinding. */
export function ShortcutsPage() {
  const { t } = useI18n();
  const bindings = useBindings();
  const [search, setSearch] = useState('');
  const [recording, setRecording] = useState<Recording | null>(null);
  const conflicts = useMemo(() => findConflicts(bindings), [bindings]);
  const titleOf = (id: CommandId) => {
    const spec = COMMAND_BY_ID.get(id);
    return spec ? t(spec.title) : id;
  };

  const label = (c: CommandSpec) => `${t(c.category)}: ${t(c.title)}`;
  const rows = COMMAND_LIST.filter((c) => {
    if (search.trim() === '') return true;
    const keysText = (bindings.get(c.id) ?? []).map((k) => formatBinding(k)).join(' ');
    return fuzzyMatch(search, label(c)) !== null || fold(keysText).includes(fold(search.trim()));
  });

  return (
    <div className="shortcuts-page">
      <h2>{t('shortcuts.heading')}</h2>
      <p className="muted">
        {t('shortcuts.help', { example: formatBinding(parseBinding('Mod+K Mod+S') ?? '') })}
      </p>
      <input
        type="search"
        className="shortcuts-search"
        aria-label={t('shortcuts.search')}
        placeholder={t('shortcuts.search')}
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
        }}
      />
      <table className="shortcuts-table">
        <thead>
          <tr>
            <th>{t('shortcuts.command')}</th>
            <th>{t('shortcuts.keybinding')}</th>
            <th>{t('shortcuts.when')}</th>
            <th>{t('shortcuts.source')}</th>
            <th>
              <span className="visually-hidden">{t('shortcuts.actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((c) => {
            const keys = bindings.get(c.id) ?? [];
            const clashes = conflicts.get(c.id) ?? [];
            const user = isUserBinding(c.id);
            const command = t(c.title);
            return (
              <tr key={c.id} data-testid={`shortcut-${c.id}`}>
                <td>
                  <span className="shortcut-title">{label(c)}</span>
                  <span className="shortcut-id">{c.id}</span>
                </td>
                <td>
                  {keys.length === 0 ? (
                    <span className="muted">—</span>
                  ) : (
                    keys.map((k) => <Keys key={k} binding={k} />)
                  )}
                  {clashes.length > 0 && (
                    <span className="shortcut-conflict" role="note">
                      {t('shortcuts.conflict', { commands: clashes.map(titleOf).join(', ') })}
                    </span>
                  )}
                </td>
                <td className="muted">{c.when ? t(c.when) : t('cmdWhen.always')}</td>
                <td className="muted">{user ? t('shortcuts.user') : t('shortcuts.default')}</td>
                <td className="shortcut-actions">
                  <button
                    type="button"
                    className="icon subtle"
                    aria-label={t('shortcuts.change', { command })}
                    {...tooltip(t('shortcuts.changeTitle'))}
                    onClick={() => {
                      setRecording({ id: c.id, mode: 'replace' });
                    }}
                  >
                    ✎
                  </button>
                  {keys.length > 0 && (
                    <button
                      type="button"
                      className="icon subtle"
                      aria-label={t('shortcuts.add', { command })}
                      {...tooltip(t('shortcuts.addTitle'))}
                      onClick={() => {
                        setRecording({ id: c.id, mode: 'add' });
                      }}
                    >
                      +
                    </button>
                  )}
                  {keys.length > 0 && (
                    <button
                      type="button"
                      className="icon subtle"
                      aria-label={t('shortcuts.remove', { command })}
                      {...tooltip(t('shortcuts.removeTitle'))}
                      onClick={() => {
                        setBinding(c.id, []);
                      }}
                    >
                      ×
                    </button>
                  )}
                  {user && (
                    <button
                      type="button"
                      className="icon subtle"
                      aria-label={t('shortcuts.reset', { command })}
                      {...tooltip(t('shortcuts.resetTitle'))}
                      onClick={() => {
                        resetBinding(c.id);
                      }}
                    >
                      ↺
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && <p className="muted">{t('quick.noCommands')}</p>}
      {recording && (
        <KeyRecorder
          commandId={recording.id}
          mode={recording.mode}
          titleOf={titleOf}
          onDone={() => {
            setRecording(null);
          }}
        />
      )}
    </div>
  );
}

/**
 * Modal that records one press or a two-press chord. Keyboard: Enter saves,
 * Escape cancels. The buttons are for touch screens and screen readers.
 */
function KeyRecorder({
  commandId,
  mode,
  titleOf,
  onDone,
}: {
  commandId: CommandId;
  mode: RecordMode;
  titleOf: (id: CommandId) => string;
  onDone: () => void;
}) {
  const { t } = useI18n();
  const bindings = useBindings();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [presses, setPresses] = useState<KeyPress[]>([]);
  const binding = presses.join(' ');
  const usedBy = binding ? clashingCommands(binding, bindings, commandId).map(titleOf) : [];

  useEffect(() => {
    dialogRef.current?.showModal();
    dialogRef.current?.focus(); // keys go to the dialog, not a button
    return suspendKeybindings();
  }, []);

  const save = () => {
    if (binding) {
      if (mode === 'add') addBinding(commandId, binding);
      else setBinding(commandId, [binding]);
    }
    onDone();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    const plain = !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey;
    if (e.key === 'Escape' && plain) {
      onDone();
      return;
    }
    if (e.key === 'Enter' && plain) {
      save();
      return;
    }
    const press = pressFromEvent(e.nativeEvent);
    if (press === null) return;
    // A third press starts over, like VS Code.
    setPresses((prev) => (prev.length >= 2 ? [press] : [...prev, press]));
  };

  return (
    <dialog
      ref={dialogRef}
      className="dialog key-recorder"
      tabIndex={-1}
      aria-label={t('shortcuts.recordLabel', { command: titleOf(commandId) })}
      onKeyDown={onKeyDown}
      onCancel={(e) => {
        e.preventDefault();
        onDone();
      }}
    >
      <p>{t(mode === 'add' ? 'shortcuts.recordHelpAdd' : 'shortcuts.recordHelp')}</p>
      <div className="key-recorder-value" data-testid="recorded-keys" aria-live="polite">
        {binding ? <Keys binding={binding} /> : <span className="muted">…</span>}
      </div>
      {usedBy.length > 0 && (
        <p className="shortcut-conflict">
          {t('shortcuts.conflict', { commands: usedBy.join(', ') })}
        </p>
      )}
      <div className="dialog-actions">
        <button
          type="button"
          tabIndex={-1}
          disabled={presses.length === 0}
          onClick={() => {
            setPresses([]);
            dialogRef.current?.focus();
          }}
        >
          {t('shortcuts.clear')}
        </button>
        <button type="button" tabIndex={-1} onClick={onDone}>
          {t('common.cancel')}
        </button>
        <button type="button" className="primary" tabIndex={-1} disabled={!binding} onClick={save}>
          {t('common.save')}
        </button>
      </div>
    </dialog>
  );
}
