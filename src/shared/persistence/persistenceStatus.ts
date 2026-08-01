// Shared persistence status types and helpers for web-safe behavior.
export type PersistenceStatus =
  | { state: 'idle'; message: string; updatedAt: string }
  | { state: 'synced'; message: string; updatedAt: string }
  | { state: 'offline'; message: string; updatedAt: string }
  | { state: 'error'; message: string; updatedAt: string; attempts: number };

export const PERSISTENCE_SYNC_STATUS_EVENT = 'dress-roomshow:desktop-sync-status';

export function defaultBrowserPersistenceStatus(): PersistenceStatus {
  return {
    state: 'offline',
    message: 'البيانات المحلية متاحة مؤقتًا، والمزامنة السحابية قيد الانتقال.',
    updatedAt: new Date().toISOString(),
  };
}
