import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getTodayISO } from '../../shared/utils/date';
import { RESERVATION_STATUS_LABELS, RESERVATION_STATUS_STYLES, RESERVATION_STATUS_DOT_STYLES } from '../../shared/domain/reservationConstants';
import { AMBER_FOCUS_RING_CLASS_NAME } from '../../shared/domain/formConstants';
import {
  CALENDAR_VIEW_LABELS,
  EMPTY_CALENDAR_FILTERS,
  WEEKDAY_LABELS,
  buildCalendarGrid,
  formatDayLabel,
  shiftAnchor,
  type CalendarDay,
  type CalendarEntry,
  type CalendarFilters,
  type CalendarView,
} from './reservationCalendar.model';
import type { Reservation, ReservationStatus } from './reservation.types';

type Props = {
  reservations: Reservation[];
  onOpenReservation?: (reservation: Reservation) => void;
};

const VIEWS: CalendarView[] = ['month', 'week', 'day'];

const STATUS_ORDER: ReservationStatus[] = ['pending', 'confirmed', 'delivered', 'overdue', 'returned', 'cancelled'];

const KIND_LABELS = {
  pickup: 'استلام',
  return: 'إرجاع',
  ongoing: 'جارٍ',
} as const;

const fieldClassName =
  'min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-950 outline-none transition focus-visible:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500/30';

