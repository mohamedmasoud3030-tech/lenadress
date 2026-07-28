import type { ReservationStatus } from '../../features/reservations/reservation.types';

export const RESERVATION_STATUS_LABELS = {
  pending: 'بانتظار التأكيد',
  confirmed: 'مؤكد',
  delivered: 'تم التسليم',
  returned: 'تم الإرجاع',
  overdue: 'متأخر',
  cancelled: 'ملغي',
} satisfies Record<ReservationStatus, string>;

export const RESERVATION_STATUS_STYLES = {
  pending: 'bg-amber-50 text-amber-800 ring-amber-200',
  confirmed: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  delivered: 'bg-sky-50 text-sky-800 ring-sky-200',
  returned: 'bg-slate-100 text-slate-700 ring-slate-200',
  overdue: 'bg-rose-50 text-rose-800 ring-rose-200',
  cancelled: 'bg-slate-100 text-slate-500 ring-slate-200',
} satisfies Record<ReservationStatus, string>;

/**
 * Solid dot colours for calendar legends and chips. They are the 500-weight
 * partners of the badge styles above, so status colour stays one decision made
 * in one place instead of ad-hoc values inside components.
 */
export const RESERVATION_STATUS_DOT_STYLES = {
  pending: 'bg-amber-500',
  confirmed: 'bg-emerald-500',
  delivered: 'bg-sky-500',
  returned: 'bg-slate-400',
  overdue: 'bg-rose-500',
  cancelled: 'bg-slate-300',
} satisfies Record<ReservationStatus, string>;
