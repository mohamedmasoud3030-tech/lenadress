import { useMemo, useState } from 'react';
import { Download, Plus } from 'lucide-react';
import { downloadCsv } from '@platform/download';
import { buildPaymentsCsv, ledgerFileName } from '../reports/ledgerExports';
import { PageHeader } from '../../components/shared/PageHeader';
import { SummaryCard } from '../../components/shared/SummaryCard';
import { EmptyState } from '../../components/shared/StateViews';
import { FilterBar, SearchFilter, SelectFilter } from '../../components/shared/FilterBar';
import { AMBER_FOCUS_RING_CLASS_NAME } from '../../shared/domain/formConstants';
import { AddPaymentModal } from './AddPaymentModal';
import {
  PAYMENT_DIRECTION_FILTER_OPTIONS,
  PAYMENT_METHOD_FILTER_OPTIONS,
  PAYMENT_TYPE_FILTER_OPTIONS,
} from './payment.constants';
import {
  filterPayments,
  formatPaymentDirectionLabel,
  formatPaymentMethodLabel,
  formatPaymentTypeLabel,
  getPayments,
  summarizePayments,
} from './payment.service';
import type {
  PaymentDirection,
  PaymentFilters,
  PaymentMethod,
  PaymentRecord,
  PaymentType,
} from './payment.types';

const typeBadgeClasses: Record<PaymentType, string> = {
  rental: 'bg-blue-100 text-blue-800',
  deposit: 'bg-violet-100 text-violet-800',
  late_fee: 'bg-orange-100 text-orange-800',
  damage_fee: 'bg-rose-100 text-rose-800',
  deposit_settlement: 'bg-slate-200 text-slate-800',
  retained_deposit: 'bg-amber-100 text-amber-800',
  penalty: 'bg-orange-100 text-orange-800',
  refund: 'bg-emerald-100 text-emerald-800',
  adjustment: 'bg-slate-200 text-slate-800',
};

const methodBadgeClasses: Record<PaymentMethod, string> = {
  cash: 'bg-amber-100 text-amber-800',
  card: 'bg-indigo-100 text-indigo-800',
  bank_transfer: 'bg-cyan-100 text-cyan-800',
  other: 'bg-slate-100 text-slate-700',
};

const directionBadgeClasses: Record<PaymentDirection, string> = {
  income: 'bg-emerald-100 text-emerald-800',
  refund: 'bg-rose-100 text-rose-800',
  settlement: 'bg-slate-200 text-slate-800',
};

