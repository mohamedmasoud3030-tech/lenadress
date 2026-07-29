import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { applyPendingUpdate, subscribeToAppUpdates } from '@platform/app-update';
import { AMBER_FOCUS_RING_CLASS_NAME } from '../../shared/domain/formConstants';

/**
 * "A new version is ready" banner.
 *
 * It is deliberately dismissible and never auto-reloads. The whole reason the
 * registration was changed from `autoUpdate` to `prompt` is that the operator,
 * not the browser, decides when it is safe to lose the current screen — and a
 * banner that reloads on its own after being ignored would reintroduce exactly
 * that problem.
 *
 * Positioned above the mobile bottom navigation so it never covers the tab bar,
 * which is the one control the operator needs to escape any screen.
 */
export function AppUpdateNotice() {
  const [available, setAvailable] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [applying, setApplying] = useState(false);

  useEffect(() => subscribeToAppUpdates((next) => {
    setAvailable(next);
    // A newly detected update un-dismisses: a second update after the operator
    // waved the first one away is still worth telling her about.
    if (next) setDismissed(false);
  }), []);

  if (!available || dismissed) return null;

  const handleApply = () => {
    setApplying(true);
    void applyPendingUpdate();
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom,0px)+5.5rem)] z-40 mx-auto max-w-md rounded-2xl border border-amber-300 bg-amber-50 p-3 shadow-lg lg:bottom-6 lg:right-6 lg:left-auto lg:mx-0"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-bold text-amber-900">يتوفر إصدار جديد من التطبيق</p>
          <p className="mt-0.5 text-xs leading-5 text-amber-800">
            سيتم التحديث عند اختيارك فقط، حتى لا تفقدي أي بيانات مفتوحة الآن.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={handleApply}
            disabled={applying}
            className={`inline-flex min-h-11 items-center gap-2 rounded-xl bg-amber-600 px-3 text-sm font-bold text-white transition hover:bg-amber-700 disabled:opacity-60 ${AMBER_FOCUS_RING_CLASS_NAME}`}
          >
            <RefreshCw aria-hidden="true" className={`h-4 w-4 ${applying ? 'animate-spin' : ''}`} />
            {applying ? 'جارٍ التحديث…' : 'تحديث الآن'}
          </button>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className={`inline-flex min-h-11 items-center rounded-xl border border-amber-300 bg-white px-3 text-sm font-bold text-amber-900 transition hover:bg-amber-100 ${AMBER_FOCUS_RING_CLASS_NAME}`}
          >
            لاحقاً
          </button>
        </div>
      </div>
    </div>
  );
}
