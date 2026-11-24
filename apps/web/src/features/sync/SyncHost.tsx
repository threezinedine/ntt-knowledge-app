import { syncState, type SyncState, type SyncStatus } from '@km/core';
import { useEffect } from 'react';
import { PULLED_NOTE_KEY, useSyncStatus } from '../../api/queries';
import { useCommandHandler } from '../../commands/registry';
import { SyncIcon } from '../../components/icons';
import { showToast } from '../../components/toast';
import { useI18n } from '../../i18n/context';
import { hasWritten, memoryOnly } from '../../local/engine';
import { isNativeApp, useReadOnly } from '../readOnly';
import { SyncDialog } from './SyncDialog';
import { dismissSyncWarning, openSyncDialog, useSyncUi } from './syncStore';

/** The version a state is about: the hub's when it is ahead, else this device's. */
function versionOf(status: SyncStatus, state: SyncState): number | null {
  if (!status.connected) return null;
  if (state === 'behind' || state === 'diverged') return status.hub?.version ?? null;
  return status.synced?.version ?? null;
}

const SHORT: Record<SyncState, string> = {
  off: '',
  offline: '',
  error: '!',
  upToDate: '✓',
  changes: '•',
  behind: '↓',
  diverged: '⚠',
};

/** The title bar's sync button: where this device stands, and the way into the Sync dialog. */
export function SyncIndicator() {
  const { t } = useI18n();
  const status = useSyncStatus();
  if (!status.data) return null;
  const state = syncState(status.data);
  const version = versionOf(status.data, state);
  const label =
    state === 'changes' && version === null
      ? t('sync.state.changesNew')
      : t(`sync.state.${state}`, { version: version ?? '' });
  return (
    <button
      type="button"
      className={`sync-indicator sync-${state}`}
      aria-label={label}
      title={label}
      onClick={() => {
        openSyncDialog();
      }}
    >
      <SyncIcon size={14} />
      <span className="sync-indicator-text" aria-hidden="true">
        {state === 'off'
          ? t('sync.title')
          : state === 'offline'
            ? t('sync.offline')
            : `${version === null ? '' : `v${String(version)} `}${SHORT[state]}`}
      </span>
    </button>
  );
}

/** Every device syncs: a browser pushes and pulls; the phone app only pulls. */
export function useCanSync(): boolean {
  const readOnly = useReadOnly();
  return !readOnly || isNativeApp();
}

/**
 * Mounted once (App): the Sync commands, the dialog, the edit warning and
 * the note after a pull's reload.
 */
export function SyncHost() {
  const { t } = useI18n();
  const canSync = useCanSync();
  const pullOnly = isNativeApp();
  const ui = useSyncUi();
  useCommandHandler(
    'km.sync.open',
    () => {
      openSyncDialog();
    },
    canSync,
  );
  useCommandHandler(
    'km.sync.push',
    () => {
      openSyncDialog('push');
    },
    canSync && !pullOnly,
  );
  useCommandHandler(
    'km.sync.pull',
    () => {
      openSyncDialog('pull');
    },
    canSync,
  );

  const status = useSyncStatus(canSync);
  const unpushed = status.data?.connected === true && status.data.localChanged;
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      // In memory-only mode (a private window) everything is lost on close.
      if (unpushed || (memoryOnly() && hasWritten())) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
    };
  }, [unpushed]);

  useEffect(() => {
    let version: string | null = null;
    try {
      version = sessionStorage.getItem(PULLED_NOTE_KEY);
      sessionStorage.removeItem(PULLED_NOTE_KEY);
    } catch {
      // No note.
    }
    if (version !== null) showToast(t('sync.pulled', { version }));
  }, [t]);

  if (!canSync) return null;
  return (
    <>
      {ui.dialog && <SyncDialog action={ui.dialog.action} pullOnly={pullOnly} />}
      {ui.warning !== null && (
        <div className="sync-warning" role="alert">
          <p>{t('sync.warning', { version: ui.warning })}</p>
          <div className="dialog-actions">
            <button type="button" onClick={dismissSyncWarning}>
              {t('sync.warningKeep')}
            </button>
            <button
              type="button"
              onClick={() => {
                openSyncDialog();
              }}
            >
              {t('sync.warningOpen')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
