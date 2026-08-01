import { getDesktopInvoke } from '@platform/runtime';
import {
  PERSISTENCE_STATUS_EVENT,
  type PersistenceStatus,
} from '@shared/persistence/persistenceStatus';

const PREFIX = 'dress-roomshow:';

/**
 * Desktop island, retained temporarily for compatibility and historical
 * recovery. The official Web App + PWA runtime never imports this module
 * (see docs/adr/0001-web-pwa-supabase-only.md). Status updates are typed by
 * the shared persistence contract and published on the neutral persistence
 * channel, so the direction of dependency stays Desktop → shared, never
 * Web → Desktop.
 */
export const DESKTOP_SYNC_STATUS_EVENT = PERSISTENCE_STATUS_EVENT;
export type DesktopSyncStatus = PersistenceStatus;

let previousSnapshot = '';
let failedSyncAttempts = 0;

type DesktopSyncStatusUpdate =
  | { state: 'syncing'; message: string }
  | { state: 'synced'; message: string }
  | { state: 'local-only'; message: string }
  | { state: 'error'; message: string; attempts: number };

let desktopSyncStatus: DesktopSyncStatus = {
  state: 'syncing',
  message: 'جاري تجهيز مزامنة سطح المكتب.',
  updatedAt: new Date().toISOString(),
};

function updateDesktopSyncStatus(status: DesktopSyncStatusUpdate): void {
  desktopSyncStatus = { ...status, updatedAt: new Date().toISOString() };
  window.dispatchEvent(new CustomEvent(DESKTOP_SYNC_STATUS_EVENT, { detail: desktopSyncStatus }));
}

export function getDesktopSyncStatus(): DesktopSyncStatus {
  return desktopSyncStatus;
}

function readMirror(): Record<string, string> {
  const entries: Record<string, string> = {};
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (!key?.startsWith(PREFIX)) continue;
    const value = window.localStorage.getItem(key);
    if (value !== null) entries[key] = value;
  }
  return entries;
}

function serialize(entries: Record<string, string>): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(entries).sort(([left], [right]) => left.localeCompare(right))),
  );
}

function applyMirror(entries: Record<string, string>): void {
  const keys: string[] = [];
  for (let index = 0; index < window.localStorage.length; index += 1) {
    const key = window.localStorage.key(index);
    if (key?.startsWith(PREFIX)) keys.push(key);
  }
  keys.forEach((key) => window.localStorage.removeItem(key));
  Object.entries(entries).forEach(([key, value]) => {
    if (key.startsWith(PREFIX)) window.localStorage.setItem(key, value);
  });
}

async function synchronizeDesktopMirror(): Promise<void> {
  const entries = readMirror();
  const serialized = serialize(entries);
  if (serialized === previousSnapshot) return;
  const invoke = await getDesktopInvoke();
  await invoke('save_desktop_snapshot', { entries });
  failedSyncAttempts = 0;
  previousSnapshot = serialized;
  updateDesktopSyncStatus({ state: 'synced', message: 'تمت مزامنة نسخة سطح المكتب.' });
}

async function bootstrapDesktopDatabase(): Promise<void> {
  try {
    const invoke = await getDesktopInvoke();
    const localEntries = readMirror();
    const desktopEntries = await invoke('load_desktop_snapshot') as Record<string, string> | null;
    if (desktopEntries && serialize(desktopEntries) !== serialize(localEntries)) {
      applyMirror(desktopEntries);
      window.location.reload();
      return;
    }
    if (!desktopEntries) await invoke('save_desktop_snapshot', { entries: localEntries } as Record<string, unknown>);
    previousSnapshot = serialize(readMirror());
    updateDesktopSyncStatus({ state: 'synced', message: 'مزامنة سطح المكتب تعمل.' });
    window.setInterval(() => {
      void synchronizeDesktopMirror().catch(() => {
        failedSyncAttempts += 1;
        updateDesktopSyncStatus({
          state: 'error',
          message: 'تعذر حفظ نسخة سطح المكتب. سيستمر التطبيق محلياً وسنحاول المزامنة مرة أخرى.',
          attempts: failedSyncAttempts,
        });
      });
    }, 500);
  } catch {
    updateDesktopSyncStatus({
      state: 'local-only',
      message: 'يعمل التطبيق بتخزين المتصفح المحلي فقط.',
    });
  }
}

void bootstrapDesktopDatabase();
