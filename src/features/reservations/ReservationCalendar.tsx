import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { WEEKDAY_LABELS, buildCalendarMonth, shiftMonth } from './reservationCalendar';
import type { Reservation } from './reservation.types';

type Props = { reservations: Reservation[] };

export function ReservationCalendar({ reservations }: Props) {
  const now = new Date();
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() });
  const calendar = useMemo(
    () => buildCalendarMonth(reservations, cursor.year, cursor.month),
    [reservations, cursor],
  );

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-base font-bold text-slate-950">تقويم الحجوزات</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label="الشهر السابق"
            onClick={() => setCursor((current) => shiftMonth(current.year, current.month, -1))}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-300 text-slate-700 transition hover:bg-stone-100"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="min-w-32 text-center text-sm font-bold text-slate-700">{calendar.label}</span>
          <button
            type="button"
            aria-label="الشهر التالي"
            onClick={() => setCursor((current) => shiftMonth(current.year, current.month, 1))}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-slate-300 text-slate-700 transition hover:bg-stone-100"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="mt-4 overflow-x-hidden">
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-bold text-slate-500">
          {WEEKDAY_LABELS.map((label) => (
            <span key={label} className="truncate py-1">{label}</span>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {calendar.days.map((day) => {
            const busy = day.pickups.length + day.returns.length + day.ongoing.length;
            return (
              <div
                key={day.date}
                className={`min-h-16 rounded-lg border p-1 text-right text-[11px] ${
                  day.inCurrentMonth ? 'border-slate-200 bg-white' : 'border-slate-100 bg-stone-50 text-slate-400'
                } ${day.isToday ? 'ring-2 ring-amber-500' : ''}`}
              >
                <span className="font-bold">{Number(day.date.slice(8, 10))}</span>
                {day.pickups.length > 0 ? (
                  <p className="mt-1 truncate rounded bg-emerald-50 px-1 text-emerald-700">تسليم {day.pickups.length}</p>
                ) : null}
                {day.returns.length > 0 ? (
                  <p className="mt-1 truncate rounded bg-amber-50 px-1 text-amber-700">إرجاع {day.returns.length}</p>
                ) : null}
                {day.ongoing.length > 0 ? (
                  <p className="mt-1 truncate rounded bg-violet-50 px-1 text-violet-700">جارٍ {day.ongoing.length}</p>
                ) : null}
                {busy === 0 && day.inCurrentMonth ? <span className="sr-only">لا توجد حركة</span> : null}
              </div>
            );
          })}
        </div>
      </div>

      <p className="mt-3 text-xs text-slate-500">
        التوافر محسوب من الحجوزات والتواريخ، وليس من حالة مخزّنة على القطعة.
      </p>
    </section>
  );
}