function EntryChip({ entry, onOpen }: { entry: CalendarEntry; onOpen?: (reservation: Reservation) => void }) {
  const { reservation, kind, timeLabel } = entry;
  const label = `${KIND_LABELS[kind]}${timeLabel ? ` ${timeLabel}` : ''} — ${reservation.customerName} — ${reservation.dressCode}`;

  return (
    <button
      type="button"
      onClick={() => onOpen?.(reservation)}
      title={label}
      aria-label={`فتح الحجز ${reservation.reservationNumber}: ${label}`}
      className={`flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-right text-[11px] font-bold ring-1 transition hover:brightness-95 ${RESERVATION_STATUS_STYLES[reservation.status]} ${AMBER_FOCUS_RING_CLASS_NAME}`}
    >
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${RESERVATION_STATUS_DOT_STYLES[reservation.status]}`} />
      <span className="min-w-0 flex-1 truncate">
        {KIND_LABELS[kind]}
        {timeLabel ? ` ${timeLabel}` : ''} · {reservation.customerName}
      </span>
    </button>
  );
}

function DayCell({ day, view, onOpen }: { day: CalendarDay; view: CalendarView; onOpen?: (reservation: Reservation) => void }) {
  const dayNumber = Number(day.date.slice(8, 10));
  const visibleEntries = view === 'month' ? day.entries.slice(0, 3) : day.entries;
  const hiddenCount = day.entries.length - visibleEntries.length;

  return (
    <div
      className={`flex min-h-24 flex-col gap-1 rounded-xl border p-1.5 text-right ${
        day.inCurrentPeriod ? 'border-slate-200 bg-white' : 'border-slate-100 bg-stone-50 text-slate-400'
      } ${day.isToday ? 'ring-2 ring-amber-500' : ''}`}
    >
      <div className="flex items-baseline justify-between gap-1">
        <span className="text-xs font-extrabold text-slate-700">{dayNumber}</span>
        {day.entries.length > 0 && (
          <span className="rounded-full bg-slate-100 px-1.5 text-[10px] font-bold text-slate-600">{day.entries.length}</span>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        {visibleEntries.map((entry) => (
          <EntryChip key={`${entry.reservation.id}-${entry.kind}`} entry={entry} onOpen={onOpen} />
        ))}
        {hiddenCount > 0 && <span className="text-[10px] font-bold text-slate-500">+{hiddenCount} أخرى</span>}
        {day.entries.length === 0 && day.inCurrentPeriod && <span className="sr-only">لا توجد حركة</span>}
      </div>
    </div>
  );
}

function DayAgenda({ day, onOpen }: { day: CalendarDay; onOpen?: (reservation: Reservation) => void }) {
  if (day.entries.length === 0) {
    return <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">لا توجد حركة في هذا اليوم.</p>;
  }

  return (
    <ul className="space-y-2">
      {day.entries.map((entry) => (
        <li key={`${entry.reservation.id}-${entry.kind}`}>
          <button
            type="button"
            onClick={() => onOpen?.(entry.reservation)}
            aria-label={`فتح الحجز ${entry.reservation.reservationNumber}`}
            className={`flex w-full flex-col gap-1 rounded-2xl border border-slate-200 bg-white p-3 text-right transition hover:bg-stone-50 ${AMBER_FOCUS_RING_CLASS_NAME}`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-extrabold text-slate-950">{entry.reservation.customerName}</span>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ${RESERVATION_STATUS_STYLES[entry.reservation.status]}`}>
                {RESERVATION_STATUS_LABELS[entry.reservation.status]}
              </span>
            </div>
            <p className="text-xs font-bold text-slate-600">
              {KIND_LABELS[entry.kind]}
              {entry.timeLabel ? ` · ${entry.timeLabel}` : ''} · {entry.reservation.dressCode} — {entry.reservation.dressName}
            </p>
            <p className="text-[11px] font-bold text-slate-400">{entry.reservation.reservationNumber}</p>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function ReservationCalendar({ reservations, onOpenReservation }: Props) {
  const [view, setView] = useState<CalendarView>('month');
  const [anchorDate, setAnchorDate] = useState(() => getTodayISO());
  const [filters, setFilters] = useState<CalendarFilters>(EMPTY_CALENDAR_FILTERS);

  const grid = useMemo(
    () => buildCalendarGrid(reservations, view, anchorDate, filters),
    [reservations, view, anchorDate, filters],
  );

  const toggleStatus = (status: ReservationStatus) => {
    setFilters((current) => ({
      ...current,
      statuses: current.statuses.includes(status)
        ? current.statuses.filter((value) => value !== status)
        : [...current.statuses, status],
    }));
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" aria-label="تقويم الحجوزات">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-bold text-slate-950">تقويم الحجوزات</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="الفترة السابقة"
              onClick={() => setAnchorDate((current) => shiftAnchor(current, view, -1))}
              className={`flex h-11 w-11 items-center justify-center rounded-xl border border-slate-300 text-slate-700 transition hover:bg-stone-100 ${AMBER_FOCUS_RING_CLASS_NAME}`}
            >
              <ChevronRight aria-hidden="true" className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setAnchorDate(getTodayISO())}
              className={`min-h-11 rounded-xl border border-slate-300 px-3 text-sm font-bold text-slate-700 transition hover:bg-stone-100 ${AMBER_FOCUS_RING_CLASS_NAME}`}
            >
              اليوم
            </button>
            <button
              type="button"
              aria-label="الفترة التالية"
              onClick={() => setAnchorDate((current) => shiftAnchor(current, view, 1))}
              className={`flex h-11 w-11 items-center justify-center rounded-xl border border-slate-300 text-slate-700 transition hover:bg-stone-100 ${AMBER_FOCUS_RING_CLASS_NAME}`}
            >
              <ChevronLeft aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm font-extrabold text-slate-800">{grid.label}</p>
          <div role="group" aria-label="نمط عرض التقويم" className="flex rounded-2xl bg-slate-950 p-1 text-xs font-bold text-white">
            {VIEWS.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={view === option}
                onClick={() => setView(option)}
                className={`min-h-9 rounded-xl px-3 transition ${AMBER_FOCUS_RING_CLASS_NAME} ${view === option ? 'bg-amber-300 text-slate-950' : 'text-slate-300 hover:bg-white/10'}`}
              >
                {CALENDAR_VIEW_LABELS[option]}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <label className="block text-xs font-bold text-slate-600">
          الفستان أو الكود
          <input
            type="search"
            value={filters.dress}
            onChange={(event) => setFilters((current) => ({ ...current, dress: event.target.value }))}
            placeholder="كود أو اسم الفستان"
            className={`mt-1 ${fieldClassName}`}
          />
        </label>
        <label className="block text-xs font-bold text-slate-600">
          العميلة
          <input
            type="search"
            value={filters.customer}
            onChange={(event) => setFilters((current) => ({ ...current, customer: event.target.value }))}
            placeholder="اسم أو رقم العميلة"
            className={`mt-1 ${fieldClassName}`}
          />
        </label>
        <label className="block text-xs font-bold text-slate-600">
          من تاريخ
          <input
            type="date"
            value={filters.from}
            onChange={(event) => setFilters((current) => ({ ...current, from: event.target.value }))}
            className={`mt-1 ${fieldClassName}`}
          />
        </label>
        <label className="block text-xs font-bold text-slate-600">
          إلى تاريخ
          <input
            type="date"
            value={filters.to}
            onChange={(event) => setFilters((current) => ({ ...current, to: event.target.value }))}
            className={`mt-1 ${fieldClassName}`}
          />
        </label>
      </div>

      <div role="group" aria-label="فلترة حسب حالة الحجز" className="mt-3 flex flex-wrap gap-2">
        {STATUS_ORDER.map((status) => {
          const active = filters.statuses.includes(status);
          return (
            <button
              key={status}
              type="button"
              aria-pressed={active}
              onClick={() => toggleStatus(status)}
              className={`inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 text-xs font-bold ring-1 transition ${AMBER_FOCUS_RING_CLASS_NAME} ${
                active ? RESERVATION_STATUS_STYLES[status] : 'bg-white text-slate-500 ring-slate-200 hover:bg-stone-100'
              }`}
            >
              <span aria-hidden="true" className={`h-2 w-2 rounded-full ${RESERVATION_STATUS_DOT_STYLES[status]}`} />
              {RESERVATION_STATUS_LABELS[status]}
            </button>
          );
        })}
        {(filters.statuses.length > 0 || filters.dress || filters.customer || filters.from || filters.to) && (
          <button
            type="button"
            onClick={() => setFilters(EMPTY_CALENDAR_FILTERS)}
            className={`min-h-9 rounded-full border border-slate-300 px-3 text-xs font-bold text-slate-600 transition hover:bg-stone-100 ${AMBER_FOCUS_RING_CLASS_NAME}`}
          >
            مسح الفلاتر
          </button>
        )}
      </div>

      {view === 'day' ? (
        <div className="mt-4 space-y-3">
          <p className="text-sm font-bold text-slate-700">{formatDayLabel(grid.days[0].date)}</p>
          <DayAgenda day={grid.days[0]} onOpen={onOpenReservation} />
        </div>
      ) : (
        <>
          {/* Phones get a stacked agenda instead of an unreadable seven-column grid. */}
          <div className="mt-4 space-y-3 lg:hidden">
            {grid.days
              .filter((day) => day.inCurrentPeriod && day.entries.length > 0)
              .map((day) => (
                <div key={day.date} className="space-y-2">
                  <p className={`text-xs font-extrabold ${day.isToday ? 'text-amber-700' : 'text-slate-600'}`}>{formatDayLabel(day.date)}</p>
                  <DayAgenda day={day} onOpen={onOpenReservation} />
                </div>
              ))}
            {grid.days.every((day) => !day.inCurrentPeriod || day.entries.length === 0) && (
              <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">
                لا توجد حجوزات مطابقة في هذه الفترة.
              </p>
            )}
          </div>

          <div className="mt-4 hidden lg:block">
            <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold text-slate-500">
              {WEEKDAY_LABELS.map((label) => (
                <span key={label} className="truncate py-1">{label}</span>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {grid.days.map((day) => (
                <DayCell key={day.date} day={day} view={grid.view} onOpen={onOpenReservation} />
              ))}
            </div>
          </div>
        </>
      )}

      <p className="mt-3 text-xs text-slate-500">
        التوافر محسوب من الحجوزات والتواريخ بالتوقيت المحلي، وليس من حالة مخزّنة على القطعة.
      </p>
    </section>
  );
}
