import { AppRoutes } from '@app/router/AppRoutes';

/**
 * Desktop/Tauri bootstrap has been intentionally removed from the web
 * application entry point so that Web App + PWA builds do not load
 * desktop/Tauri runtime at startup.
 *
 * Desktop integration remains available under src/platform/desktop and
 * can be re-enabled behind a feature flag or a separate desktop-only
 * bootstrap if needed; it is not part of the default web build.
 */
export function App() {
  return <AppRoutes />;
}
