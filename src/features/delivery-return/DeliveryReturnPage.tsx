import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { PageHeader } from '../../components/shared/PageHeader';
import { SummaryCard } from '../../components/shared/SummaryCard';
import { EmptyState } from '../../components/shared/StateViews';
import { FilterBar, SearchFilter, SelectFilter } from '../../components/shared/FilterBar';
import { AMBER_FOCUS_RING_CLASS_NAME } from '../../shared/domain/formConstants';
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

/** Same palette family as the reservation and inventory badges. */
const statusBadgeClasses: Record<DeliveryReturnStatus, string> = {
  pending_delivery: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200',
  delivered: 'bg-sky-50 text-sky-800 ring-1 ring-sky-200',
  returned: 'bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200',
  late: 'bg-orange-50 text-orange-800 ring-1 ring-orange-200',
  damaged: 'bg-rose-50 text-rose-800 ring-1 ring-rose-200',
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
    <section className="min-w-0 space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <PageHeader
          eyebrow="التسليم والاسترجاع"
          title="إدارة التسليم والاسترجاع"
          description="متابعة تسليم الفساتين والملحقات واسترجاعها مع الرسوم والملاحظات التشغيلية."
        />
        <button
          type="button"
          onClick={() => { setFeedback(null); setShowCreateModal(true); }}
          className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 ${AMBER_FOCUS_RING_CLASS_NAME}`}
        >
          <Plus aria-hidden="true" className="h-5 w-5" />
          عملية تسليم / استرجاع
        </button>
      </div>

      {feedback && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">{feedback}</div>}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <SummaryCard label="بانتظار التسليم" value={summary.pendingDelivery} />
        <SummaryCard label="خارج المحل" value={summary.deliveredOut} hint="تم التسليم" />
        <SummaryCard label="تم الاسترجاع" value={summary.returned} tone="positive" />
        <SummaryCard label="متأخر أو متضرر" value={summary.lateOrDamaged} tone={summary.lateOrDamaged > 0 ? 'danger' : 'default'} />
      </div>

      <FilterBar>
        <SearchFilter
          label="البحث في عمليات التسليم والاسترجاع"
          value={filters.search}
          onChange={(search) => setFilters((current) => ({ ...current, search }))}
          placeholder="بحث برقم الحجز أو العميلة أو كود العنصر"
        />
        <SelectFilter
          label="حالة العملية"
          value={filters.status}
          onChange={(status) => setFilters((current) => ({ ...current, status }))}
          options={statusOptions}
        />
      </FilterBar>

      {filteredRecords.length === 0 ? (
        <EmptyState
          title={records.length === 0 ? 'لا توجد عمليات تسليم أو استرجاع بعد' : 'لا توجد نتائج مطابقة'}
          description={records.length === 0 ? 'ستظهر هنا الحجوزات المستحقة للتسليم فور إنشائها.' : 'غيّري البحث أو الفلتر الحالي لعرض نتائج أخرى.'}
        />
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
                <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${statusBadgeClasses[record.status]}`}>
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
