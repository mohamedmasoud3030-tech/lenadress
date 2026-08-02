import { Activity, CircleDollarSign, History, Wrench } from 'lucide-react';
import { formatMoneyOMR } from '../../shared/utils/format';
import type { DressPerformanceRow } from '../reports/report.types';
import { getDressLifecycleRecommendations } from './dressLifecycle.utils';

type DressLifecyclePanelProps = {
  performance: DressPerformanceRow;
};

const recommendationToneClasses = {
  positive: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  neutral: 'border-slate-200 bg-stone-50 text-slate-700',
} as const;

export function DressLifecyclePanel({ performance }: DressLifecyclePanelProps) {
  const recommendations = getDressLifecycleRecommendations(performance);
  const roi = performance.roiPercent === null ? 'غير متاح' : `${performance.roiPercent.toFixed(1)}%`;

  return (
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm" aria-labelledby="dress-lifecycle-title">
      <div>
        <p className="text-xs font-bold text-amber-700">دورة حياة العنصر</p>
        <h2 id="dress-lifecycle-title" className="mt-1 text-lg font-black text-slate-950">الأداء المحقق والقرار التشغيلي</h2>
        <p className="mt-1 text-sm leading-6 text-slate-500">هذه الأرقام مأخوذة مباشرة من سجل الإيجارات والمبيعات والمصروفات المرتبطة بالقطعة.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <div className="min-w-0 rounded-xl bg-stone-50 p-3">
          <CircleDollarSign aria-hidden="true" className="h-5 w-5 text-emerald-700" />
          <p className="mt-2 text-xs text-slate-500">إيراد الإيجار</p>
          <p className="mt-1 break-words text-sm font-black text-slate-950">{formatMoneyOMR(performance.rentalRevenue)}</p>
        </div>
        <div className="min-w-0 rounded-xl bg-stone-50 p-3">
          <Activity aria-hidden="true" className="h-5 w-5 text-violet-700" />
          <p className="mt-2 text-xs text-slate-500">إيراد البيع</p>
          <p className="mt-1 break-words text-sm font-black text-slate-950">{formatMoneyOMR(performance.salesRevenue)}</p>
        </div>
        <div className="min-w-0 rounded-xl bg-stone-50 p-3">
          <Wrench aria-hidden="true" className="h-5 w-5 text-amber-700" />
          <p className="mt-2 text-xs text-slate-500">المصروفات المرتبطة</p>
          <p className="mt-1 break-words text-sm font-black text-slate-950">{formatMoneyOMR(performance.relatedExpenses)}</p>
        </div>
        <div className="min-w-0 rounded-xl bg-stone-50 p-3">
          <History aria-hidden="true" className="h-5 w-5 text-slate-700" />
          <p className="mt-2 text-xs text-slate-500">العائد على التكلفة</p>
          <p className="mt-1 break-words text-sm font-black text-slate-950" dir="ltr">{roi}</p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 p-3">
          <p className="text-xs text-slate-500">النتيجة بعد الشراء والمصروفات</p>
          <p className={`mt-1 text-base font-black ${performance.netResult >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
            {formatMoneyOMR(performance.netResult)}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 p-3">
          <p className="text-xs text-slate-500">آخر حركة</p>
          <p className="mt-1 text-sm font-bold text-slate-900">{performance.lastMovementDate || 'لا توجد حركة مسجلة'}</p>
        </div>
        <div className="rounded-xl border border-slate-200 p-3">
          <p className="text-xs text-slate-500">عدد مرات التأجير المكتملة</p>
          <p className="mt-1 text-base font-black text-slate-950">{performance.timesRented}</p>
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-black text-slate-900">توصيات المتابعة</h3>
        {recommendations.map((recommendation) => (
          <p
            key={recommendation.message}
            className={`rounded-xl border px-3 py-2 text-sm leading-6 ${recommendationToneClasses[recommendation.tone]}`}
          >
            {recommendation.message}
          </p>
        ))}
      </div>
    </section>
  );
}
