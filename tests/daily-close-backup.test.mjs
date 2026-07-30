import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = join(repositoryRoot, 'src');

test('manual and daily-close exports include IndexedDB images through the shared backup path', async () => {
  const exporter = await readFile(join(sourceRoot, 'features/preferences/backupExport.service.ts'), 'utf8');

  assert.match(exporter, /exportDatabaseBackupAsync/, 'a backup must include image blobs, not only localStorage collections');
  assert.match(exporter, /downloadJson/, 'download mechanics stay inside the platform boundary');
  assert.match(exporter, /recordAudit/, 'each completed backup keeps an audit record');
  assert.match(exporter, /after-close/, 'the daily-close filename must be identifiable to the operator');
});

test('a successful daily close triggers a backup without making the close depend on download success', async () => {
  const page = await readFile(join(sourceRoot, 'features/reports/DailyClosingPage.tsx'), 'utf8');

  assert.match(page, /await exportClosingBackup\(closing\)/, 'every successful close must request its backup');
  assert.match(page, /catch \{[\s\S]*?setBackupWarning/, 'a download failure must leave the already-closed day intact');
  assert.match(page, /تجهيز النسخة الآن/, 'the operator must have an immediate retry path');
  assert.match(page, /isClosing/, 'a second tap must not start a second close while backup preparation is running');
});

test('the settings export uses the same full backup path and prevents duplicate taps', async () => {
  const page = await readFile(join(sourceRoot, 'features/preferences/PreferencesPage.tsx'), 'utf8');

  assert.match(page, /await exportBackupForDownload\(\{ source: 'manual' \}\)/);
  assert.match(page, /isExporting/);
  assert.match(page, /disabled=\{isExporting\}/);
  assert.match(page, /await importDatabaseBackupAsync\(parsed\)/, 'a full backup must restore its IndexedDB images too');
});
