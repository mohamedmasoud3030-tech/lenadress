import { AppRoutes } from '@app/router/AppRoutes';
import { AppUpdateNotice } from '../components/shared/AppUpdateNotice';

/**
 * Official runtime entry: Web App + PWA backed by Supabase.
 *
 * The legacy native bootstrap is intentionally not part of this entry
 * point. It stays quarantined under `src/platform/` for historical
 * recovery only and is excluded from the official build. No storage is
 * read, migrated, or deleted here.
 *
 * See docs/adr/0001-web-pwa-supabase-only.md.
 */
export function App() {
  return (
    <>
      <AppRoutes />
      <AppUpdateNotice />
    </>
  );
}
