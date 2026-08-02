import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

async function read(path) {
  return readFile(join(root, path), 'utf8');
}

async function exists(path) {
  try {
    await access(join(root, path));
    return true;
  } catch {
    return false;
  }
}

test('Tauri loading and snapshot behavior stay inside the isolated desktop island', async () => {
  const runtime = await read('src/platform/runtime/tauriRuntime.ts');
  const desktop = await read('src/platform/desktop/DesktopDatabase.ts');

  assert.match(runtime, /import\('@tauri-apps\/api\/core'\)/);
  assert.match(runtime, /export async function getDesktopInvoke/);
  assert.match(desktop, /import \{ getDesktopInvoke \} from '@platform\/runtime';/);
  assert.match(desktop, /invoke\('load_desktop_snapshot'\)/);
  assert.match(desktop, /invoke\('save_desktop_snapshot'/);
  assert.match(desktop, /}, 500\);/);
  // The island consumes the shared neutral contract (Desktop → shared),
  // never the other way around, and no longer owns a branded event name.
  assert.match(desktop, /from '@shared\/persistence\/persistenceStatus';/);
  assert.doesNotMatch(desktop, /dress-roomshow:desktop-sync-status/);
});

test('web bootstrap does not initialize, migrate, or delete desktop storage', async () => {
  const app = await read('src/app/App.tsx');
  const mainEntry = await read('src/main.tsx');

  for (const source of [app, mainEntry]) {
    assert.doesNotMatch(source, /@platform\/desktop/);
    assert.doesNotMatch(source, /services\/desktopDatabase/);
    assert.doesNotMatch(source, /@tauri-apps\//);
    // Removing the legacy bootstrap must not delete or migrate user data:
    // neither entry point touches Web Storage or native snapshot payloads.
    assert.doesNotMatch(source, /localStorage|sessionStorage|removeItem/);
    assert.doesNotMatch(source, /load_desktop_snapshot|save_desktop_snapshot/);
  }
});

test('the web persistence hook is neutral and typed by the shared contract', async () => {
  const hook = await read('src/app/shell/usePersistenceStatus.ts');

  assert.match(hook, /@shared\/persistence\/persistenceStatus/);
  assert.match(hook, /PERSISTENCE_STATUS_EVENT/);
  assert.match(hook, /createDefaultPersistenceStatus/);
  assert.match(hook, /isPersistenceStatus/);
  assert.doesNotMatch(hook, /desktop|tauri/i);
  assert.doesNotMatch(hook, /globalThis/);
  assert.doesNotMatch(hook, /eslint-disable/);
  assert.doesNotMatch(hook, /\bany\b/);
  assert.doesNotMatch(hook, /dress-roomshow:desktop-sync-status/);

  // The Desktop-branded hook is gone; every caller uses the neutral one.
  assert.equal(await exists('src/app/shell/useDesktopPersistenceStatus.ts'), false);
  const shell = await read('src/app/shell/AppShell.tsx');
  assert.match(shell, /from '\.\/usePersistenceStatus';/);
  assert.doesNotMatch(shell, /useDesktopPersistenceStatus/);
  assert.doesNotMatch(shell, /desktopSyncStatus/);
});

test('the shared persistence contract is pure, neutral, and typed', async () => {
  const contract = await read('src/shared/persistence/persistenceStatus.ts');

  // Types, constants, and pure helpers only: no imports of Tauri, Desktop,
  // React, Supabase, or application services — in fact no imports at all.
  assert.doesNotMatch(contract, /^import /m);
  assert.match(contract, /'lena:persistence-status'/);
  assert.doesNotMatch(contract, /dress-roomshow:desktop-sync-status/);
  assert.doesNotMatch(contract, /desktop|tauri|react/i);

  const shared = await import('../src/shared/persistence/persistenceStatus.ts');
  assert.equal(shared.PERSISTENCE_STATUS_EVENT, 'lena:persistence-status');

  const fallback = shared.createDefaultPersistenceStatus();
  assert.equal(fallback.state, 'syncing');
  assert.equal(fallback.message, 'جارٍ التحقق من اتصال قاعدة بيانات المعرض…');
  assert.match(fallback.updatedAt, /^\d{4}-\d{2}-\d{2}T/);

  assert.equal(shared.isPersistenceStatus(fallback), true);
  assert.equal(shared.isPersistenceStatus({ state: 'error', message: 'x', updatedAt: 'x', attempts: 2 }), true);
  assert.equal(shared.isPersistenceStatus({ state: 'error', message: 'x', updatedAt: 'x' }), false);
  assert.equal(shared.isPersistenceStatus({ state: 'browser-fallback', message: 'x', updatedAt: 'x' }), false);
  assert.equal(shared.isPersistenceStatus(null), false);
});

test('legacy desktop service remains a compatibility delegate only', async () => {
  const legacy = await read('src/services/desktopDatabase.ts');

  assert.match(legacy, /from '@platform\/desktop';/);
  assert.doesNotMatch(legacy, /@tauri-apps/);
  assert.doesNotMatch(legacy, /localStorage/);
  assert.doesNotMatch(legacy, /setInterval/);
  assert.doesNotMatch(legacy, /save_desktop_snapshot/);
});
