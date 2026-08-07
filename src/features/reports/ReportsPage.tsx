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
import { getReservationsNeedingFinancialClassification } from '../reservations/reservation.service';
import { PageHeader } from '../../components/shared/PageHeader';
import { Section } from '../../components/shared/Section';
import { SummaryCard } from '../../components/shared/SummaryCard';
import { EmptyState } from '../../components/shared/StateViews';
import { getControlClassName } from '../../components/shared/FormField';
import { AMBER_FOCUS_RING_CLASS_NAME } from '../../shared/domain/formConstants';

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
  const needsClassification = useMemo(() => getReservationsNeedingFinancialClassification(), [appliedRange, today]);

  const applyRange = () => {
    if (range.from && range.to && range.from > range.to) {
      setFeedback('تاريخ البداية يجب ألا يكون بعد تاريخ النهاية.');
      return;
    }

    setAppliedRange(range);
    setFeedback(range.from || range.to ? 'تم تطبيق الفترة على الملخص المالي.' : 'تم عرض جميع الفترات المالية.');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="التقارير"
        title="التقارير التشغيلية والمالية"
        description="نظرة موحدة على الإيرادات والمصروفات وأداء دورة حياة الفساتين مع فصل دفعة الحجز عن التأمين المسترد."
      />

      {feedback && (
        <div role="status" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
          {feedback}
        </div>
      )}

      {needsClassification.length > 0 && (
        <div role="alert" className="rounded-2xl border border-rose-300 bg-rose-50 p-4 shadow-sm">
          <p className="text-sm font-extrabold text-rose-900">سجلات تحتاج مراجعة مالية — تصنيف العربون</p>
          <p className="mt-1 text-xs leading-6 text-rose-800">
            يوجد {needsClassification.length} حجز قديم يحتوي على مبلغ عربون غامض (depositAmount) بدون دليل تسوية. تم حفظ القيمة الأصلية كـ legacyDepositAmount وتم وضع علامة needsFinancialClassification. لا يُسمح بالتسوية التلقائية حتى المراجعة.
          </p>
          <div className="mt-3 space-y-2 text-xs">
            {needsClassification.slice(0, 10).map((r) => (
              <div key={r.id} className="flex flex-wrap justify-between gap-2 rounded-xl bg-white/80 px-3 py-2">
                <span className="font-bold text-slate-800">{r.reservationNumber} — {r.customerName} — {r.dressCode}</span>
                <span className="text-slate-600">الأصل: {r.legacyDepositAmount} ر.ع — {r.classificationReason}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <SummaryCard label="إجمالي الفساتين" value={summary.totalDresses} />
        <SummaryCard label="الحجوزات النشطة" value={summary.activeReservations} />
        <SummaryCard label="إجمالي التحصيل النقدي" value={formatReportMoney(summary.totalCollected)} tone="positive" />
        <SummaryCard label="فساتين تحتاج مراجعة" value={dressesRequiringReview} tone={dressesRequiringReview > 0 ? 'warning' : 'default'} />
        <SummaryCard label="إجمالي المصروفات" value={formatReportMoney(summary.totalExpenses)} tone="warning" />
        <SummaryCard label="صافي حركة النقد" value={formatReportMoney(summary.netAmount)} tone={summary.netAmount < 0 ? 'danger' : 'default'} />
        <SummaryCard label="عميلات عليهن رصيد إيجار" value={summary.customersWithBalance} tone={summary.customersWithBalance > 0 ? 'accent' : 'default'} />
        <SummaryCard label="حجوزات تحتاج تصنيف مالي" value={needsClassification.length} tone={needsClassification.length > 0 ? 'danger' : 'default'} />
      </div>

      <Section
        title="فلتر الفترة المالية"
        description="يؤثر على التحصيل والمصروفات والصافي فقط، بينما تظل مؤشرات التشغيل الحالية كما هي."
        action={
          <button
            type="button"
            onClick={applyRange}
            className={`inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800 ${AMBER_FOCUS_RING_CLASS_NAME}`}
          >
            تطبيق الفترة
          </button>
        }
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-slate-600">من</span>
            <input type="date" value={range.from} onChange={(event) => setRange((current) => ({ ...current, from: event.target.value }))} className={getControlClassName()} />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-bold text-slate-600">إلى</span>
            <input type="date" value={range.to} onChange={(event) => setRange((current) => ({ ...current, to: event.target.value }))} className={getControlClassName()} />
          </label>
        </div>
      </Section>

      <Section title={`تقرير اليوم (${today.date})`}>
        <div className="grid grid-cols-2 gap-3 text-sm xl:grid-cols-4">
          <div className="rounded-xl bg-stone-50 p-3">
            <p className="text-xs text-slate-500">استلامات اليوم</p>
            <p className="mt-1 text-lg font-extrabold text-slate-950">{today.pickupsToday}</p>
          </div>
          <div className="rounded-xl bg-stone-50 p-3">
            <p className="text-xs text-slate-500">مرتجعات اليوم</p>
            <p className="mt-1 text-lg font-extrabold text-slate-950">{today.returnsToday}</p>
          </div>
          <div className="rounded-xl bg-stone-50 p-3">
            <p className="text-xs text-slate-500">مدفوعات اليوم</p>
            <p className="mt-1 text-lg font-extrabold text-emerald-700">{formatReportMoney(today.paymentsToday)}</p>
          </div>
          <div className="rounded-xl bg-stone-50 p-3">
            <p className="text-xs text-slate-500">مصروفات اليوم</p>
            <p className="mt-1 text-lg font-extrabold text-amber-700">{formatReportMoney(today.expensesToday)}</p>
          </div>
        </div>
      </Section>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section title="أداء دورة حياة الفساتين">
          {dressPerformance.length === 0 ? (
            <EmptyState title="لا توجد بيانات أداء حالياً" description="ستظهر مؤشرات الأداء تلقائياً بعد أول حجز وتسليم." />
          ) : (
            <div className="space-y-3 text-sm">
              {dressPerformance.slice(0, 8).map((dress) => (
                <div key={dress.id} className="rounded-xl bg-stone-50 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-slate-900">{dress.code} - {dress.name}</p>
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
        </Section>

        <Section title="أرصدة العميلات - المتبقي من الإيجار">
          {customerBalances.length === 0 ? (
            <EmptyState title="لا توجد عميلات عليهن رصيد" description="كل الأرصدة مسددة بالكامل." />
          ) : (
            <div className="space-y-2 text-sm">
              {customerBalances.map((customer) => (
                <div key={customer.id} className="flex items-center justify-between rounded-xl bg-stone-50 p-3">
                  <p className="font-bold text-slate-800">{customer.name} - {customer.phone}</p>
                  <p className="font-extrabold text-rose-700">{formatReportMoney(customer.remainingBalance)}</p>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>

      <Section title="الملخص المالي — فصل دفعة الحجز عن التأمين المسترد">
        <div className="grid gap-3 text-sm md:grid-cols-2 xl:grid-cols-3">
          <p>إيرادات التأجير (دفعات إيجار): <span className="font-bold">{formatReportMoney(financial.rentalCollected)}</span></p>
          <p>دفعة الحجز (مقدم إيجار): <span className="font-bold">{formatReportMoney(financial.bookingAdvanceCollected ?? 0)}</span></p>
          <p>إيرادات المبيعات: <span className="font-bold">{formatReportMoney(financial.salesCollected)}</span></p>
          <p>إجمالي التحصيل النقدي (إيجار + دفعة حجز + تأمين + مبيعات): <span className="font-bold">{formatReportMoney(financial.totalCollected)}</span></p>
          <p>التأمين المسترد المحصل (التزام): <span className="font-bold">{formatReportMoney(financial.securityDepositCollected ?? 0)}</span></p>
          <p>التأمين المسترد المردود للعميلة: <span className="font-bold">{formatReportMoney(financial.securityDepositRefunded ?? 0)}</span></p>
          <p>التأمين المحتجز (دخل من احتجاز): <span className="font-bold">{formatReportMoney(financial.depositRetained)}</span></p>
          <p>التأمين المسترد المتبقي (التزام مستحق): <span className="font-bold">{formatReportMoney(financial.depositLiabilityCollected)}</span></p>
          <p>الاسترجاعات النقدية: <span className="font-bold">{formatReportMoney(financial.totalRefunded)}</span></p>
          <p>المصروفات: <span className="font-bold">{formatReportMoney(financial.totalExpenses)}</span></p>
          <p>الرسوم المحصلة (تأخير + ضرر + محتجز): <span className="font-bold">{formatReportMoney(financial.feesCollected)}</span></p>
          <p>صافي حركة النقد: <span className="font-bold">{formatReportMoney(financial.netAmount)}</span></p>
          <p>الدخل المعترف به (إيجار + دفعة حجز + مبيعات + رسوم + محتجز، بدون التأمين المستحق): <span className="font-bold">{formatReportMoney(financial.recognisedIncome)}</span></p>
        </div>
        <div className="mt-3 space-y-2 rounded-xl bg-stone-50 p-3 text-xs text-slate-600">
          <p>• دفعة الحجز (دفعة الحجز): مبلغ مقدم من قيمة الإيجار، يقلل المتبقي من الإيجار مرة واحدة، لا ينشئ التزاماً قابلاً للرد، ولا يدخل في تسوية التأمين.</p>
          <p>• التأمين المسترد (التأمين المسترد): مبلغ تأمين قابل للرد، يبقى التزاماً على المعرض حتى يُرد أو يُحتجز بمبرر صريح (تلف/تأخير/فقد).</p>
          <p>• تحصيل التأمين يزيد النقد والالتزام، لا الإيراد. استرداده يقلل النقد والالتزام. احتجازه يقلل الالتزام ويسجل الرسم المرتبط.</p>
          <p>• المبلغ المحصل ليس ربحاً؛ الدخل المعترف به يستثني التأمين المستحق الرد ويخصم المصروفات.</p>
        </div>
      </Section>
    </div>
  );
}
