import { addDaysISO, formatTimeLabel, getTodayISO, parseLocalDate } from '../../shared/utils/date';
import { isActiveReservation } from './reservationConflicts';
import { getReservationTimes } from './reservation.service';
import type { Reservation, ReservationStatus } from './reservation.types';

/**
 * Reservation calendar model.
 *
 * Occupancy is derived from the reservations and their dates; nothing is read
 * from a stored `reserved` flag on the item. Every date is built through the
 * local-time helpers, so a showroom in any timezone sees the booking on the day
 * it actually happens instead of one day off.
 */

export type CalendarView = 'month' | 'week' | 'day';

export type CalendarEntryKind = 'pickup' | 'return' | 'ongoing';

export type CalendarEntry = {
  reservation: Reservation;
  kind: CalendarEntryKind;
  /** `HH:MM` for pickups/returns; undefined for a mid-rental day. */
  time?: string;
  timeLabel?: string;
};

export type CalendarDay = {
  date: string;
  inCurrentPeriod: boolean;
  isToday: boolean;
  entries: CalendarEntry[];
  pickups: Reservation[];
  returns: Reservation[];
  ongoing: Reservation[];
};

export type CalendarGrid = {
  view: CalendarView;
  /** ISO date anchoring the visible period. */
  anchorDate: string;
  label: string;
  days: CalendarDay[];
};

export type CalendarFilters = {
  statuses: ReservationStatus[];
  /** Inventory item id or item code. */
  dress: string;
  /** Customer id, name fragment or phone fragment. */
  customer: string;
  from: string;
  to: string;
};

export const EMPTY_CALENDAR_FILTERS: CalendarFilters = {
  statuses: [],
  dress: '',
  customer: '',
  from: '',
  to: '',
};

const MONTH_LABELS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

/** Sunday-first week labels, matching the showroom's working week. */
export const WEEKDAY_LABELS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

export const CALENDAR_VIEW_LABELS: Record<CalendarView, string> = {
  month: 'شهري',
  week: 'أسبوعي',
  day: 'يومي',
};

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + month + delta;
  return { year: Math.floor(total / 12), month: ((total % 12) + 12) % 12 };
}

/** Moves the anchor by one period of the active view. */
export function shiftAnchor(anchorDate: string, view: CalendarView, delta: number): string {
  if (view === 'day') return addDaysISO(anchorDate, delta);
  if (view === 'week') return addDaysISO(anchorDate, delta * 7);
  const current = parseLocalDate(anchorDate);
  const { year, month } = shiftMonth(current.getFullYear(), current.getMonth(), delta);
  const lastDay = new Date(year, month + 1, 0).getDate();
  return getTodayISO(new Date(year, month, Math.min(current.getDate(), lastDay)));
}

export function matchesCalendarFilters(reservation: Reservation, filters: CalendarFilters): boolean {
  if (filters.statuses.length > 0 && !filters.statuses.includes(reservation.status)) return false;

  if (filters.dress) {
    const needle = filters.dress.trim().toLowerCase();
    const matchesDress = reservation.inventoryItemId === filters.dress
      || reservation.dressCode.toLowerCase().includes(needle)
      || reservation.dressName.toLowerCase().includes(needle);
    if (!matchesDress) return false;
  }

  if (filters.customer) {
    const needle = filters.customer.trim().toLowerCase();
    const matchesCustomer = reservation.customerId === filters.customer
      || reservation.customerName.toLowerCase().includes(needle)
      || reservation.customerPhone.toLowerCase().includes(needle);
    if (!matchesCustomer) return false;
  }

  // A reservation is inside the range when its period intersects it.
  if (filters.from && reservation.returnDate < filters.from) return false;
  if (filters.to && reservation.pickupDate > filters.to) return false;

  return true;
}

export function filterCalendarReservations(reservations: Reservation[], filters: CalendarFilters): Reservation[] {
  return reservations.filter((reservation) => matchesCalendarFilters(reservation, filters));
}

