import { useMemo, useState } from 'react';
import { ACCESSORY_RETURN_CONDITION_LABELS, getReservationAccessoryViews } from '../accessories/reservationAccessory.service';
import { formatMoneyOMR } from '../../shared/utils/format';
import { DeliveryReturnModal } from './DeliveryReturnModal';
import {
  filterDeliveryReturnRecords,
  getDeliveryReturnRecords,
  summarizeDeliveryReturnRecords,
} from './deliveryReturn.service';
import type { DeliveryReturnFilters, DeliveryReturnRecord, DeliveryReturnStatus } from './deliveryReturn.types';

const statusOptions: Array<{ value: DeliveryReturnStatus | 'all'; label: string }> = [
  { value: 'all', label: 'كل الحالات' },
  { value: 'pending_delivery', label: 'بانتظار التسليم' },
  { value: 'delivered', label: 'تم التسليم' },
  { value: 'returned', label: 'تم الاسترجاع' },
  { value: 'late', label: 'متأخر' },
  { value: 'damaged', label: 'متضرر' },
];

const statusBadgeClasses: Record<DeliveryReturnStatus, string> = {
  pending_delivery: 'bg-amber-100 text-amber-800',
  delivered: 'bg-blue-100 text-blue-800',
  returned: 'bg-emerald-100 text-emerald-800',
  late: 'bg-orange-100 text-orange-800',
  damaged: 'bg-rose-100 text-rose-800',
};

const statusLabels: Record<DeliveryReturnStatus, string> = {
  pending_delivery: 'بانتظار التسليم',
  delivered: 'تم التسليم',
  returned: 'تم الاسترجاع',
  late: 'متأخر',
  damaged: 'متضرر',
};

function formatDateTime(dateTime?: string): string {
  if (!dateTime) return '—';

  return new Date(dateTime).toLocaleString('ar-EG', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Accessory handover state for one queue row, read from the link records. */
function RecordAccessories({ reservationNumber }: { reservationNumber: string }) {
  const links = getReservationAccessoryViews(reservationNumber);
  if (links.length === 0) return null;

  return (
    <section className="mt-3 rounded-xl bg-slate-50 p-3" aria-label={`ملحقات الحجز ${reservationNumber}`}>
      <p className="text-xs font-extrabold text-slate-700">الملحقات ({links.length})</p>
      <ul className="mt-2 space-y-1 text-xs text-slate-600">
        {links.map((link) => (
          <li key={link.id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="min-w-0">
              <span dir="ltr">{link.accessoryCodeSnapshot}</span> — {link.accessoryNameSnapshot}
            </span>
            <span className="font-bold text-slate-700">
              {link.returnedAt
                ? `${link.returnCondition ? ACCESSORY_RETURN_CONDITION_LABELS[link.returnCondition] : 'سليم'}${link.chargeAmount ? ` · ${formatMoneyOMR(link.chargeAmount)}` : ''}`
                : link.deliveredAt ? 'خارج المحل' : 'بانتظار التسليم'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function DeliveryReturnPage() {
  const [filters, setFilters] = useState<DeliveryReturnFilters>({
    search: '',
    status: 'all',
  });
  const [records, setRecords] = useState<DeliveryReturnRecord[]>(() => getDeliveryReturnRecords());
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const filteredRecords = useMemo(
    () => filterDeliveryReturnRecords(records, filters),
    [records, filters],
  );

  const summary = useMemo(
    () => summarizeDeliveryReturnRecords(records),
    [records],
  );

  const handleCompleted = (record: DeliveryReturnRecord) => {
    setRecords(getDeliveryReturnRecords());
    setFeedback(`تم حفظ العملية للحجز ${record.reservationNumber} بنجاح.`);
  };

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">إدارة التسليم والاسترجاع</h1>
          <p className="mt-2 text-slate-600">متابعة تسليم الفساتين واسترجاعها مع الرسوم والملاحظات التشغيلية.</p>
        </div>
        <button type="button" onClick={() => { setFeedback(null); setShowCreateModal(true); }} className="rounded-xl bg-violet-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-violet-800">
          عملية تسليم / استرجاع جديدة
        </button>
      </div>

      {feedback && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">{feedback}</div>}

      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">بانتظار التسليم</p>
          <p className="mt-2 text-3xl font-bold text-slate-950">{summary.pendingDelivery}</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">تم التسليم / خارج المحل</p>
          <p className="mt-2 text-3xl font-bold text-slate-950">{summary.deliveredOut}</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">تم الاسترجاع</p>
          <p className="mt-2 text-3xl font-bold text-slate-950">{summary.returned}</p>
        </article>
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">متأخر أو متضرر</p>
          <p className="mt-2 text-3xl font-bold text-slate-950">{summary.lateOrDamaged}</p>
        </article>
      </div>

      <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-3">
        <input
          value={filters.search}
          onChange={(event) => setFilters((prev) => ({ ...prev, search: event.target.value }))}
          placeholder="بحث برقم الحجز أو اسم العميل أو كود العنصر"
          className="rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
        />
        <select
          value={filters.status}
          onChange={(event) =>
            setFilters((prev) => ({
              ...prev,
              status: event.target.value as DeliveryReturnStatus | 'all',
            }))
          }
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-100"
        >
          {statusOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {filteredRecords.length === 0 ? (
        <article className="rounded-2xl border border-dashed border-slate-300 bg-white p-8 text-center shadow-sm">
          <p className="text-sm text-slate-500">لا توجد نتائج مطابقة للفلتر الحالي.</p>
        </article>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {filteredRecords.map((record) => (
            <article key={record.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm text-slate-500">رقم الحجز: {record.reservationNumber}</p>
                  <h2 className="mt-1 text-lg font-semibold text-slate-950">{record.customerName}</h2>
                  <p className="text-sm text-slate-600">
                    {record.dressCode} — {record.dressName}
                  </p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusBadgeClasses[record.status]}`}>
                  {statusLabels[record.status]}
                </span>
              </div>

              <dl className="mt-4 grid gap-2 text-sm text-slate-700 md:grid-cols-2">
                <div>
                  <dt className="text-slate-500">تاريخ/وقت التسليم</dt>
                  <dd>{formatDateTime(record.deliveryDateTime)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">تاريخ/وقت الاسترجاع</dt>
                  <dd>{formatDateTime(record.returnDateTime)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">حالة التسليم</dt>
                  <dd>{record.deliveryCondition ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">حالة الاسترجاع</dt>
                  <dd>{record.returnCondition ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">رسوم التأخير</dt>
                  <dd>{record.lateFee} ر.ع</dd>
                </div>
                <div>
                  <dt className="text-slate-500">رسوم الضرر</dt>
                  <dd>{record.damageFee} ر.ع</dd>
                </div>
                <div>
                  <dt className="text-slate-500">استرجاع العربون</dt>
                  <dd>{record.depositRefundAmount} ر.ع</dd>
                </div>
              </dl>

              <RecordAccessories reservationNumber={record.reservationNumber} />

              {record.notes ? <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{record.notes}</p> : null}
            </article>
          ))}
        </div>
      )}

      <DeliveryReturnModal open={showCreateModal} onClose={() => setShowCreateModal(false)} onCompleted={handleCompleted} />
    </section>
  );
}
