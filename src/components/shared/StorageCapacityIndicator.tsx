import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, HardDrive, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  formatStorageBytes,
  getStorageCapacityEstimate,
  type StorageCapacityEstimate,
} from '@platform/storage';

type StorageCapacityIndicatorProps = {
  compact?: boolean;
};

function statusCopy(estimate: StorageCapacityEstimate): string {
  if (estimate.status === 'critical') return 'مساحة التخزين أوشكت على الامتلاء. صدّري نسخة احتياطية واحذفي ما لا يلزم من الصور قبل متابعة العمل.';
  if (estimate.status === 'warning') return 'مساحة التخزين تقترب من الامتلاء. جهّزي نسخة احتياطية وراجعي الصور قبل أن يتعذر الحفظ.';
  return 'مساحة التخزين متاحة للحفظ الحالي.';
}

/** Visible capacity feedback so browser quota is not first discovered on a failed write. */
export function StorageCapacityIndicator({ compact = false }: StorageCapacityIndicatorProps) {
  const [estimate, setEstimate] = useState<StorageCapacityEstimate | null | undefined>(undefined);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      setEstimate(await getStorageCapacityEstimate());
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  if (estimate === undefined) return null;
  if (compact && (!estimate || estimate.status === 'healthy')) return null;

  const tone = estimate?.status === 'critical'
    ? 'border-rose-200 bg-rose-50 text-rose-900'
    : estimate?.status === 'warning'
      ? 'border-amber-200 bg-amber-50 text-amber-900'
      : 'border-emerald-200 bg-emerald-50 text-emerald-900';

  return (
    <section className={`rounded-xl border px-4 py-3 ${tone}`} aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          {estimate?.status === 'healthy' ? <HardDrive aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" /> : <AlertTriangle aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0" />}
          <div>
            <p className="text-sm font-bold">{estimate ? `التخزين المستخدم: ${estimate.usedPercent}%` : 'تعذر قراءة سعة التخزين'}</p>
            <p className="mt-1 text-xs leading-5">{estimate ? `${formatStorageBytes(estimate.usageBytes)} من ${formatStorageBytes(estimate.quotaBytes)} — ${statusCopy(estimate)}` : 'لا يدعم هذا المتصفح تقدير السعة. استمري في حفظ نسخة احتياطية دورية.'}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {compact && <Link to="/preferences" className="inline-flex min-h-10 items-center rounded-lg border border-current/30 px-3 py-2 text-xs font-bold hover:bg-white/40">إدارة التخزين</Link>}
          <button type="button" onClick={() => void refresh()} disabled={isRefreshing} aria-label="تحديث سعة التخزين" className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-current/30 hover:bg-white/40 disabled:cursor-not-allowed disabled:opacity-60">
            <RefreshCw aria-hidden="true" className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>
    </section>
  );
}
