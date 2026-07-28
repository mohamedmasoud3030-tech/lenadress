import type { PerformancePeriodPoint } from './inventoryPerformance.types';
import { formatMoneyOMR } from '../../shared/utils/format';

/**
 * Minimal revenue/cost trend.
 *
 * Deliberately a plain SVG bar pair rather than a charting dependency: the
 * report only needs to answer "is this getting better or worse", and an inline
 * chart keeps the offline bundle small and prints predictably.
 */
export function PerformanceTrendChart({ points }: { points: PerformancePeriodPoint[] }) {
  if (points.length === 0) {
    return <p className="text-sm text-slate-500">لا توجد حركة في هذه الفترة لعرض اتجاه زمني.</p>;
  }

  const max = Math.max(...points.map((point) => Math.max(point.revenue, point.cost)), 1);

  return (
    <div className="overflow-x-auto">
      <ul className="flex min-w-full items-end gap-3" role="list">
        {points.map((point) => {
          const revenueHeight = Math.max((point.revenue / max) * 100, point.revenue > 0 ? 4 : 0);
          const costHeight = Math.max((point.cost / max) * 100, point.cost > 0 ? 4 : 0);
          return (
            <li key={point.period} className="flex min-w-16 flex-1 flex-col items-center gap-2">
              <div className="flex h-32 w-full items-end justify-center gap-1" aria-hidden="true">
                <div className="w-1/3 rounded-t bg-emerald-500/80" style={{ height: `${revenueHeight}%` }} />
                <div className="w-1/3 rounded-t bg-rose-400/80" style={{ height: `${costHeight}%` }} />
              </div>
              <p className="text-center text-[11px] font-bold text-slate-600">{point.label}</p>
              <p className="sr-only">
                {point.label}: إيراد {formatMoneyOMR(point.revenue)}، تكلفة {formatMoneyOMR(point.cost)}، صافي {formatMoneyOMR(point.netResult)}
              </p>
            </li>
          );
        })}
      </ul>
      <div className="mt-3 flex flex-wrap gap-4 text-xs font-bold text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-emerald-500/80" />
          الإيراد
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-rose-400/80" />
          التكاليف
        </span>
      </div>
    </div>
  );
}
