import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download, Printer } from 'lucide-react';
import { PageHeader } from '../../components/shared/PageHeader';
import { SummaryCard } from '../../components/shared/SummaryCard';
import { EmptyState } from '../../components/shared/StateViews';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';
import { ACCESSORY_CATEGORY_LABELS, ACCESSORY_CATEGORY_OPTIONS, ACCESSORY_STATUS_LABELS } from '../../shared/domain/accessoryConstants';
import { DRESS_CATEGORIES, DRESS_STATUS_LABELS, DRESS_STATUS_OPTIONS } from '../../shared/domain/dressConstants';
import { AMBER_FOCUS_RING_CLASS_NAME } from '../../shared/domain/formConstants';
import { downloadCsv } from '@platform/download';
import { toCsvFileName } from '../../shared/utils/csv';
import { getTodayISO } from '../../shared/utils/date';
import { formatMoneyOMR } from '../../shared/utils/format';
import { InventoryPerformanceDetailPanel } from './InventoryPerformanceDetailPanel';
import { PerformanceTrendChart } from './PerformanceTrendChart';
import {
  PERFORMANCE_GRANULARITY_LABELS,
  PERFORMANCE_SORT_LABELS,
  buildInventoryPerformanceReport,
  getDefaultPerformanceFilters,
  getInventoryPerformanceDetail,
} from './inventoryPerformance.service';
import {
  buildInventoryPerformanceCsv,
  printInventoryPerformanceReport,
} from './inventoryPerformanceExport';
import type {
  InventoryPerformanceDetail,
  InventoryPerformanceFilters,
  InventoryPerformanceRow,
  PerformanceSortKey,
} from './inventoryPerformance.types';

const fieldClassName =
  'min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none transition focus-visible:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500/30';

const SORT_KEYS: PerformanceSortKey[] = ['revenue', 'netResult', 'rentalCount', 'utilisationRate', 'idleDays', 'serviceCost'];

