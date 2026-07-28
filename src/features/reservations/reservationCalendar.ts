import { getTodayISO } from '../../shared/utils/date';
import type { Reservation } from './reservation.types';

/**
 * Reservation calendar model.
 *
 * Rebuilt against the current public reservation API instead of restoring the
 * old widget: it derives occupancy from reservations and dates, so availability
 * is never read from a stored `reserved` item flag.
 */

export type CalendarDay = {
  date: string;
  inCurrentMonth: boolean;
  isToday: boolean;
  pickups: Reservation[];
  returns: Reservation[];
  ongoing: Reservation[];
};

export type CalendarMonth = {
  year: number;
  month: number;
  label: string;
  days: CalendarDay[];
};

const ACTIVE_STATUSES = new Set<Reservation['status']>(['pending', 'confirmed', 'delivered', 'overdue']);

const MONTH_LABELS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

/** Sunday-first week labels, matching the showroom's working week. */
export const WEEKDAY_LABELS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

function toISO(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

export function buildCalendarMonth(reservations: Reservation[], year: number, month: number): CalendarMonth {
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - firstOfMonth.getDay());
  const today = getTodayISO();

  const active = reservations.filter((reservation) => ACTIVE_STATUSES.has(reservation.status));

  const days: CalendarDay[] = Array.from({ length: 42 }, (_, index) => {
    const current = new Date(gridStart);
    current.setDate(gridStart.getDate() + index);
    const date = toISO(current.getFullYear(), current.getMonth(), current.getDate());

    return {
      date,
      inCurrentMonth: current.getMonth() === month && current.getFullYear() === year,
      isToday: date === today,
      pickups: active.filter((reservation) => reservation.pickupDate === date),
      returns: active.filter((reservation) => reservation.returnDate === date),
      ongoing: active.filter((reservation) => reservation.pickupDate < date && date < reservation.returnDate),
    };
  });

  return { year, month, label: `${MONTH_LABELS[month]} ${year}`, days };
}

/** True when the item is occupied on that date according to the reservations. */
export function isItemOccupiedOn(reservations: Reservation[], dressCode: string, date: string): boolean {
  return reservations.some((reservation) => reservation.dressCode === dressCode
    && ACTIVE_STATUSES.has(reservation.status)
    && reservation.pickupDate <= date
    && date <= reservation.returnDate);
}
