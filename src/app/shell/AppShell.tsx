import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { PersistenceErrorBoundary } from '../../components/shared/PersistenceErrorBoundary';
import { AppHeader } from './AppHeader';
import { DesktopNavigation } from './DesktopNavigation';
import { MobileMoreMenu } from './MobileMoreMenu';
import { MobileNavigation } from './MobileNavigation';
import { focusRing } from './navigation';
import { useDesktopPersistenceStatus } from './useDesktopPersistenceStatus';

export function AppShell() {
  const location = useLocation();
  const desktopSyncStatus = useDesktopPersistenceStatus();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const showDesktopSyncWarning =
    desktopSyncStatus.state === 'error' || desktopSyncStatus.state === 'browser-fallback';

  return (
    <div className="min-h-screen overflow-hidden bg-slate-50 text-slate-950" dir="rtl">
      <a
        href="#main-content"
        className={`fixed right-4 top-4 z-50 -translate-y-24 rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white shadow-lg transition focus:translate-y-0 ${focusRing}`}
      >
        الانتقال إلى المحتوى الرئيسي
      </a>

      <DesktopNavigation />

      <main id="main-content" className="relative min-h-screen w-full min-w-0 pb-[calc(6rem+env(safe-area-inset-bottom))] lg:pb-0 lg:pr-72">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-l from-amber-100/80 via-white/60 to-sky-100/70" />
        <AppHeader />

        <div className="relative mx-auto w-full min-w-0 max-w-7xl p-4 sm:p-6">
          {showDesktopSyncWarning && (
            <div role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
              {desktopSyncStatus.message}
            </div>
          )}
          <PersistenceErrorBoundary key={location.pathname}>
            <Outlet />
          </PersistenceErrorBoundary>
        </div>
      </main>

      <MobileNavigation onOpenMenu={() => setMobileMenuOpen(true)} />
      <MobileMoreMenu open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} />
    </div>
  );
}