function buildEntries(reservations: Reservation[], date: string): CalendarEntry[] {
  const entries: CalendarEntry[] = [];

  reservations.forEach((reservation) => {
    const times = getReservationTimes(reservation);
    if (reservation.pickupDate === date) {
      entries.push({ reservation, kind: 'pickup', time: times.pickupTime, timeLabel: formatTimeLabel(times.pickupTime) });
    }
    if (reservation.returnDate === date) {
      entries.push({ reservation, kind: 'return', time: times.returnTime, timeLabel: formatTimeLabel(times.returnTime) });
    }
    if (reservation.pickupDate < date && date < reservation.returnDate) {
      entries.push({ reservation, kind: 'ongoing' });
    }
  });

  return entries.sort((left, right) => (left.time ?? '99:99').localeCompare(right.time ?? '99:99'));
}

function buildDay(reservations: Reservation[], date: string, inCurrentPeriod: boolean, today: string): CalendarDay {
  const entries = buildEntries(reservations, date);
  return {
    date,
    inCurrentPeriod,
    isToday: date === today,
    entries,
    pickups: entries.filter((entry) => entry.kind === 'pickup').map((entry) => entry.reservation),
    returns: entries.filter((entry) => entry.kind === 'return').map((entry) => entry.reservation),
    ongoing: entries.filter((entry) => entry.kind === 'ongoing').map((entry) => entry.reservation),
  };
}

/** Sunday-anchored start of the week containing `date`. */
export function startOfWeek(date: string): string {
  const current = parseLocalDate(date);
  return addDaysISO(date, -current.getDay());
}

export function buildCalendarGrid(
  reservations: Reservation[],
  view: CalendarView,
  anchorDate: string,
  filters: CalendarFilters = EMPTY_CALENDAR_FILTERS,
): CalendarGrid {
  const today = getTodayISO();
  // Cancelled reservations are shown only when explicitly requested, so the
  // default calendar reflects what actually blocks the showroom.
  const visible = filterCalendarReservations(reservations, filters)
    .filter((reservation) => isActiveReservation(reservation) || filters.statuses.includes(reservation.status));

  if (view === 'day') {
    return {
      view,
      anchorDate,
      label: formatDayLabel(anchorDate),
      days: [buildDay(visible, anchorDate, true, today)],
    };
  }

  if (view === 'week') {
    const weekStart = startOfWeek(anchorDate);
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = addDaysISO(weekStart, index);
      return buildDay(visible, date, true, today);
    });
    return {
      view,
      anchorDate,
      label: `${formatDayLabel(weekStart)} — ${formatDayLabel(addDaysISO(weekStart, 6))}`,
      days,
    };
  }

  const anchor = parseLocalDate(anchorDate);
  const year = anchor.getFullYear();
  const month = anchor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = getTodayISO(new Date(year, month, 1 - firstOfMonth.getDay()));
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = addDaysISO(gridStart, index);
    const current = parseLocalDate(date);
    return buildDay(visible, date, current.getMonth() === month && current.getFullYear() === year, today);
  });

  return { view, anchorDate, label: `${MONTH_LABELS[month]} ${year}`, days };
}

export function formatDayLabel(date: string): string {
  const parsed = parseLocalDate(date);
  return `${WEEKDAY_LABELS[parsed.getDay()]} ${parsed.getDate()} ${MONTH_LABELS[parsed.getMonth()]} ${parsed.getFullYear()}`;
}

/** True when the item is occupied on that date according to the reservations. */
export function isItemOccupiedOn(reservations: Reservation[], dressCode: string, date: string): boolean {
  return reservations.some((reservation) => reservation.dressCode === dressCode
    && isActiveReservation(reservation)
    && reservation.pickupDate <= date
    && date <= reservation.returnDate);
}

/** Legacy month-grid helper kept for callers that only need a month view. */
export function buildCalendarMonth(reservations: Reservation[], year: number, month: number): CalendarGrid {
  return buildCalendarGrid(reservations, 'month', getTodayISO(new Date(year, month, 1)));
}
