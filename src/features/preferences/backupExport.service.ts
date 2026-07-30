import { exportDatabaseBackupAsync } from '@engines/persistence';
import { downloadJson } from '@platform/download';
import { recordAudit } from '../audit/audit.service';

type BackupExportContext = {
  businessDate?: string;
  source: 'manual' | 'daily-close';
};

export async function exportBackupForDownload({ businessDate, source }: BackupExportContext) {
  // The asynchronous export is essential: the synchronous format deliberately
  // has no IndexedDB blobs, while condition and catalogue photos are business
  // records that must survive the same backup as the daily close.
  const backup = await exportDatabaseBackupAsync();
  const date = businessDate ?? backup.exportedAt.slice(0, 10);
  const filename = `lena-backup-${date}${source === 'daily-close' ? '-after-close' : ''}.json`;

  downloadJson(filename, backup);
  recordAudit({
    action: 'create',
    entityType: 'backup',
    entityId: backup.exportedAt,
    summary: source === 'daily-close'
      ? `تم تصدير نسخة احتياطية بعد إقفال يومية ${businessDate}.`
      : 'تم تصدير نسخة احتياطية من بيانات التطبيق.',
  });

  return { backup, filename };
}
