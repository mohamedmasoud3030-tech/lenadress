/**
 * Shared, platform-neutral persistence status contract for the official
 * Web App + PWA runtime.
 *
 * This module is the single source of truth for how the interface talks
 * about where operational data lives. It deliberately contains only types,
 * constants, and pure helpers — no platform adapters, no UI framework, no
 * backend client, and no application services. Official Web/PWA code and
 * temporarily retained native islands alike may publish or consume these
 * statuses, but Web code never imports runtime-specific modules to do so.
 *
 * See docs/adr/0001-web-pwa-supabase-only.md for the release architecture
 * decision behind this contract.
 */

/**
 * - `local-only`: retained only for the quarantined legacy native adapter.
 * - `syncing`: a synchronization attempt is currently in progress.
 * - `synced`: local data and the remote store are known to match.
 * - `offline`: the browser reports no connectivity; operational writes are blocked.
 * - `error`: a persistence or synchronization attempt failed.
 *
 * `syncing`/`synced` must only be published by code that actually performs
 * synchronization.
 */
export type PersistenceStatus =
  | { state: 'local-only'; message: string; updatedAt: string }
  | { state: 'syncing'; message: string; updatedAt: string }
  | { state: 'synced'; message: string; updatedAt: string }
  | { state: 'offline'; message: string; updatedAt: string }
  | { state: 'error'; message: string; updatedAt: string; attempts: number };

export type PersistenceStatusState = PersistenceStatus['state'];

/**
 * Neutral event name for persistence status updates. It carries no runtime
 * branding so Web, PWA, and temporarily retained native builds can share
 * one channel without the official Web runtime depending on vendor naming.
 */
export const PERSISTENCE_STATUS_EVENT = 'lena:persistence-status';

export const LOCAL_ONLY_PERSISTENCE_MESSAGE =
  'البيانات المحلية متاحة مؤقتًا، وجارٍ الانتقال إلى المزامنة السحابية.';

/**
 * Default status for the official Web/PWA runtime during the current
 * transition period: operational data is local to the browser, and the
 * move to centrally hosted cloud synchronization is in progress.
 */
export function createDefaultPersistenceStatus(): PersistenceStatus {
  return {
    state: 'syncing',
    message: 'جارٍ التحقق من اتصال قاعدة بيانات المعرض…',
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Structural guard for event payloads so consumers never have to trust an
 * untyped `CustomEvent.detail`.
 */
export function isPersistenceStatus(value: unknown): value is PersistenceStatus {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.message !== 'string' || typeof candidate.updatedAt !== 'string') {
    return false;
  }
  switch (candidate.state) {
    case 'local-only':
    case 'syncing':
    case 'synced':
    case 'offline':
      return true;
    case 'error':
      return typeof candidate.attempts === 'number';
    default:
      return false;
  }
}
