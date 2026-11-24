import { useEffect, useState, type ReactNode } from 'react';
import { useI18n } from '../../i18n/context';
import { engineStorage } from '../../local/engine';
import type { Storage } from '../../local/protocol';
import { isNativeApp, ReadOnlyContext } from '../readOnly';

/**
 * Starts this device's copy of the graph (the engine Worker) next to the app. There is no sign-in: the data is on this device; only
 * connecting to the hub (Sync) takes the authenticator code.
 *
 * - The file is held by another tab: say so (one tab at a time can open it).
 * - No file storage here (memory only): the app runs, with a warning that
 *   nothing is kept after closing.
 */
export function LocalGate({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [storage, setStorage] = useState<Storage | null>(null);
  useEffect(() => {
    void engineStorage().then(setStorage);
  }, []);

  // The app shows at once (as it always did); its first answers wait for the engine.
  if (storage === 'busy' || storage === 'failed') {
    return (
      <main className="auth-page">
        <div className="auth-card">
          <span className="auth-logo" aria-hidden="true">
            ◆
          </span>
          <h1>{t(storage === 'busy' ? 'local.busyTitle' : 'local.failedTitle')}</h1>
          <p className="muted">{t(storage === 'busy' ? 'local.busy' : 'local.failed')}</p>
          <button
            type="button"
            onClick={() => {
              window.location.reload();
            }}
          >
            {t('local.retry')}
          </button>
        </div>
      </main>
    );
  }
  return (
    <ReadOnlyContext value={isNativeApp()}>
      {storage === 'memory' && (
        <p className="storage-warning" role="alert">
          {t('local.memoryOnly')}
        </p>
      )}
      {children}
    </ReadOnlyContext>
  );
}
