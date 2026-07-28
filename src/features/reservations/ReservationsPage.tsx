import { useMemo, useState } from 'react';
import { CalendarCheck, CircleAlert, Plus, Printer, Search, XCircle } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../../components/shared/PageHeader';
import { SummaryCard } from '../../components/shared/SummaryCard';
import { RESERVATION_STATUS_LABELS, RESERVATION_STATUS_STYLES } from '../../shared/domain/reservationConstants';
import { formatMoneyOMR } from '../../shared/utils/format';
import { CreateReservationModal } from './CreateReservationModal';
import { cancelReservationCommand } from '../workflows';
import { filterReservations, getReservations, summarizeReservations } from './reservation.service';
import { ReservationCalendar } from './ReservationCalendar';
import { printRentalContract } from './printRentalContract';
import type { Reservation, ReservationFilters } from './reservation.types';

function ReservationCard({ reservation, onCancel, onPrint }: { reservation: Reservation; onCancel: (id: string) => void; onPrint: (reservation: Reservation) => void }) {
  const canCancel = ['pending', 'confirmed'].includes(reservation.status) && reservation.paidAmount === 0;

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-bold text-slate-400">{reservation.reservationNumber}</p>
          <h2 className="mt-1 text-lg font-bold text-slate-950">{reservation.customerName}</h2>
          <p className="mt-1 text-sm text-slate-600">{reservation.customerPhone}</p>
          <p className="mt-2 text-sm font-medium text-slate-700">{reservation.dressCode} — {reservation.dressName}</p>
        </div>
        <span className={`w-fit rounded-full px-3 py-1 text-xs font-bold ring-1 ${RESERVATION_STATUS_STYLES[reservation.status]}`}>
          {RESERVATION_STATUS_LABELS[reservation.status]}
        </span>
      </div>

      <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-2 xl:grid-cols-4">
        <div><p className="text-xs font-bold text-slate-400">الاستلام</p><p className="mt-1 text-sm font-semibold text-slate-800">{reservation.pickupDate}</p></div>
        <div><p className="text-xs font-bold text-slate-400">الإرجاع</p><p className="mt-1 text-sm font-semibold text-slate-800">{reservation.returnDate}</p></div>
        <div><p className="text-xs font-bold text-slate-400">الإجمالي</p><p className="mt-1 text-sm font-bold text-slate-950">{formatMoneyOMR(reservation.totalAmount)}</p></div>
        <div><p className="text-xs font-bold text-slate-400">المتبقي</p><p className={`mt-1 text-sm font-bold ${reservation.remainingAmount > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{formatMoneyOMR(reservation.remainingAmount)}</p></div>
      </div>

      {reservation.notes && <p className="mt-4 rounded-xl bg-stone-50 p-3 text-sm leading-6 text-slate-600">{reservation.notes}</p>}
      <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
        <button type="button" onClick={() => onPrint(reservation)} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-stone-100"><Printer aria-hidden="true" className="h-4 w-4" />طباعة العقد</button>
      </div>
      {canCancel && <div className="mt-2 flex justify-end"><button type="button" onClick={() => onCancel(reservation.id)} className="inline-flex min-h-10 items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-slate-500 transition hover:bg-rose-50 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 focus-visible:ring-offset-2"><XCircle aria-hidden="true" className="h-4 w-4" />إلغاء الحجز</button></div>}
    </article>
  );
}

export function ReservationsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [reservations, setReservations] = useState<Reservation[]>(() => getReservations());
  const [filters, setFilters] = useState<ReservationFilters>({ search: '', status: 'all', timing: 'all' });
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'danger'; message: string } | null>(null);

  const showCreateModal = searchParams.get('new') === '1';
  const filteredReservations = useMemo(() => filterReservations(reservations, filters), [reservations, filters]);
  const summary = useMemo(() => summarizeReservations(reservations), [reservations]);
  const openCreateModal = () => { setFeedback(null); const nextParams = new URLSearchParams(searchParams); nextParams.set('new', '1'); setSearchParams(nextParams); };
  const closeCreateModal = () => { const nextParams = new URLSearchParams(searchParams); nextParams.delete('new'); setSearchParams(nextParams, { replace: true }); };
  const handleCreated = (reservation: Reservation) => { setReservations((current) => [reservation, ...current]); setFeedback({ tone: 'success', message: `تم إنشاء الحجز ${reservation.reservationNumber} بنجاح.` }); };
  const handleCancel = (id: string) => {
    const reservation = reservations.find((item) => item.id === id);
    if (!reservation || !window.confirm(`هل تريدين إلغاء الحجز ${reservation.reservationNumber}؟`)) return;
    try { cancelReservationCommand(id); setReservations(getReservations()); setFeedback({ tone: 'success', message: `تم إلغاء الحجز ${reservation.reservationNumber}.` }); }
    catch (error: unknown) { setFeedback({ tone: 'danger', message: error instanceof Error ? error.message : 'تعذر إلغاء الحجز.' }); }
  };
  const handlePrint = (reservation: Reservation) => {
    try { printRentalContract(reservation); }
    catch (error: unknown) { setFeedback({ tone: 'danger', message: error instanceof Error ? error.message : 'تعذر طباعة العقد.' }); }
  };

  return <section className="space-y-6">
    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between"><PageHeader eyebrow="الحجوزات" title="إدارة الحجوزات" description="إنشاء الحجوزات، منع التعارضات، ومتابعة مواعيد الاستلام والإرجاع." /><button type="button" onClick={openCreateModal} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"><Plus aria-hidden="true" className="h-5 w-5" />حجز جديد</button></div>
    {feedback && <div role="status" className={`rounded-xl border px-4 py-3 text-sm font-bold ${feedback.tone === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>{feedback.message}</div>}
    <div className="grid grid-cols-2 gap-4 xl:grid-cols-4"><SummaryCard label="إجمالي الحجوزات" value={summary.total} /><SummaryCard label="الحجوزات النشطة" value={summary.active} tone="positive" /><SummaryCard label="عمليات اليوم" value={summary.today} hint="استلام أو إرجاع" /><SummaryCard label="متأخرة" value={summary.overdue} tone={summary.overdue > 0 ? 'danger' : 'default'} /></div>
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="grid gap-3 lg:grid-cols-[1fr_190px_190px]">
      <label className="relative block"><span className="sr-only">البحث في الحجوزات</span><Search aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" /><input type="search" value={filters.search} onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))} placeholder="ابحثي برقم الحجز أو العميلة أو العنصر" className="h-12 w-full rounded-xl border border-slate-200 bg-stone-50 pr-11 text-sm outline-none transition focus-visible:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500/30" /></label>
      <label><span className="sr-only">حالة الحجز</span><select value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as ReservationFilters['status'] }))} className="h-12 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-sm outline-none transition focus-visible:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500/30"><option value="all">كل الحالات</option>{Object.entries(RESERVATION_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label><span className="sr-only">توقيت الحجز</span><select value={filters.timing} onChange={(event) => setFilters((current) => ({ ...current, timing: event.target.value as ReservationFilters['timing'] }))} className="h-12 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-sm outline-none transition focus-visible:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500/30"><option value="all">كل المواعيد</option><option value="today">اليوم</option><option value="upcoming">القادمة</option><option value="overdue">المتأخرة</option></select></label>
    </div></div>
    <ReservationCalendar reservations={reservations} />
    {filteredReservations.length > 0 ? <div className="grid gap-4 xl:grid-cols-2">{filteredReservations.map((reservation) => <ReservationCard key={reservation.id} reservation={reservation} onCancel={handleCancel} onPrint={handlePrint} />)}</div> : <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">{reservations.length === 0 ? <><CalendarCheck aria-hidden="true" className="mx-auto h-10 w-10 text-amber-700" /><p className="mt-4 text-lg font-bold text-slate-950">لا توجد حجوزات حتى الآن</p><p className="mt-2 text-sm text-slate-500">ابدئي بإنشاء أول حجز وربطه بعميلة وفستان وفترة واضحة.</p><button type="button" onClick={openCreateModal} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white"><Plus aria-hidden="true" className="h-4 w-4" />إنشاء أول حجز</button></> : <><CircleAlert aria-hidden="true" className="mx-auto h-10 w-10 text-amber-700" /><p className="mt-4 text-lg font-bold text-slate-950">لا توجد حجوزات مطابقة</p><p className="mt-2 text-sm text-slate-500">غيّري البحث أو الفلاتر الحالية لعرض نتائج أخرى.</p></>}</div>}
    <CreateReservationModal open={showCreateModal} onClose={closeCreateModal} onCreated={handleCreated} />
  </section>;
}
