import { escapeHtml, printDocument } from '@platform/printing';
import { buildCsv } from '../../shared/utils/csv';
import { formatMoneyOMR } from '../../shared/utils/format';
import { getShowroomProfile } from '../preferences/showroomProfile.service';
import { PERFORMANCE_SORT_LABELS } from './inventoryPerformance.service';
import type { InventoryPerformanceReport, InventoryPerformanceRow } from './inventoryPerformance.types';

/**
 * Export and print for the inventory performance report.
 *
 * The CSV goes through the shared CSV builder (UTF-8 BOM plus formula-injection
 * guard) and the printable document goes through the shared printing boundary
 * with every value escaped. Both carry the reporting period and the generation
 * timestamp so a printed copy can always be traced back to its filters.
 */

export const PERFORMANCE_CSV_HEADERS = [
  'النوع',
  'الكود',
  'الاسم',
  'الفئة',
  'الحالة',
  'مرات التأجير',
  'مرات البيع',
  'إيراد التأجير',
  'إيراد البيع',
  'إجمالي الإيراد',
  'الخصومات',
  'تكلفة الصيانة والتنظيف',
  'تكلفة التلف والفقد',
  'إجمالي التكاليف',
  'صافي العائد',
  'أيام الإشغال',
  'الأيام المتاحة',
  'نسبة الإشغال %',
  'متوسط قيمة العملية',
  'متوسط مدة التأجير',
  'مرات التأخير',
  'مرات التلف',
  'مرات الفقد',
  'آخر استخدام',
  'أيام بدون استخدام',
  'معدل الدوران',
];

const KIND_LABELS = { dress: 'فستان', accessory: 'ملحق' } as const;

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function buildPerformanceCsvRow(row: InventoryPerformanceRow): Array<string | number> {
  return [
    KIND_LABELS[row.kind],
    row.code,
    row.name,
    row.category,
    row.status,
    row.rentalCount,
    row.saleCount,
    round(row.rentalRevenue),
    round(row.saleRevenue),
    round(row.totalRevenue),
    round(row.discounts),
    round(row.serviceCost),
    round(row.damageCost),
    round(row.totalCost),
    round(row.netResult),
    row.occupiedDays,
    row.availableDays,
    round(row.utilisationRate * 100, 1),
    round(row.averageTransactionValue),
    round(row.averageRentalDays, 1),
    row.lateCount,
    row.damageCount,
    row.lossCount,
    row.lastUsedDate ?? 'لا يوجد',
    row.idleDays ?? 'لا يوجد',
    round(row.turnoverRate, 4),
  ];
}

export function buildInventoryPerformanceCsv(report: InventoryPerformanceReport): string {
  return buildCsv(PERFORMANCE_CSV_HEADERS, report.rows.map(buildPerformanceCsvRow));
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatGeneratedAt(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function buildInventoryPerformanceHtml(report: InventoryPerformanceReport): string {
  const profile = getShowroomProfile();
  const { filters, totals } = report;

  const rows = report.rows
    .map((row) => `<tr>`
      + `<td>${escapeHtml(KIND_LABELS[row.kind])}</td>`
      + `<td>${escapeHtml(row.code)}</td>`
      + `<td>${escapeHtml(row.name)}</td>`
      + `<td>${escapeHtml(String(row.rentalCount))}</td>`
      + `<td>${escapeHtml(String(row.saleCount))}</td>`
      + `<td>${escapeHtml(formatMoneyOMR(row.totalRevenue))}</td>`
      + `<td>${escapeHtml(formatMoneyOMR(row.totalCost))}</td>`
      + `<td>${escapeHtml(formatMoneyOMR(row.netResult))}</td>`
      + `<td>${escapeHtml(formatPercent(row.utilisationRate))}</td>`
      + `<td>${escapeHtml(row.idleDays === null ? 'لا يوجد' : String(row.idleDays))}</td>`
      + `</tr>`)
    .join('');

  return `<style>
  .report-meta{margin:0 0 8px;font-size:13px;color:#64748b}
  .kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-top:16px}
  .kpi{border:1px solid #cbd5e1;border-radius:10px;padding:10px}
  .kpi b{display:block;font-size:16px;margin-top:4px;color:#0f172a}
  .kpi span{font-size:12px;color:#64748b}
  /* Interactive chrome must never reach the paper. */
  @media print{.no-print{display:none !important}}
</style>
<h1>${escapeHtml(profile.brandName)} — تقرير أداء المخزون والربحية</h1>
<p class="report-meta">الفترة من ${escapeHtml(filters.from)} إلى ${escapeHtml(filters.to)}</p>
<p class="report-meta">تاريخ ووقت إنشاء التقرير: ${escapeHtml(formatGeneratedAt(report.generatedAt))}</p>
<p class="report-meta">الترتيب حسب: ${escapeHtml(PERFORMANCE_SORT_LABELS[filters.sortBy])} · حد الركود: ${escapeHtml(String(filters.idleThresholdDays))} يوماً</p>
<div class="kpi-grid">
  <div class="kpi"><span>عدد العناصر</span><b>${escapeHtml(String(totals.itemCount))}</b></div>
  <div class="kpi"><span>إجمالي الإيراد</span><b>${escapeHtml(formatMoneyOMR(totals.totalRevenue))}</b></div>
  <div class="kpi"><span>صافي العائد</span><b>${escapeHtml(formatMoneyOMR(totals.netResult))}</b></div>
  <div class="kpi"><span>متوسط نسبة الإشغال</span><b>${escapeHtml(formatPercent(totals.averageUtilisationRate))}</b></div>
  <div class="kpi"><span>إجمالي الخصومات</span><b>${escapeHtml(formatMoneyOMR(totals.discounts))}</b></div>
  <div class="kpi"><span>إجمالي التكاليف</span><b>${escapeHtml(formatMoneyOMR(totals.totalCost))}</b></div>
  <div class="kpi"><span>عناصر راكدة</span><b>${escapeHtml(String(totals.idleItemCount))}</b></div>
  <div class="kpi"><span>عناصر تكلفتها تفوق عائدها</span><b>${escapeHtml(String(totals.costHeavyItemCount))}</b></div>
</div>
<table>
  <thead><tr>
    <th>النوع</th><th>الكود</th><th>الاسم</th><th>تأجير</th><th>بيع</th>
    <th>الإيراد</th><th>التكاليف</th><th>صافي العائد</th><th>الإشغال</th><th>أيام بدون استخدام</th>
  </tr></thead>
  <tbody>${rows}</tbody>
</table>
<p class="report-meta">نسبة الإشغال = أيام الحجز الفعلية ÷ الأيام المتاحة خلال الفترة. صافي العائد = الإيراد المحقق ناقص تكاليف الصيانة والتنظيف والتلف المرتبطة بالعنصر.</p>`;
}

export function printInventoryPerformanceReport(report: InventoryPerformanceReport): void {
  printDocument(`تقرير أداء المخزون ${report.filters.from} — ${report.filters.to}`, buildInventoryPerformanceHtml(report));
}
