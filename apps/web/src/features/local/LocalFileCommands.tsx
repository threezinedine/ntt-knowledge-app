import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { keys } from '../../api/queries';
import { useCommandHandler } from '../../commands/registry';
import { showToast } from '../../components/toast';
import { flushAllAutosaves } from '../../hooks/useAutosave';
import { useI18n } from '../../i18n/context';
import { importDatabase, markdownFiles, reloadAfterClosing } from '../../local/engine';
import { useReadOnly } from '../readOnly';
import type { SyncStatus } from '@km/core';
import {
  chooseDiskFile,
  diskFileSupported,
  forgetDiskFile,
  pickDatabaseFile,
  resumeDiskFile,
  startDiskFile,
  useDiskFile,
  writeToFolder,
} from './diskFile';

/**
 * This device's copy as files: keep it in a file on disk (and resume that
 * after a reload), open a copy from a file, and export markdown into a
 * folder. Chrome and Edge only (File System Access); not on the phone.
 */
export function LocalFileCommands() {
  const { t } = useI18n();
  const readOnly = useReadOnly();
  const qc = useQueryClient();
  const disk = useDiskFile();
  const can = !readOnly && diskFileSupported();

  useEffect(() => {
    if (can) startDiskFile();
  }, [can]);

  useCommandHandler(
    'km.local.saveToFile',
    () => {
      void chooseDiskFile().then((name) => {
        if (name !== null) showToast(t('local.savingTo', { name }));
      });
    },
    can,
  );

  useCommandHandler(
    'km.local.openFromFile',
    () => {
      // Always asked: this device's copy may be the only one (never pushed).
      const status = qc.getQueryData<SyncStatus>(keys.sync);
      const safe = status?.connected === true && !status.localChanged;
      if (!window.confirm(t(safe ? 'local.confirmOpen' : 'local.confirmOpenOnly'))) return;
      void (async () => {
        await flushAllAutosaves();
        const bytes = await pickDatabaseFile();
        if (!bytes) return;
        try {
          await importDatabase(bytes);
        } catch {
          showToast(t('local.openFailed'));
          return;
        }
        await reloadAfterClosing();
      })();
    },
    can,
  );

  useCommandHandler(
    'km.backup.exportMarkdown',
    () => {
      void (async () => {
        try {
          const files = await markdownFiles();
          const folder = await writeToFolder(files);
          if (folder !== null) showToast(t('export.done', { files: files.length, dir: folder }));
        } catch {
          showToast(t('export.failed'));
        }
      })();
    },
    can,
  );

  useCommandHandler(
    'km.local.stopSaving',
    () => {
      void forgetDiskFile().then(() => {
        showToast(t('local.stopped'));
      });
    },
    can && disk.name !== null,
  );

  if (!can || disk.name === null || (!disk.paused && !disk.error)) return null;
  return (
    <div className="sync-warning" role="alert">
      <p>
        {disk.paused
          ? t('local.paused', { name: disk.name })
          : t('local.writeFailed', { name: disk.name })}
      </p>
      <div className="dialog-actions">
        <button
          type="button"
          onClick={() => {
            void forgetDiskFile();
          }}
        >
          {t('local.stopSaving')}
        </button>
        <button
          type="button"
          onClick={() => {
            void resumeDiskFile();
          }}
        >
          {t('local.resume')}
        </button>
      </div>
    </div>
  );
}
