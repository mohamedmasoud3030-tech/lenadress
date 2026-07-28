import { readCollection } from '../../services/localDatabase';
import { isActiveDayClosing } from '../../shared/utils/dailyClosingCalculations.js';
import { getTodayISO } from '../../shared/utils/date';
import type { DressStatus } from '../dresses/dress.types';
import type { Reservation } from '../reservations/reservation.types';
import type { DayCloseRecord } from '../reports/report.types';

const activeReservationStatuses = new Set<Reservation['status']>(['pending', 'confirmed', 'delivered', 'overdue']);

function getStoredReservations(): Reservation[] {
  return readCollection<Reservation>('reservations', []);
}

export function assertBusinessDateOpen(businessDate: string): void {
  const isClosed = readCollection<DayCloseRecord>('daily-closings', [])
    .some((closing) => closing.businessDate === businessDate && isActiveDayClosing(closing.status));

  if (isClosed) {
    throw new Error(`تم إقفال يومية ${businessDate}. أعيدي فتح اليومية قبل تسجيل أو تعديل أي حركة مالية تخص هذا التاريخ.`);
  }
}

export function getDressArchiveBlockers(dressCode: string, status: DressStatus): string[] {
  const blockers: string[] = [];

  if (status === 'rented') blockers.push('العنصر مؤجر حالياً ولم يتم استرجاعه بعد.');
  if (status === 'sold') blockers.push('العنصر مسجل كمباع ولا يمكن إيقافه من المخزون.');

  const today = getTodayISO();
  const relatedReservation = getStoredReservations().find(
    (reservation) => reservation.dressCode === dressCode
      && activeReservationStatuses.has(reservation.status)
      && reservation.returnDate >= today,
  );

  if (relatedReservation) {
    blockers.push(`يوجد حجز نشط أو قادم مرتبط بالعنصر: ${relatedReservation.reservationNumber}.`);
  }

  return blockers;
}

/**
 * Hard delete is only allowed for an item with no operational or financial
 * history at all. Anything referenced anywhere must be archived instead.
 */
export function getDressHardDeleteBlockers(dressCode: string, status: DressStatus): string[] {
  const blockers = getDressArchiveBlockers(dressCode, status);

  const hasAnyReservation = getStoredReservations().some((reservation) => reservation.dressCode === dressCode);
  if (hasAnyReservation) blockers.push('يوجد سجل حجز مرتبط بالعنصر.');

  const referencingCollections: Array<[string, string]> = [
    ['sales', 'يوجد سجل بيع مرتبط بالعنصر.'],
    ['sales-invoices', 'يوجد سجل فاتورة مبيعات مرتبط بالعنصر.'],
    ['sale-returns', 'يوجد سجل مرتجع بيع مرتبط بالعنصر.'],
    ['payments', 'توجد حركة مالية مرتبطة بالعنصر.'],
    ['expenses', 'يوجد مصروف مرتبط بالعنصر.'],
    ['delivery-return', 'يوجد سجل تسليم أو استرجاع مرتبط بالعنصر.'],
    ['service-tasks', 'توجد مهمة خدمة مرتبطة بالعنصر.'],
  ];

  referencingCollections.forEach(([collection, message]) => {
    const referenced = readCollection<Record<string, unknown>>(collection, []).some((record) => {
      const codes = [record.dressCode, record.relatedDressCode, record.itemCode];
      const lines = Array.isArray(record.lines) ? (record.lines as Array<Record<string, unknown>>) : [];
      return codes.includes(dressCode) || lines.some((line) => line.dressCode === dressCode);
    });
    if (referenced) blockers.push(message);
  });

  return Array.from(new Set(blockers));
}

export function assertDressCanBeArchived(dressCode: string, status: DressStatus): void {
  const blockers = getDressArchiveBlockers(dressCode, status);
  if (blockers.length > 0) throw new Error(blockers.join(' '));
}

/**
 * A customer with any history — reservation, payment, sale, or outstanding
 * balance — must never be hard-deleted.
 */
export function getCustomerHardDeleteBlockers(customerId: string, customerPhone: string): string[] {
  const blockers: string[] = [];
  const normalizedPhone = customerPhone.replace(/\D/g, '');

  const matches = (record: Record<string, unknown>): boolean => {
    if (typeof record.customerId === 'string' && record.customerId) return record.customerId === customerId;
    const phone = typeof record.customerPhone === 'string' ? record.customerPhone.replace(/\D/g, '') : '';
    return Boolean(normalizedPhone) && phone === normalizedPhone;
  };

  const relatedReservations = getStoredReservations().filter((reservation) => matches(reservation as unknown as Record<string, unknown>));
  if (relatedReservations.length > 0) blockers.push('يوجد سجل حجز مرتبط بالعميلة.');
  if (relatedReservations.some((reservation) => reservation.status !== 'cancelled' && reservation.remainingAmount > 0)) {
    blockers.push('يوجد رصيد مستحق على العميلة.');
  }

  const referencingCollections: Array<[string, string]> = [
    ['payments', 'توجد حركة مالية مرتبطة بالعميلة.'],
    ['sales', 'يوجد سجل بيع مرتبط بالعميلة.'],
    ['sales-invoices', 'توجد فاتورة مبيعات مرتبطة بالعميلة.'],
    ['sale-returns', 'يوجد مرتجع بيع مرتبط بالعميلة.'],
    ['delivery-return', 'يوجد سجل تسليم أو استرجاع مرتبط بالعميلة.'],
    ['appointments', 'يوجد موعد مرتبط بالعميلة.'],
  ];

  referencingCollections.forEach(([collection, message]) => {
    if (readCollection<Record<string, unknown>>(collection, []).some(matches)) blockers.push(message);
  });

  return Array.from(new Set(blockers));
}

export function assertReservationCanBeCancelled(reservation: Reservation): void {
  if (reservation.status === 'delivered' || reservation.status === 'returned' || reservation.status === 'overdue') {
    throw new Error('لا يمكن إلغاء الحجز بعد التسليم أو بعد تجاوز موعد الإرجاع. استخدمي مسار الاسترجاع والتسوية.');
  }

  if (reservation.paidAmount > 0) {
    throw new Error('لا يمكن إلغاء الحجز قبل تسوية المبالغ المحصلة أو تسجيل الاسترجاع المالي.');
  }
}
