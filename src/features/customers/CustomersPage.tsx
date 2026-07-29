import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Archive, CircleAlert, Download, Plus, Search, Trash2 } from 'lucide-react';
import { downloadCsv } from '@platform/download';
import { AMBER_FOCUS_RING_CLASS_NAME } from '../../shared/domain/formConstants';
import { buildCustomersCsv, ledgerFileName } from '../reports/ledgerExports';
import { PageHeader } from '../../components/shared/PageHeader';
import { SummaryCard } from '../../components/shared/SummaryCard';
import { formatMoneyOMR } from '../../shared/utils/format';
import { AddCustomerModal } from './AddCustomerModal';
import { CustomerConductPanel } from './CustomerConductPanel';
import { MeasurementsPanel } from './MeasurementsPanel';
import { getCustomerConduct } from './customerConduct.service';
import { ViewModeToggle, useViewMode } from '../../components/shared/ViewModeToggle';
import { archiveCustomer, deleteCustomer, filterCustomers, getCustomerDeletionBlockers, getCustomers, summarizeCustomers } from './customer.service';
import type { Customer, CustomerFilters, CustomerStatus } from './customer.types';

const statusLabels: Record<CustomerStatus, string> = {
  normal: 'عادية',
  trusted: 'موثوقة',
  warning: 'تنبيه',
  blocked: 'محظورة',
};

const statusStyles: Record<CustomerStatus, string> = {
  normal: 'bg-slate-100 text-slate-700 ring-slate-200',
  trusted: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  warning: 'bg-amber-50 text-amber-700 ring-amber-200',
  blocked: 'bg-rose-50 text-rose-700 ring-rose-200',
};

const statuses: Array<'all' | CustomerStatus> = ['all', 'normal', 'trusted', 'warning', 'blocked'];

function CustomerCard({ customer, onArchive, onDelete }: { customer: Customer; onArchive: (customer: Customer) => void; onDelete: (customer: Customer) => void }) {
  const deletionBlockers = getCustomerDeletionBlockers(customer.id);
  const canHardDelete = deletionBlockers.length === 0;
  const [showConduct, setShowConduct] = useState(false);
  const [showMeasurements, setShowMeasurements] = useState(false);
  // A warning must be visible before booking, not hidden behind a click.
  const conduct = getCustomerConduct(customer);

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold text-slate-400" dir="ltr">{customer.phone}</p>
          <h2 className="mt-1 text-xl font-bold text-slate-950">{customer.name}</h2>
          {customer.address && <p className="mt-1 text-sm text-slate-500">{customer.address}</p>}
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ring-1 ${statusStyles[customer.status]}`}>
          {statusLabels[customer.status]}
        </span>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-stone-50 p-3">
          <p className="text-sm text-slate-400">الحجوزات</p>
          <p className="mt-1 font-bold text-slate-950">{customer.totalReservations}</p>
        </div>
        <div className="rounded-xl bg-stone-50 p-3">
          <p className="text-sm text-slate-400">النشطة</p>
          <p className="mt-1 font-bold text-slate-950">{customer.activeReservations}</p>
        </div>
        <div className="rounded-xl bg-stone-50 p-3">
          <p className="text-sm text-slate-400">المتبقي</p>
          <p className={`mt-1 font-bold ${customer.remainingBalance > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
            {formatMoneyOMR(customer.remainingBalance)}
          </p>
        </div>
      </div>

      {conduct.advisories.length > 0 && (
        <p role="alert" className="mt-3 rounded-xl border border-amber-300 bg-amber-50 p-2.5 text-xs font-bold text-amber-900">
          ⚠ {conduct.advisories[0]}
          {conduct.advisories.length > 1 ? ` (+${conduct.advisories.length - 1})` : ''}
        </p>
      )}

      <button
        type="button"
        onClick={() => setShowConduct((current) => !current)}
        aria-expanded={showConduct}
        className="mt-3 inline-flex min-h-10 items-center rounded-xl border border-slate-300 px-3 text-xs font-bold text-slate-700 transition hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
      >
        {showConduct ? 'إخفاء سجل التعامل' : `سجل التعامل · التزام ${conduct.reliabilityScore}`}
      </button>

      <button
        type="button"
        onClick={() => setShowMeasurements((current) => !current)}
        aria-expanded={showMeasurements}
        className="mt-2 mr-2 inline-flex min-h-10 items-center rounded-xl border border-slate-300 px-3 text-xs font-bold text-slate-700 transition hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
      >
        {showMeasurements ? 'إخفاء المقاسات' : 'المقاسات واقتراح المقاس'}
      </button>

      {showConduct && <div className="mt-3"><CustomerConductPanel customer={customer} /></div>}
      {showMeasurements && <div className="mt-3"><MeasurementsPanel customer={customer} /></div>}

      <div className="mt-5 border-t border-slate-100 pt-4 text-sm leading-6 text-slate-600">
        <p><span className="font-semibold text-slate-900">المقاسات:</span> {customer.measurements || 'غير مسجلة'}</p>
        {customer.lastReservationDate && (
          <p className="mt-2"><span className="font-semibold text-slate-900">آخر حجز:</span> {customer.lastReservationDate}</p>
        )}
        {customer.notes && <p className="mt-2 rounded-xl bg-amber-50 p-3 text-amber-900">{customer.notes}</p>}
      </div>

      <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
        {customer.archivedAt ? (
          <span className="text-xs font-bold text-slate-500">مؤرشفة — التاريخ محفوظ</span>
        ) : (
          <button
            type="button"
            onClick={() => onArchive(customer)}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-amber-300 px-3 text-sm font-bold text-amber-700 transition hover:bg-amber-50"
          >
            <Archive aria-hidden="true" className="h-4 w-4" />
            أرشفة
          </button>
        )}
        <button
          type="button"
          onClick={() => onDelete(customer)}
          disabled={!canHardDelete}
          title={canHardDelete ? 'حذف نهائي متاح لعميلة بلا أي تاريخ.' : `${deletionBlockers.join(' ')} استخدمي الأرشفة بدل الحذف.`}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-rose-300 px-3 text-sm font-bold text-rose-700 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Trash2 aria-hidden="true" className="h-4 w-4" />
          حذف نهائي
        </button>
      </div>
    </article>
  );
}

