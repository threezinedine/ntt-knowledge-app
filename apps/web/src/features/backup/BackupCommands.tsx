import { useBackupNow, useExportMarkdown } from '../../api/queries';
import { useCommandHandler } from '../../commands/registry';
import { showToast } from '../../components/toast';
import { useI18n } from '../../i18n/context';
import { useReadOnly } from '../readOnly';

/** "1.2 MB" / "640 kB", in the UI language's number format. */
export function formatSize(bytes: number, locale: string): string {
  const mega = bytes >= 1024 * 1024;
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit: mega ? 'megabyte' : 'kilobyte',
    maximumFractionDigits: 1,
  }).format(mega ? bytes / 1024 / 1024 : Math.max(1, Math.round(bytes / 1024)));
}

/**
 * "Backup Now" and "Export Markdown", from the command palette only. Both
 * write on the server's machine, into the backup folder (KM_BACKUP_DIR);
 * restoring is a terminal command (`npm run backup:restore`). Not on the
 * phone: it only views.
 */
export function BackupCommands() {
  const { t, locale, errorText } = useI18n();
  const readOnly = useReadOnly();
  const backup = useBackupNow();
  const exportMd = useExportMarkdown();

  useCommandHandler(
    'km.backup.now',
    () => {
      if (backup.isPending) return;
      showToast(t('backup.working'));
      backup.mutate(undefined, {
        onSuccess: (r) => {
          showToast(
            t('backup.done', { file: r.file, size: formatSize(r.sizeBytes, locale), dir: r.dir }),
          );
        },
        onError: (err) => {
          showToast(errorText(err));
        },
      });
    },
    !readOnly,
  );

  useCommandHandler(
    'km.backup.exportMarkdown',
    () => {
      if (exportMd.isPending) return;
      showToast(t('export.working'));
      exportMd.mutate(undefined, {
        onSuccess: (r) => {
          showToast(t('export.done', { files: r.files, dir: r.dir }));
        },
        onError: (err) => {
          showToast(errorText(err));
        },
      });
    },
    !readOnly,
  );

  return null;
}
