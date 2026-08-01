import { useEffect, useState } from 'react';

/**
 * Web-safe desktop persistence status hook.
 *
 * The Web build must not import the Tauri/Desktop runtime. Instead of
 * pulling the desktop bootstrap, the web app reads a window-scoped
 * fallback status and listens to the same event name used by the
 * desktop implementation if present. This keeps UI behavior consistent
 * while avoiding a build-time import of src/platform/desktop.
 */
export type DesktopSyncStatus =
  | { state: 'idle'; message: string; updatedAt: string }
  | { state: 'synced'; message: string; updatedAt: string }
  | { state: 'browser-fallback'; message: string; updatedAt: string }
  | { state: 'error'; message: string; updatedAt: string; attempts: number };

const DESKTOP_SYNC_STATUS_EVENT = 'dress-roomshow:desktop-sync-status';

function getWindowDesktopSyncStatus(): DesktopSyncStatus {
  // If the desktop bundle has run it will have defined a global getter.
  // Otherwise return a benign web-only default.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const globalAny = (globalThis as any) || {};
  if (typeof globalAny.getDesktopSyncStatus === 'function') {
    try {
      return globalAny.getDesktopSyncStatus();
    } catch {
      // fallthrough to default
    }
  }
  return { state: 'browser-fallback', message: 'التخزين المحلي مفعل. مزامنة سطح المكتب غير متوفرة.', updatedAt: new Date().toISOString() };
}

export function useDesktopPersistenceStatus(): DesktopSyncStatus {
  const [status, setStatus] = useState<DesktopSyncStatus>(() => getWindowDesktopSyncStatus());

  useEffect(() => {
    const updateStatus = (event: Event) => {
      setStatus((event as CustomEvent<DesktopSyncStatus>).detail);
    };

    window.addEventListener(DESKTOP_SYNC_STATUS_EVENT, updateStatus);
    return () => window.removeEventListener(DESKTOP_SYNC_STATUS_EVENT, updateStatus);
  }, []);

  return status;
}
