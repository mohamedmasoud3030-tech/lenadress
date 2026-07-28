import { useMemo, useState } from 'react';
import { DRESS_STATUS_LABELS } from '../../shared/domain/dressConstants';
import {
  formatReportMoney,
  getCustomerBalances,
  getDressPerformance,
  getFinancialSummary,
  getReportSummary,
  getTodayReport,
} from './report.service';
import type { DateRangeFilter } from './report.types';

export function ReportsPage() {
  const [range, setRange] = useState<DateRangeFilter>({ from: '', to: '' });
  const [appliedRange, setAppliedRange] = useState<DateRangeFilter>({ from: '', to: '' });
  const [feedback, setFeedback] = useState<string | null>(null);

  const summary = useMemo(() => getReportSummary(appliedRange), [appliedRange]);
  const today = useMemo(() => getTodayReport(), []);
  const dressPerformance = useMemo(() => getDressPerformance(), []);
  const customerBalances = useMemo(() => getCustomerBalances(), []);
  const financial = useMemo(() => getFinancialSummary(appliedRange), [appliedRange]);
  const dressesRequiringReview = useMemo(
    () => dressPerformance.filter((dress) => dress.requiresReview).length,
    [dressPerformance],
  );

  const applyRange = () => {
    if (range.from && range.to && range.from > range.to) {
      setFeedback('تاريخ البداية يجب ألا يكون بعد تاريخ النهاية.');
      return;
    }

    setAppliedRange(range);
    setFeedback(range.from || range.to ? 'تم تطبيق الفترة على الملخص المالي.' : 'تم عرض جميع الفترات المالية.');
  };

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">التقارير التشغيلية والمالية</h1>
        <p className="mt-2 text-slate-600">نظرة موحدة على الإيرادات والمصروفات وأداء دورة حياة الفساتين اعتماداً على بيانات النظام المحلية.</p>
      </div>

      {feedback && <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">{feedback}</div>}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">إجمالي الفساتين</p><p className="mt-2 text-2xl font-bold">{summary.totalDresses}</p></article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">الحجوزات النشطة</p><p className="mt-2 text-2xl font-bold">{summary.activeReservations}</p></article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">إجمالي التحصيل</p><p className="mt-2 text-2xl font-bold">{formatReportMoney(summary.totalCollected)}</p></article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">فساتين تحتاج مراجعة</p><p className="mt-2 text-2xl font-bold text-amber-700">{dressesRequiringReview}</p></article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">إجمالي المصروفات</p><p className="mt-2 text-2xl font-bold">{formatReportMoney(summary.totalExpenses)}</p></article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">صافي حركة النقد</p><p className="mt-2 text-2xl font-bold">{formatReportMoney(summary.netAmount)}</p></article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">عميلات عليهن رصيد</p><p className="mt-2 text-2xl font-bold">{summary.customersWithBalance}</p></article>
      </div>

      <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold">فلتر الفترة المالية</h2>
        <p className="mt-1 text-sm text-slate-500">يؤثر على التحصيل والمصروفات والصافي فقط، بينما تظل مؤشرات التشغيل الحالية كما هي.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <input type="date" value={range.from} onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))} className="min-h-11 rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30" />
          <input type="date" value={range.to} onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))} className="min-h-11 rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/30" />
          <button type="button" onClick={applyRange} className="min-h-11 rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2">تطبيق الفترة</button>
        </div>
      </article>

      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">تقرير اليوم ({today.date})</h2>
        <div className="mt-4 grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-4">
          <p>استلامات اليوم: <span className="font-bold">{today.pickupsToday}</span></p>
          <p>مرتجعات اليوم: <span className="font-bold">{today.returnsToday}</span></p>
          <p>مدفوعات اليوم: <span className="font-bold">{formatReportMoney(today.paymentsToday)}</span></p>
          <p>مصروفات اليوم: <span className="font-bold">{formatReportMoney(today.expensesToday)}</span></p>
        </div>
      </article>

      <div className="grid gap-4 xl:grid-cols-2">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">أداء دورة حياة الفساتين</h2>
          {dressPerformance.length === 0 ? <p className="mt-3 text-sm text-slate-500">لا توجد بيانات أداء حالياً.</p> : (
            <div className="mt-3 space-y-3 text-sm">
              {dressPerformance.slice(0, 8).map((dress) => (
                <div key={dress.id} className="rounded-xl bg-slate-50 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">{dress.code} - {dress.name}</p>
                      <p className="mt-1 text-xs text-slate-500">{dress.timesRented} تأجيرات | {DRESS_STATUS_LABELS[dress.status]}</p>
                    </div>
                    {dress.requiresReview && <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-800">يحتاج مراجعة</span>}
                  </div>
                  <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2 xl:grid-cols-3">
                    <p>إيراد التأجير: <span className="font-bold">{formatReportMoney(dress.rentalRevenue)}</span></p>
                    <p>إيراد البيع: <span className="font-bold">{formatReportMoney(dress.salesRevenue)}</span></p>
                    <p>مصروفات مرتبطة: <span className="font-bold">{formatReportMoney(dress.relatedExpenses)}</span></p>
                    <p>إجمالي الإيراد: <span className="font-bold">{formatReportMoney(dress.totalRevenue)}</span></p>
                    <p>النتيجة الصافية: <span className="font-bold">{formatReportMoney(dress.netResult)}</span></p>
                    <p>أيام بدون حركة: <span className="font-bold">{dress.inactivityDays ?? 'غير متاح'}</span></p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-semibold">أرصدة العميلات</h2>
          {customerBalances.length === 0 ? <p className="mt-3 text-sm text-slate-500">لا توجد عميلات عليهن رصيد.</p> : (
            <div className="mt-3 space-y-2 text-sm">{customerBalances.map((customer) => <div key={customer.id} className="flex items-center justify-between rounded-xl bg-slate-50 p-3"><p>{customer.name} - {customer.phone}</p><p className="font-semibold text-rose-700">{formatReportMoney(customer.remainingBalance)}</p></div>)}</div>
          )}
        </article>
      </div>

      <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-lg font-semibold">الملخص المالي</h2>
        <div className="mt-4 grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-3">
          <p>إيرادات التأجير: <span className="font-bold">{formatReportMoney(financial.rentalCollected)}</span></p>
          <p>إيرادات المبيعات: <span className="font-bold">{formatReportMoney(financial.salesCollected)}</span></p>
          <p>إجمالي التحصيل: <span className="font-bold">{formatReportMoney(financial.totalCollected)}</span></p>
          <p>الاسترجاعات: <span className="font-bold">{formatReportMoney(financial.totalRefunded)}</span></p>
          <p>المصروفات: <span className="font-bold">{formatReportMoney(financial.totalExpenses)}</span></p>
          <p>الرسوم المحصلة: <span className="font-bold">{formatReportMoney(financial.feesCollected)}</span></p>
          <p>عربون محتجز (دخل): <span className="font-bold">{formatReportMoney(financial.depositRetained)}</span></p>
          <p>عربون مستحق الرد (التزام): <span className="font-bold">{formatReportMoney(financial.depositLiabilityCollected)}</span></p>
          <p>صافي حركة النقد: <span className="font-bold">{formatReportMoney(financial.netAmount)}</span></p>
          <p>الدخل المعترف به: <span className="font-bold">{formatReportMoney(financial.recognisedIncome)}</span></p>
        </div>
        <p className="mt-3 rounded-xl bg-stone-50 p-3 text-xs text-slate-600">
          العربون القابل للرد ليس إيراداً؛ يبقى التزاماً على المعرض حتى يُرد أو يُحتجز صراحة. المبلغ المحصل ليس ربحاً؛ الدخل المعترف به يستثني العربون المستحق الرد ويخصم المصروفات.
        </p>
      </article>
    </section>
  );
}
