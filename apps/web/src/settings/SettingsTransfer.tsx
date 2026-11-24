import { useEffect, useRef, type ReactNode } from 'react';
import { useCommandHandler } from '../commands/registry';
import { showToast } from '../components/toast';
import { copyTextNow } from '../features/ai/copyPrompt';
import { isNativeApp } from '../features/readOnly';
import { flushAllAutosaves } from '../hooks/useAutosave';
import { useI18n } from '../i18n/context';
import { IMPORT_NOTE_KEY, PENDING_IMPORT_KEY, type PendingImport } from './bootImport';
import {
  browserStorage,
  buildSettingsFile,
  planSettingsImport,
  settingsFileName,
  shortList,
} from './settingsFile';

type ImportNote = PendingImport['note'];

/**
 * Export / import of the device settings (see settingsFile.ts). Import checks
 * the file, stages what to write and reloads; bootImport.ts writes it before
 * any store reads its settings (several read them once, at start). Unsaved
 * edits are saved first; nothing changes if the reload is cancelled.
 */
export function useSettingsTransfer(): {
  exportNow: () => void;
  openImport: () => void;
  input: ReactNode;
} {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);

  const exportNow = () => {
    const text = buildSettingsFile(browserStorage);
    // The phone app's WebView can't save a download: copy it instead.
    if (isNativeApp()) {
      showToast(copyTextNow(text) ? t('settingsFile.copied') : t('settingsFile.copyFailed'));
      return;
    }
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = settingsFileName();
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
    showToast(t('settingsFile.exported', { file: a.download }));
  };

  const importText = (text: string) => {
    const result = planSettingsImport(text, browserStorage);
    if (!result.ok) {
      showToast(
        t(
          result.reason === 'invalidJson' ? 'settingsFile.invalidJson' : 'settingsFile.notSettings',
        ),
      );
      return;
    }
    const stage = (): void => {
      sessionStorage.setItem(
        PENDING_IMPORT_KEY,
        JSON.stringify({
          at: Date.now(),
          writes: result.writes,
          note: { applied: result.applied.length, skipped: shortList(result.skipped) },
        } satisfies PendingImport),
      );
    };
    try {
      stage(); // now, to find out whether storage is usable at all
    } catch {
      showToast(t('settingsFile.storageBlocked'));
      return;
    }
    void flushAllAutosaves().finally(() => {
      // Stamped again right before the reload: a slow save mustn't make it look stale.
      try {
        stage();
      } catch {
        // Staged above already.
      }
      window.location.reload();
    });
  };

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept=".json,application/json"
      hidden
      aria-label={t('settingsFile.pick')}
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = ''; // the same file can be picked again
        if (!file) return;
        file.text().then(importText, () => {
          showToast(t('settingsFile.readFailed'));
        });
      }}
    />
  );

  return {
    exportNow,
    openImport: () => {
      inputRef.current?.click();
    },
    input,
  };
}

/** The palette commands, and the toast after an import's reload. Mounted once, in App. */
export function SettingsCommands() {
  const { t } = useI18n();
  const transfer = useSettingsTransfer();
  useCommandHandler('km.settings.export', transfer.exportNow);
  useCommandHandler('km.settings.import', transfer.openImport);

  useEffect(() => {
    let note: ImportNote | null;
    try {
      const raw = sessionStorage.getItem(IMPORT_NOTE_KEY);
      sessionStorage.removeItem(IMPORT_NOTE_KEY);
      note = raw === null ? null : (JSON.parse(raw) as ImportNote);
    } catch {
      note = null;
    }
    if (!note) return;
    showToast(
      note.skipped === ''
        ? t('settingsFile.imported', { count: note.applied })
        : t('settingsFile.importedSkipped', {
            count: note.applied,
            skipped: note.skipped,
          }),
    );
  }, [t]);

  return transfer.input;
}

/** Export / Import buttons, at the foot of the graph settings (desktop panel and phone tab). */
export function SettingsTransferButtons() {
  const { t } = useI18n();
  const transfer = useSettingsTransfer();
  return (
    <div className="settings-transfer">
      <p className="muted">{t('settingsFile.hint')}</p>
      <button type="button" onClick={transfer.exportNow}>
        {t('cmd.exportSettings')}
      </button>
      <button type="button" onClick={transfer.openImport}>
        {t('cmd.importSettings')}
      </button>
      {transfer.input}
    </div>
  );
}