export function CustomersPage() {
  // `?search=` lets the reservation screen and the calendar link straight to a
  // customer record instead of dropping the operator on an unfiltered list.
  const [searchParams] = useSearchParams();
  const [customers, setCustomers] = useState<Customer[]>(() => getCustomers());
  const [filters, setFilters] = useState<CustomerFilters>(() => ({
    search: searchParams.get('search') ?? '',
    status: 'all',
    balance: 'all',
  }));
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [viewMode, setViewMode] = useViewMode('customers');
  const [feedback, setFeedback] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleArchive = (customer: Customer) => {
    setActionError(null);
    if (!window.confirm(`سيتم أرشفة العميلة "${customer.name}" مع الاحتفاظ بكامل تاريخها. هل تريدين المتابعة؟`)) return;
    try {
      archiveCustomer(customer.id);
      setCustomers(getCustomers());
      setFeedback(`تمت أرشفة العميلة ${customer.name}.`);
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : 'تعذر أرشفة العميلة.');
    }
  };

  const handleDelete = (customer: Customer) => {
    setActionError(null);
    if (!window.confirm(`حذف نهائي لسجل العميلة "${customer.name}"؟ لا يوجد أي تاريخ مرتبط بها.`)) return;
    try {
      deleteCustomer(customer.id);
      setCustomers(getCustomers());
      setFeedback(`تم حذف سجل العميلة ${customer.name}.`);
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : 'تعذر حذف العميلة.');
    }
  };

  const filteredCustomers = useMemo(() => filterCustomers(customers, filters), [customers, filters]);

  /**
   * Exports exactly what the filters show: the accountant asks for a period or
   * a subset, and an unfiltered dump makes her redo the narrowing.
   */
  const handleExport = () => {
    downloadCsv(ledgerFileName('سجل-العميلات'), buildCustomersCsv(filteredCustomers));
  };
  const summary = useMemo(() => summarizeCustomers(customers), [customers]);

  const handleCreated = (customer: Customer) => {
    setCustomers((current) => [customer, ...current]);
    setFeedback(`تمت إضافة العميلة ${customer.name} بنجاح.`);
  };

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <PageHeader
          eyebrow="العميلات"
          title="إدارة العميلات"
          description="حفظ بيانات التواصل والمقاسات وحالة التعامل والأرصدة في سجل واحد واضح."
        />
        <button type="button" onClick={handleExport} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-stone-100 ${AMBER_FOCUS_RING_CLASS_NAME}`}><Download aria-hidden="true" className="h-5 w-5" />تصدير CSV</button>
        <button
          type="button"
          onClick={() => {
            setFeedback(null);
            setShowCreateModal(true);
          }}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
        >
          <Plus aria-hidden="true" className="h-5 w-5" />
          إضافة عميلة
        </button>
      </div>

      {actionError && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-700">
          {actionError}
        </div>
      )}

      {feedback && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
          {feedback}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <SummaryCard label="إجمالي العميلات" value={summary.total} />
        <SummaryCard label="عميلات موثوقات" value={summary.trusted} tone="positive" />
        <SummaryCard label="عليهن متبقي" value={summary.withBalance} tone={summary.withBalance > 0 ? 'warning' : 'default'} />
        <SummaryCard label="تنبيه أو حظر" value={summary.blockedOrWarning} tone={summary.blockedOrWarning > 0 ? 'danger' : 'default'} />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[1fr_180px_180px]">
          <label className="relative block">
            <span className="sr-only">البحث في العميلات</span>
            <Search aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={filters.search}
              onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
              placeholder="ابحثي بالاسم أو الهاتف أو العنوان"
              className="h-12 w-full rounded-xl border border-slate-200 bg-stone-50 pr-11 text-sm outline-none transition focus-visible:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500/30"
            />
          </label>

          <label>
            <span className="sr-only">تصنيف العميلة</span>
            <select
              value={filters.status}
              onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as CustomerFilters['status'] }))}
              className="h-12 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-sm outline-none transition focus-visible:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500/30"
            >
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {status === 'all' ? 'كل التصنيفات' : statusLabels[status]}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="sr-only">رصيد العميلة</span>
            <select
              value={filters.balance}
              onChange={(event) => setFilters((current) => ({ ...current, balance: event.target.value as CustomerFilters['balance'] }))}
              className="h-12 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-sm outline-none transition focus-visible:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500/30"
            >
              <option value="all">كل الأرصدة</option>
              <option value="with_balance">عليهن متبقي</option>
              <option value="clear">بدون متبقي</option>
            </select>
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-bold text-slate-600">{filteredCustomers.length} عميلة</p>
        <ViewModeToggle mode={viewMode} onChange={setViewMode} />
      </div>

      {filteredCustomers.length > 0 ? (
        viewMode === 'grid' ? (
          <div className="grid gap-5 xl:grid-cols-2">
            {filteredCustomers.map((customer) => (
              <CustomerCard key={customer.id} customer={customer} onArchive={handleArchive} onDelete={handleDelete} />
            ))}
          </div>
        ) : (
          <ul className="space-y-2">
            {filteredCustomers.map((customer) => (
              <li key={customer.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-slate-900">{customer.name}</span>
                  <span className="block truncate text-xs text-slate-500" dir="ltr">{customer.phone}</span>
                </span>
                <span className="shrink-0 text-left">
                  <span className={`block rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ${statusStyles[customer.status]}`}>
                    {statusLabels[customer.status]}
                  </span>
                  {customer.remainingBalance > 0 && (
                    <span className="mt-1 block text-xs font-bold text-rose-700">{formatMoneyOMR(customer.remainingBalance)}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
          <CircleAlert aria-hidden="true" className="mx-auto h-10 w-10 text-amber-700" />
          <p className="mt-4 text-lg font-bold text-slate-950">
            {customers.length === 0 ? 'لا توجد عميلات حتى الآن' : 'لا توجد عميلات مطابقات'}
          </p>
          <p className="mt-2 text-sm text-slate-500">
            {customers.length === 0 ? 'ابدئي بإضافة أول عميلة وحفظ بيانات التواصل والمقاسات.' : 'غيّري البحث أو الفلاتر الحالية لعرض نتائج أخرى.'}
          </p>
          {customers.length === 0 && (
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              إضافة أول عميلة
            </button>
          )}
        </div>
      )}

      <AddCustomerModal open={showCreateModal} onClose={() => setShowCreateModal(false)} onCreated={handleCreated} />
    </section>
  );
}