function formatAmount(amount: number): string {
  return new Intl.NumberFormat('ar-OM', {
    style: 'currency',
    currency: 'OMR',
    minimumFractionDigits: 2,
  }).format(amount);
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('ar-OM', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function formatMovementAmount(payment: PaymentRecord): string {
  if (payment.direction === 'income') return `+ ${formatAmount(payment.amount)}`;
  if (payment.direction === 'refund') return `- ${formatAmount(payment.amount)}`;
  return formatAmount(payment.amount);
}

function movementAmountClass(direction: PaymentDirection): string {
  if (direction === 'income') return 'text-emerald-700';
  if (direction === 'refund') return 'text-rose-700';
  return 'text-slate-700';
}

export function PaymentsPage() {
  const [payments, setPayments] = useState<PaymentRecord[]>(() => getPayments());
  const [filters, setFilters] = useState<PaymentFilters>({
    search: '',
    type: 'all',
    method: 'all',
    direction: 'all',
  });
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const filteredPayments = useMemo(
    () => filterPayments(payments, filters),
    [payments, filters],
  );
  const summary = useMemo(
    () => summarizePayments(payments),
    [payments],
  );

  const handleCreated = (payment: PaymentRecord) => {
    setPayments((current) => [payment, ...current]);
    setFeedback(`تم تسجيل الدفعة ${payment.paymentNumber} بنجاح.`);
  };

  /**
   * Exports exactly what the filters show. The accountant asks for a period or
   * a type, and exporting the unfiltered ledger would make her redo the
   * narrowing in the spreadsheet.
   */
  const handleExport = () => {
    downloadCsv(ledgerFileName('سجل-المدفوعات'), buildPaymentsCsv(filteredPayments));
  };

  return (
    <section className="min-w-0 space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <PageHeader
          eyebrow="المدفوعات"
          title="إدارة المدفوعات"
        />
        <button
          type="button"
          onClick={handleExport}
          className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-stone-100 ${AMBER_FOCUS_RING_CLASS_NAME}`}
        >
          <Download aria-hidden="true" className="h-5 w-5" />
          تصدير CSV
        </button>
        <button
          type="button"
          onClick={() => { setFeedback(null); setShowCreateModal(true); }}
          className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 ${AMBER_FOCUS_RING_CLASS_NAME}`}
        >
          <Plus aria-hidden="true" className="h-5 w-5" />
          تسجيل دفعة جديدة
        </button>
      </div>

      {feedback && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">{feedback}</div>}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5">
        <SummaryCard label="إجمالي التحصيل النقدي" value={formatAmount(summary.totalCollected)} tone="positive" />
        <SummaryCard label="العربونات المحصلة" value={formatAmount(summary.deposits)} hint="التزام مستحق الرد" />
        <SummaryCard label="العربون المحتجز" value={formatAmount(summary.retainedDeposits)} />
        <SummaryCard label="الاسترجاعات النقدية" value={formatAmount(summary.totalRefunded)} />
        <SummaryCard label="الرصيد المتبقي" value={formatAmount(summary.remainingBalance)} tone={summary.remainingBalance > 0 ? 'warning' : 'default'} />
      </div>

      <FilterBar>
        <SearchFilter
          label="البحث في المدفوعات"
          value={filters.search}
          onChange={(search) => setFilters((current) => ({ ...current, search }))}
          placeholder="بحث برقم الدفعة أو الحجز أو العميلة"
        />
        <SelectFilter label="نوع الحركة" value={filters.type} onChange={(type) => setFilters((current) => ({ ...current, type }))} options={PAYMENT_TYPE_FILTER_OPTIONS} />
        <SelectFilter label="وسيلة الدفع" value={filters.method} onChange={(method) => setFilters((current) => ({ ...current, method }))} options={PAYMENT_METHOD_FILTER_OPTIONS} />
        <SelectFilter label="اتجاه الحركة" value={filters.direction} onChange={(direction) => setFilters((current) => ({ ...current, direction }))} options={PAYMENT_DIRECTION_FILTER_OPTIONS} />
      </FilterBar>

      {filteredPayments.length === 0 ? (
        <EmptyState
          title={payments.length === 0 ? 'لا توجد حركات مالية بعد' : 'لا توجد مدفوعات مطابقة'}
          description={payments.length === 0 ? 'سجّلي أول دفعة على حجز قائم لتظهر هنا.' : 'غيّري البحث أو الفلاتر الحالية لعرض نتائج أخرى.'}
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">{filteredPayments.map((payment)=><article key={payment.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-sm text-slate-500">رقم الحركة: {payment.paymentNumber}</p><h2 className="mt-1 text-lg font-semibold text-slate-950">{payment.customerName}</h2><p className="text-sm text-slate-600">{payment.reservationNumber} — {payment.dressCode} / {payment.dressName}</p></div><p className={`text-sm font-bold ${movementAmountClass(payment.direction)}`}>{formatMovementAmount(payment)}</p></div><div className="mt-3 flex flex-wrap gap-2"><span className={`rounded-full px-3 py-1 text-xs font-semibold ${typeBadgeClasses[payment.type]}`}>{formatPaymentTypeLabel(payment.type)}</span><span className={`rounded-full px-3 py-1 text-xs font-semibold ${methodBadgeClasses[payment.method]}`}>{formatPaymentMethodLabel(payment.method)}</span><span className={`rounded-full px-3 py-1 text-xs font-semibold ${directionBadgeClasses[payment.direction]}`}>{formatPaymentDirectionLabel(payment.direction)}</span></div><dl className="mt-4 text-sm text-slate-700"><dt className="text-slate-500">تاريخ الحركة</dt><dd>{formatDate(payment.paymentDate)}</dd></dl>{payment.notes ? <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-600">{payment.notes}</p> : null}</article>)}</div>
      )}

      <AddPaymentModal open={showCreateModal} onClose={() => setShowCreateModal(false)} onCreated={handleCreated} />
    </section>
  );
}
