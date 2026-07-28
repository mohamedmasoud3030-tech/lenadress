import { useMemo, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import { PageHeader } from '../../components/shared/PageHeader';
import { filterAuditLog, getAuditLog } from './audit.service';
import type { AuditActionType, AuditEntityType, AuditLogFilters } from './audit.types';

const entityLabels: Record<AuditEntityType, string> = {
  customer: 'عميلة',
  dress: 'عنصر مخزون',
  reservation: 'حجز',
  payment: 'حركة مالية',
  expense: 'مصروف',
  sale: 'بيع',
  'delivery-return': 'تسليم أو استرجاع',
  'daily-closing': 'يومية نقدية',
  backup: 'نسخة احتياطية',
  database: 'قاعدة البيانات',
  storage: 'تخزين',
};

const actionLabels: Record<AuditActionType, string> = {
  create: 'إضافة',
  update: 'تعديل',
  'status-change': 'تغيير حالة',
  cancel: 'إلغاء',
  deliver: 'تسليم',
  return: 'استرجاع',
  payment: 'تحصيل',
  refund: 'استرجاع مالي',
  sale: 'بيع',
  'close-day': 'إقفال يومية',
  'reopen-day': 'إعادة فتح يومية',
  'import-backup': 'استيراد نسخة',
  'reset-data': 'تصفير البيانات',
  'migrate-images': 'ترحيل الصور',
  archive: 'أرشفة',
  restore: 'إعادة تفعيل',
  delete: 'حذف نهائي',
};

const field = 'min-h-11 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm outline-none transition focus-visible:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500/30';

export function AuditLogPage() {
  const entries = useMemo(() => getAuditLog(), []);
  const [filters, setFilters] = useState<AuditLogFilters>({ search: '', entityType: 'all', action: 'all' });
  const filteredEntries = useMemo(() => filterAuditLog(entries, filters), [entries, filters]);

  return (
    <section className="space-y-6">
      <PageHeader eyebrow="الرقابة" title="سجل التدقيق" description="راجعي الحركات التشغيلية الحساسة: التحصيل والاسترجاعات والبيع والتسليم وإقفال اليومية وإعادة فتحها." />

      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-[1fr_190px_190px]">
        <input value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="ابحثي في ملخص الحركة أو رقم السجل" className={field} />
        <select value={filters.entityType} onChange={(event) => setFilters((current) => ({ ...current, entityType: event.target.value as AuditLogFilters['entityType'] }))} className={field}>
          <option value="all">كل الأقسام</option>
          {Object.entries(entityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select value={filters.action} onChange={(event) => setFilters((current) => ({ ...current, action: event.target.value as AuditLogFilters['action'] }))} className={field}>
          <option value="all">كل الحركات</option>
          {Object.entries(actionLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </div>

      {filteredEntries.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
          <ClipboardList aria-hidden="true" className="mx-auto h-10 w-10 text-amber-700" />
          <p className="mt-4 text-lg font-bold">لا توجد حركات مطابقة</p>
          <p className="mt-2 text-sm text-slate-500">سيظهر هنا سجل الحركات الجديدة بعد تنفيذ العمليات التشغيلية.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredEntries.map((entry) => (
            <article key={entry.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><p className="font-bold text-slate-950">{entry.summary}</p><p className="mt-1 text-xs text-slate-500">{entityLabels[entry.entityType]} · {actionLabels[entry.action]} · {entry.entityId}</p></div>
                <time className="text-xs font-semibold text-slate-500">{new Date(entry.timestamp).toLocaleString('ar-OM')}</time>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