const KIND_LABELS = { dress: 'فستان', accessory: 'ملحق' } as const;

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function RowList({ title, description, rows, emptyText, onOpen }: {
  title: string;
  description: string;
  rows: InventoryPerformanceRow[];
  emptyText: string;
  onOpen: (row: InventoryPerformanceRow) => void;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-base font-bold text-slate-950">{title}</h2>
      <p className="mt-1 text-xs text-slate-500">{description}</p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{emptyText}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => onOpen(row)}
                aria-label={`فتح تفاصيل أداء ${row.code}`}
                className={`flex w-full items-center justify-between gap-2 rounded-xl bg-stone-50 p-3 text-right transition hover:bg-stone-100 ${AMBER_FOCUS_RING_CLASS_NAME}`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold text-slate-900">{row.code} — {row.name}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {KIND_LABELS[row.kind]} · إشغال {percent(row.utilisationRate)} · {row.rentalCount} تأجير
                  </span>
                </span>
                <span className={`shrink-0 text-sm font-extrabold ${row.netResult < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                  {formatMoneyOMR(row.netResult)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

export function InventoryPerformancePage() {
  const [filters, setFilters] = useState<InventoryPerformanceFilters>(() => getDefaultPerformanceFilters());
  const [detail, setDetail] = useState<InventoryPerformanceDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const report = useMemo(() => {
    try {
      const built = buildInventoryPerformanceReport(filters);
      setError(null);
      return built;
    } catch (reason: unknown) {
      setError(reason);
      return null;
    }
  }, [filters]);

  const update = <Key extends keyof InventoryPerformanceFilters>(key: Key, value: InventoryPerformanceFilters[Key]) => {
    setFeedback(null);
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const toggleSort = (key: PerformanceSortKey) => {
    setFilters((current) => ({
      ...current,
      sortBy: key,
      sortDirection: current.sortBy === key && current.sortDirection === 'desc' ? 'asc' : 'desc',
    }));
  };

  const openDetail = (row: InventoryPerformanceRow) => {
    setDetail(getInventoryPerformanceDetail(row.id, filters));
  };

  const exportCsv = () => {
    if (!report) return;
    // The BOM is inside the string; the shared helper must not re-encode it.
    downloadCsv(toCsvFileName('تقرير-أداء-المخزون', getTodayISO()), buildInventoryPerformanceCsv(report));
    setFeedback('تم تجهيز ملف CSV للتحميل بترميز يدعم العربية.');
  };

  const printReport = () => {
    if (!report) return;
    try {
      printInventoryPerformanceReport(report);
      setFeedback(null);
    } catch (reason: unknown) {
      setError(reason);
    }
  };

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <PageHeader
          eyebrow="التقارير"
          title="أداء المخزون والربحية"
          description="ما الأكثر طلباً، ما الراكد، ما الذي يحقق ربحاً فعلياً، وما الذي يستهلك صيانة أكثر من عائده — من بيانات العمليات نفسها."
        />
        <div className="no-print flex flex-wrap gap-3">
          <button
            type="button"
            onClick={exportCsv}
            disabled={!report}
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-800 shadow-sm transition hover:bg-stone-100 disabled:opacity-50 ${AMBER_FOCUS_RING_CLASS_NAME}`}
          >
            <Download aria-hidden="true" className="h-5 w-5" />
            تصدير CSV
          </button>
          <button
            type="button"
            onClick={printReport}
            disabled={!report}
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50 ${AMBER_FOCUS_RING_CLASS_NAME}`}
          >
            <Printer aria-hidden="true" className="h-5 w-5" />
            طباعة أو PDF
          </button>
        </div>
      </div>

      {feedback && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">{feedback}</div>}
      {error !== null && <UserFacingErrorAlert error={error} fallback="تعذر بناء التقرير." />}

      <div className="no-print rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="block text-xs font-bold text-slate-600">
            من تاريخ
            <input type="date" value={filters.from} onChange={(event) => update('from', event.target.value)} className={`mt-1 ${fieldClassName}`} />
          </label>
          <label className="block text-xs font-bold text-slate-600">
            إلى تاريخ
            <input type="date" value={filters.to} onChange={(event) => update('to', event.target.value)} className={`mt-1 ${fieldClassName}`} />
          </label>
          <label className="block text-xs font-bold text-slate-600">
            نوع العنصر
            <select value={filters.kind} onChange={(event) => update('kind', event.target.value as InventoryPerformanceFilters['kind'])} className={`mt-1 ${fieldClassName}`}>
              <option value="all">فساتين وملحقات</option>
              <option value="dress">فساتين فقط</option>
              <option value="accessory">ملحقات فقط</option>
            </select>
          </label>
          <label className="block text-xs font-bold text-slate-600">
            نوع العملية
            <select value={filters.operation} onChange={(event) => update('operation', event.target.value as InventoryPerformanceFilters['operation'])} className={`mt-1 ${fieldClassName}`}>
              <option value="both">تأجير وبيع</option>
              <option value="rental">تأجير</option>
              <option value="sale">بيع</option>
            </select>
          </label>
          <label className="block text-xs font-bold text-slate-600">
            الفئة
            <select value={filters.category} onChange={(event) => update('category', event.target.value as InventoryPerformanceFilters['category'])} className={`mt-1 ${fieldClassName}`}>
              <option value="all">كل الفئات</option>
              <optgroup label="فساتين">
                {DRESS_CATEGORIES.map((category) => <option key={category} value={category}>{category}</option>)}
              </optgroup>
              <optgroup label="ملحقات">
                {ACCESSORY_CATEGORY_OPTIONS.map((category) => <option key={category} value={category}>{ACCESSORY_CATEGORY_LABELS[category]}</option>)}
              </optgroup>
            </select>
          </label>
          <label className="block text-xs font-bold text-slate-600">
            الحالة
            <select value={filters.status} onChange={(event) => update('status', event.target.value as InventoryPerformanceFilters['status'])} className={`mt-1 ${fieldClassName}`}>
              <option value="all">كل الحالات</option>
              <optgroup label="فساتين">
                {DRESS_STATUS_OPTIONS.map((status) => <option key={status} value={status}>{DRESS_STATUS_LABELS[status]}</option>)}
              </optgroup>
              <optgroup label="ملحقات">
                {Object.entries(ACCESSORY_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </optgroup>
            </select>
          </label>
          <label className="block text-xs font-bold text-slate-600">
            العرض الزمني
            <select value={filters.granularity} onChange={(event) => update('granularity', event.target.value as InventoryPerformanceFilters['granularity'])} className={`mt-1 ${fieldClassName}`}>
              {Object.entries(PERFORMANCE_GRANULARITY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="block text-xs font-bold text-slate-600">
            حد الركود (أيام)
            <input
              type="number"
              min={1}
              max={3650}
              value={filters.idleThresholdDays}
              onChange={(event) => update('idleThresholdDays', Number(event.target.value) || 1)}
              className={`mt-1 ${fieldClassName}`}
            />
          </label>
          <label className="block text-xs font-bold text-slate-600 sm:col-span-2">
            بحث
            <input
              type="search"
              value={filters.search}
              onChange={(event) => update('search', event.target.value)}
              placeholder="ابحثي بكود أو اسم العنصر"
              className={`mt-1 ${fieldClassName}`}
            />
          </label>
          <label className="block text-xs font-bold text-slate-600 sm:col-span-2">
            الترتيب حسب
            <select value={filters.sortBy} onChange={(event) => update('sortBy', event.target.value as PerformanceSortKey)} className={`mt-1 ${fieldClassName}`}>
              {SORT_KEYS.map((key) => <option key={key} value={key}>{PERFORMANCE_SORT_LABELS[key]}</option>)}
            </select>
          </label>
        </div>
      </div>

      {report && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <SummaryCard label="إجمالي الإيراد" value={formatMoneyOMR(report.totals.totalRevenue)} hint="إيراد محقق فقط" />
            <SummaryCard label="صافي العائد" value={formatMoneyOMR(report.totals.netResult)} tone={report.totals.netResult < 0 ? 'danger' : 'positive'} hint="بعد التكاليف المرتبطة" />
            <SummaryCard label="متوسط نسبة الإشغال" value={percent(report.totals.averageUtilisationRate)} hint="أيام الحجز ÷ الأيام المتاحة" />
            <SummaryCard label="عناصر راكدة" value={report.totals.idleItemCount} tone={report.totals.idleItemCount > 0 ? 'warning' : 'default'} hint={`بلا استخدام ${filters.idleThresholdDays}+ يوماً`} />
            <SummaryCard label="عدد العناصر" value={report.totals.itemCount} />
            <SummaryCard label="مرات التأجير" value={report.totals.rentalCount} />
            <SummaryCard label="إجمالي الخصومات" value={formatMoneyOMR(report.totals.discounts)} />
            <SummaryCard label="تكلفتها تفوق عائدها" value={report.totals.costHeavyItemCount} tone={report.totals.costHeavyItemCount > 0 ? 'warning' : 'default'} />
          </div>

          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-bold text-slate-950">الإيراد مقابل التكاليف عبر الزمن</h2>
            <div className="mt-4">
              <PerformanceTrendChart points={report.timeline} />
            </div>
          </article>

          <div className="grid gap-4 xl:grid-cols-2">
            <RowList
              title="أعلى العناصر أداءً"
              description="مرتبة على صافي العائد ونسبة الإشغال معاً، وليس على عدد الحجوزات فقط."
              rows={report.topPerformers}
              emptyText="لا توجد عناصر ذات حركة في هذه الفترة."
              onOpen={openDetail}
            />
            <RowList
              title="أقل العناصر أداءً"
              description="عناصر تحركت لكن عائدها الصافي هو الأضعف."
              rows={report.lowPerformers}
              emptyText="لا توجد عناصر ذات حركة في هذه الفترة."
              onOpen={openDetail}
            />
            <RowList
              title="العناصر الراكدة"
              description={`لم تُستخدم منذ ${filters.idleThresholdDays} يوماً أو أكثر.`}
              rows={report.idleItems}
              emptyText="لا توجد عناصر راكدة."
              onOpen={openDetail}
            />
            <RowList
              title="العناصر كثيرة الصيانة"
              description="تكلفة الصيانة والتلف تمثل 35% أو أكثر من عائدها."
              rows={report.serviceHeavyItems}
              emptyText="لا توجد عناصر مرتفعة التكلفة."
              onOpen={openDetail}
            />
            <RowList
              title="العناصر المتأخرة باستمرار"
              description="عناصر تكرر تأخر إرجاعها خلال الفترة."
              rows={report.chronicallyLateItems}
              emptyText="لا توجد حالات تأخير في هذه الفترة."
              onOpen={openDetail}
            />
          </div>

          {report.designRows.length > 0 && (
            <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <h2 className="text-base font-bold text-slate-950">أداء التصاميم</h2>
              <p className="mt-1 text-xs text-slate-500">
                مجمّع من قطع كل تصميم. نسبة الإشغال محسوبة على مجموع أيام القطع، فقطعة مشغولة لا تُخفي قطعاً راكدة.
              </p>
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[46rem] text-right text-sm">
                  <caption className="sr-only">أداء كل تصميم خلال الفترة المحددة</caption>
                  <thead className="text-xs text-slate-500">
                    <tr>
                      <th scope="col" className="p-2">التصميم</th>
                      <th scope="col" className="p-2">القطع</th>
                      <th scope="col" className="p-2">تأجير</th>
                      <th scope="col" className="p-2">الإيراد</th>
                      <th scope="col" className="p-2">صافي العائد</th>
                      <th scope="col" className="p-2">الإشغال</th>
                      <th scope="col" className="p-2">قطع راكدة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.designRows.map((design) => (
                      <tr key={design.designId} className="border-t border-slate-100">
                        <td className="p-2">
                          <Link
                            to={`/designs/${encodeURIComponent(design.code)}`}
                            className={`block font-bold text-slate-900 underline-offset-2 hover:underline ${AMBER_FOCUS_RING_CLASS_NAME}`}
                          >
                            {design.code} — {design.name}
                          </Link>
                          <span className="block text-xs text-slate-500">{design.category}</span>
                        </td>
                        <td className="p-2">{design.pieceCount}</td>
                        <td className="p-2">{design.rentalCount}</td>
                        <td className="p-2">{formatMoneyOMR(design.totalRevenue)}</td>
                        <td className={`p-2 font-bold ${design.netResult < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                          {formatMoneyOMR(design.netResult)}
                        </td>
                        <td className="p-2">{percent(design.utilisationRate)}</td>
                        <td className={`p-2 ${design.idlePieceCount > 0 ? 'font-bold text-amber-700' : ''}`}>
                          {design.idlePieceCount}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </article>
          )}

          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-base font-bold text-slate-950">الجدول التفصيلي</h2>
            {report.rows.length === 0 ? (
              <div className="mt-4">
                <EmptyState title="لا توجد عناصر مطابقة" description="غيّري الفترة أو الفلاتر لعرض نتائج أخرى." />
              </div>
            ) : (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[54rem] text-right text-sm">
                  <caption className="sr-only">أداء كل عنصر خلال الفترة المحددة</caption>
                  <thead className="text-xs text-slate-500">
                    <tr>
                      <th scope="col" className="p-2">العنصر</th>
                      <th scope="col" className="p-2">
                        <button type="button" onClick={() => toggleSort('rentalCount')} className={`font-bold ${AMBER_FOCUS_RING_CLASS_NAME}`} aria-label="ترتيب حسب عدد مرات التأجير">تأجير</button>
                      </th>
                      <th scope="col" className="p-2">بيع</th>
                      <th scope="col" className="p-2">
                        <button type="button" onClick={() => toggleSort('revenue')} className={`font-bold ${AMBER_FOCUS_RING_CLASS_NAME}`} aria-label="ترتيب حسب الإيراد">الإيراد</button>
                      </th>
                      <th scope="col" className="p-2">
                        <button type="button" onClick={() => toggleSort('serviceCost')} className={`font-bold ${AMBER_FOCUS_RING_CLASS_NAME}`} aria-label="ترتيب حسب تكلفة الصيانة">التكاليف</button>
                      </th>
                      <th scope="col" className="p-2">
                        <button type="button" onClick={() => toggleSort('netResult')} className={`font-bold ${AMBER_FOCUS_RING_CLASS_NAME}`} aria-label="ترتيب حسب صافي العائد">صافي العائد</button>
                      </th>
                      <th scope="col" className="p-2">
                        <button type="button" onClick={() => toggleSort('utilisationRate')} className={`font-bold ${AMBER_FOCUS_RING_CLASS_NAME}`} aria-label="ترتيب حسب نسبة الإشغال">الإشغال</button>
                      </th>
                      <th scope="col" className="p-2">
                        <button type="button" onClick={() => toggleSort('idleDays')} className={`font-bold ${AMBER_FOCUS_RING_CLASS_NAME}`} aria-label="ترتيب حسب الركود">ركود</button>
                      </th>
                      <th scope="col" className="p-2">التفاصيل</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rows.map((row) => (
                      <tr key={row.id} className="border-t border-slate-100">
                        <td className="p-2">
                          <span className="block font-bold text-slate-900">{row.code} — {row.name}</span>
                          <span className="block text-xs text-slate-500">{KIND_LABELS[row.kind]} · {row.category} · {row.status}</span>
                        </td>
                        <td className="p-2">{row.rentalCount}</td>
                        <td className="p-2">{row.saleCount}</td>
                        <td className="p-2">{formatMoneyOMR(row.totalRevenue)}</td>
                        <td className="p-2">{formatMoneyOMR(row.totalCost)}</td>
                        <td className={`p-2 font-bold ${row.netResult < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{formatMoneyOMR(row.netResult)}</td>
                        <td className="p-2">{percent(row.utilisationRate)}</td>
                        <td className="p-2">{row.idleDays === null ? '—' : row.idleDays}</td>
                        <td className="p-2">
                          <button
                            type="button"
                            onClick={() => openDetail(row)}
                            aria-label={`فتح تفاصيل أداء ${row.code}`}
                            className={`min-h-10 rounded-xl border border-slate-300 px-3 text-xs font-bold text-slate-700 transition hover:bg-stone-100 ${AMBER_FOCUS_RING_CLASS_NAME}`}
                          >
                            عرض
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </article>

          <p className="rounded-xl bg-stone-50 p-4 text-xs leading-6 text-slate-600">
            نسبة الإشغال = أيام الحجز الفعلية داخل الفترة ÷ الأيام المتاحة داخل الفترة.
            صافي العائد = الإيراد المحقق ناقص تكاليف الصيانة والتنظيف والتلف المرتبطة بالعنصر؛ الخصومات مستبعدة من الإيراد أصلاً لأنها لم تُحصّل.
            العنصر الراكد = مضى على آخر استخدام له {filters.idleThresholdDays} يوماً أو أكثر.
            الحجوزات الملغاة لا تُحتسب إيراداً ولا إشغالاً، والحجز غير المدفوع لا يُحتسب دخلاً.
          </p>
        </>
      )}

      <InventoryPerformanceDetailPanel detail={detail} onClose={() => setDetail(null)} />
    </section>
  );
}
