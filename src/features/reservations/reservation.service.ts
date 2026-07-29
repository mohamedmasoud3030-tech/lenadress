import { generateId, generateNumber, readCollection, writeCollection } from '../../services/localDatabase';
import { getTodayISO, isValidTime } from '../../shared/utils/date';
import { calculateReservationRemainingAmount } from '../../shared/utils/financialCalculations.js';
import { getReservationAccessories, releaseAccessoriesForReservation } from '../accessories/reservationAccessory.service';
import { recordAudit } from '../audit/audit.service';
import { getCustomers } from '../customers/customer.service';
import { getDresses } from '../dresses/dress.service';
import { assertReservationCanBeCancelled } from '../integrity/integrity.service';
import { getAppPreferences } from '../preferences/preferences.service';
import {
  ACTIVE_RESERVATION_STATUSES,
  assertNoConflicts,
  findAccessoryConflicts,
  findItemConflicts,
} from './reservationConflicts';
import type {
  AvailabilityCheck,
  Reservation,
  ReservationFilters,
  ReservationSummary,
  RescheduleReservationInput,
} from './reservation.types';
import { createSearchMatcher } from '../../shared/utils/search';

const COLLECTION = 'reservations';
const activeStatuses = ACTIVE_RESERVATION_STATUSES;
const reservableDressStatuses = new Set(['available', 'reserved', 'rented']);
type CreateReservationInput = { customerId: string; dressId: string; pickupDate: string; pickupTime?: string; returnDate: string; returnTime?: string; depositAmount: number; /** Agreed price when a discount is granted; defaults to the catalogue price. */ rentalPrice?: number; notes?: string };
type ReservationPaymentType = 'rental' | 'deposit' | 'penalty' | 'refund' | 'adjustment';
type RecordReservationPaymentInput = { reservationNumber: string; type: ReservationPaymentType; direction: 'income' | 'refund'; amount: number };
type SettleReservationReturnInput = { reservationNumber: string; lateFee: number; damageFee: number; refundAmount: number; settledDepositAmount: number; retainedDepositAmount: number };

function remaining(reservation: Reservation): number { return calculateReservationRemainingAmount({ totalAmount: reservation.totalAmount, assessedFeesAmount: reservation.assessedFeesAmount, paidAmount: reservation.paidAmount, settledDepositAmount: reservation.settledDepositAmount, refundedAmount: reservation.refundedAmount }); }
function persist(reservations: Reservation[], updated: Reservation): Reservation { const next = { ...updated, remainingAmount: remaining(updated) }; writeCollection(COLLECTION, reservations.map((item) => item.id === next.id ? next : item)); return next; }
function hydrateOverdueStatus(reservation: Reservation): Reservation { return reservation.returnDate < getTodayISO() && ['pending', 'confirmed', 'delivered'].includes(reservation.status) ? { ...reservation, status: 'overdue' } : reservation; }
export function getReservationBufferDays(): number { return getAppPreferences().reservationBufferDays; }
export function getReservationTimeDefaults(): { pickupTime: string; returnTime: string } { const preferences = getAppPreferences(); return { pickupTime: preferences.defaultPickupTime, returnTime: preferences.defaultReturnTime }; }
/** Effective pickup/return times, filling the configured defaults when unset. */
export function getReservationTimes(reservation: Reservation): { pickupTime: string; returnTime: string } { const defaults = getReservationTimeDefaults(); return { pickupTime: isValidTime(reservation.pickupTime) ? reservation.pickupTime : defaults.pickupTime, returnTime: isValidTime(reservation.returnTime) ? reservation.returnTime : defaults.returnTime }; }
function normalizeTimeInput(value: string | undefined, label: string): string | undefined { if (value === undefined || value === '') return undefined; if (!isValidTime(value)) throw new Error(`${label} غير صالح. استخدمي صيغة HH:MM.`); return value; }
export function getReservations(): Reservation[] { return readCollection<Reservation>(COLLECTION, []).map(hydrateOverdueStatus); }

export function filterReservations(reservations: Reservation[], filters: ReservationFilters): Reservation[] {
  const matchesQuery = createSearchMatcher(filters.search); const today = getTodayISO();
  return reservations.filter((item) => matchesQuery([item.reservationNumber, item.customerName, item.customerPhone, item.dressCode, item.dressName]) && (filters.status === 'all' || item.status === filters.status) && (filters.timing === 'all' || (filters.timing === 'today' && (item.pickupDate === today || item.returnDate === today)) || (filters.timing === 'upcoming' && item.pickupDate > today) || (filters.timing === 'overdue' && item.status === 'overdue')));
}
export function summarizeReservations(reservations: Reservation[]): ReservationSummary { const today = getTodayISO(); return { total: reservations.length, active: reservations.filter((item) => activeStatuses.has(item.status)).length, today: reservations.filter((item) => item.pickupDate === today || item.returnDate === today).length, overdue: reservations.filter((item) => item.status === 'overdue').length }; }
/**
 * Availability is answered by the central conflict module, so the reservation
 * screen, the calendar, the service queue and the write path can never disagree.
 */
export function hasReservationOverlap(check: AvailabilityCheck, reservations: Reservation[]): boolean { return findItemConflicts(check, reservations).length > 0; }

export function createReservation(input: CreateReservationInput): Reservation {
  const customer = getCustomers().find((item) => item.id === input.customerId); const dress = getDresses().find((item) => item.id === input.dressId); const today = getTodayISO();
  if (!customer) throw new Error('العميلة المحددة غير موجودة.');
  if (customer.status === 'blocked') throw new Error('لا يمكن إنشاء حجز لعميلة محظورة قبل تسوية حالتها.');
  if (!dress) throw new Error('العنصر المحدد غير موجود.');
  if (!dress.isForRent || !reservableDressStatuses.has(dress.status)) throw new Error('العنصر غير مؤهل للإيجار حالياً.');
  if (!input.pickupDate || !input.returnDate) throw new Error('حددي تاريخ الاستلام والإرجاع.');
  if (input.pickupDate < today) throw new Error('تاريخ الاستلام لا يمكن أن يكون في الماضي.');
  if (input.returnDate <= input.pickupDate) throw new Error('تاريخ الإرجاع يجب أن يكون بعد تاريخ الاستلام.');
  if (!Number.isFinite(input.depositAmount) || input.depositAmount < 0) throw new Error('قيمة العربون غير صالحة.');
  const reservations = getReservations();
  const pickupTime = normalizeTimeInput(input.pickupTime, 'وقت الاستلام');
  const returnTime = normalizeTimeInput(input.returnTime, 'وقت الإرجاع');
  // Central conflict guard: the same rule the UI previews, enforced before the write.
  assertNoConflicts(findItemConflicts({ inventoryItemId: dress.id, dressCode: dress.code, pickupDate: input.pickupDate, returnDate: input.returnDate }, reservations));
  const listRentalPrice = dress.rentalPrice;
  const agreedRentalPrice = input.rentalPrice ?? listRentalPrice;
  if (!Number.isFinite(agreedRentalPrice) || agreedRentalPrice < 0) throw new Error('قيمة الإيجار المتفق عليها غير صالحة.');
  if (agreedRentalPrice > listRentalPrice) throw new Error('قيمة الإيجار المتفق عليها لا يمكن أن تتجاوز السعر المسجل للعنصر.');
  const totalAmount = agreedRentalPrice + input.depositAmount;
  const reservation: Reservation = { id: generateId(), reservationNumber: generateNumber('RSV'), customerId: customer.id, inventoryItemId: dress.id, customerNameSnapshot: customer.name, customerPhoneSnapshot: customer.phone, dressCodeSnapshot: dress.code, dressNameSnapshot: dress.name, customerName: customer.name, customerPhone: customer.phone, dressCode: dress.code, dressName: dress.name, pickupDate: input.pickupDate, pickupTime, returnDate: input.returnDate, returnTime, status: 'confirmed', rentalPrice: agreedRentalPrice, listRentalPrice, depositAmount: input.depositAmount, totalAmount, paidAmount: 0, remainingAmount: totalAmount, assessedFeesAmount: 0, refundedAmount: 0, settledDepositAmount: 0, retainedDepositAmount: 0, notes: input.notes?.trim() || undefined };
  writeCollection(COLLECTION, [reservation, ...reservations]);
  recordAudit({ action: 'create', entityType: 'reservation', entityId: reservation.id, summary: `تم إنشاء الحجز ${reservation.reservationNumber} للفستان ${reservation.dressCode}.`, nextValues: { pickupDate: reservation.pickupDate, returnDate: reservation.returnDate, totalAmount } });
  return reservation;
}

/**
 * Moves a reservation to a new period, optionally onto a different item, and
 * re-checks every attached accessory against the new dates.
 *
 * Extending the rental is the same operation with a later return date, so the
 * conflict rule is applied identically for a move, a swap and an extension.
 */
export function rescheduleReservation(input: RescheduleReservationInput): Reservation {
  const reservations = getReservations();
  const reservation = reservations.find((item) => item.reservationNumber === input.reservationNumber);
  if (!reservation) throw new Error('الحجز المحدد غير موجود.');
  if (reservation.status === 'cancelled' || reservation.status === 'returned') throw new Error('لا يمكن تعديل موعد حجز مغلق.');
  if (!input.pickupDate || !input.returnDate) throw new Error('حددي تاريخ الاستلام والإرجاع.');
  if (input.returnDate <= input.pickupDate) throw new Error('تاريخ الإرجاع يجب أن يكون بعد تاريخ الاستلام.');

  const pickupTime = normalizeTimeInput(input.pickupTime, 'وقت الاستلام');
  const returnTime = normalizeTimeInput(input.returnTime, 'وقت الإرجاع');

  let nextItem = { inventoryItemId: reservation.inventoryItemId, dressCode: reservation.dressCode, dressName: reservation.dressName, rentalPrice: reservation.rentalPrice, listRentalPrice: reservation.listRentalPrice ?? reservation.rentalPrice };
  if (input.dressId && input.dressId !== reservation.inventoryItemId) {
    if (reservation.status === 'delivered' || reservation.status === 'overdue') throw new Error('لا يمكن تغيير العنصر بعد التسليم.');
    const dress = getDresses().find((item) => item.id === input.dressId);
    if (!dress) throw new Error('العنصر المحدد غير موجود.');
    if (!dress.isForRent || !reservableDressStatuses.has(dress.status)) throw new Error('العنصر غير مؤهل للإيجار حالياً.');
    // Swapping the item re-prices the booking at the new item's catalogue price.
    nextItem = { inventoryItemId: dress.id, dressCode: dress.code, dressName: dress.name, rentalPrice: dress.rentalPrice, listRentalPrice: dress.rentalPrice };
  }

  assertNoConflicts(findItemConflicts({
    inventoryItemId: nextItem.inventoryItemId,
    dressCode: nextItem.dressCode,
    pickupDate: input.pickupDate,
    returnDate: input.returnDate,
    excludeReservationNumber: reservation.reservationNumber,
  }, reservations));

  const accessoryLinks = getReservationAccessories();
  accessoryLinks
    .filter((link) => link.reservationNumber === reservation.reservationNumber)
    .forEach((link) => assertNoConflicts(findAccessoryConflicts({
      accessoryId: link.accessoryId,
      pickupDate: input.pickupDate,
      returnDate: input.returnDate,
      excludeReservationNumber: reservation.reservationNumber,
    }, accessoryLinks, reservations)));

  const totalAmount = nextItem.rentalPrice + reservation.depositAmount;
  const updated = persist(reservations, {
    ...reservation,
    ...nextItem,
    pickupDate: input.pickupDate,
    pickupTime,
    returnDate: input.returnDate,
    returnTime,
    totalAmount,
  });

  recordAudit({
    action: 'update',
    entityType: 'reservation',
    entityId: reservation.id,
    summary: `تم تعديل موعد الحجز ${reservation.reservationNumber}.`,
    previousValues: { pickupDate: reservation.pickupDate, returnDate: reservation.returnDate, dressCode: reservation.dressCode },
    nextValues: { pickupDate: updated.pickupDate, returnDate: updated.returnDate, dressCode: updated.dressCode },
  });
  return updated;
}

export function recordReservationPayment(input: RecordReservationPaymentInput): Reservation {
  const reservations = getReservations(); const reservation = reservations.find((item) => item.reservationNumber === input.reservationNumber);
  if (!reservation) throw new Error('الحجز المحدد غير موجود.');
  if (reservation.status === 'cancelled') throw new Error('لا يمكن تسجيل حركة مالية على حجز ملغي.');
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('قيمة الدفعة يجب أن تكون أكبر من صفر.');
  if (input.type === 'refund' && input.direction !== 'refund') throw new Error('حركة الاسترجاع غير صالحة.');
  if (input.type !== 'refund' && input.direction === 'refund') throw new Error('اختاري نوع حركة مالية مناسب للاسترجاع.');
  if (input.direction === 'refund' && input.amount > reservation.paidAmount - (reservation.refundedAmount ?? 0)) throw new Error('قيمة الاسترجاع تتجاوز المبلغ المحصل فعلياً على الحجز.');
  const extra = input.type === 'penalty' || input.type === 'adjustment';
  if (input.direction === 'income' && !extra && input.amount > reservation.remainingAmount) throw new Error('قيمة الدفعة تتجاوز الرصيد المتبقي على الحجز.');
  return persist(reservations, { ...reservation, paidAmount: input.direction === 'income' ? reservation.paidAmount + input.amount : reservation.paidAmount, refundedAmount: (reservation.refundedAmount ?? 0) + (input.direction === 'refund' ? input.amount : 0), assessedFeesAmount: (reservation.assessedFeesAmount ?? 0) + (extra ? input.amount : 0) });
}

export function settleReservationReturn(input: SettleReservationReturnInput): Reservation {
  const reservations = getReservations(); const reservation = reservations.find((item) => item.reservationNumber === input.reservationNumber);
  if (!reservation) throw new Error('الحجز المحدد غير موجود.');
  if (!['delivered', 'overdue'].includes(reservation.status)) throw new Error('الحجز غير مؤهل لتسوية الاسترجاع حالياً.');
  if ((reservation.settledDepositAmount ?? 0) > 0) throw new Error('تمت تسوية عربون هذا الحجز بالفعل.');
  if (![input.lateFee, input.damageFee, input.refundAmount, input.settledDepositAmount, input.retainedDepositAmount].every((amount) => Number.isFinite(amount) && amount >= 0)) throw new Error('بيانات التسوية المالية غير صالحة.');
  if (input.refundAmount + input.retainedDepositAmount > input.settledDepositAmount) throw new Error('إجمالي رد العربون والعربون المحتجز يتجاوز قيمة العربون المسوّاة.');
  return persist(reservations, { ...reservation, assessedFeesAmount: (reservation.assessedFeesAmount ?? 0) + input.lateFee + input.damageFee, refundedAmount: (reservation.refundedAmount ?? 0) + input.refundAmount, settledDepositAmount: (reservation.settledDepositAmount ?? 0) + input.settledDepositAmount, retainedDepositAmount: (reservation.retainedDepositAmount ?? 0) + input.retainedDepositAmount });
}

export function cancelReservation(id: string): void {
  const reservations = getReservations(); const reservation = reservations.find((item) => item.id === id);
  if (!reservation) throw new Error('الحجز غير موجود.');
  if (reservation.status === 'cancelled') return;
  assertReservationCanBeCancelled(reservation);
  writeCollection(COLLECTION, reservations.map((item) => item.id === id ? { ...item, status: 'cancelled' as const } : item));
  // A cancelled reservation releases its item and every accessory that never left the showroom.
  releaseAccessoriesForReservation(reservation.reservationNumber);
  recordAudit({ action: 'cancel', entityType: 'reservation', entityId: reservation.id, summary: `تم إلغاء الحجز ${reservation.reservationNumber}.`, previousValues: { status: reservation.status }, nextValues: { status: 'cancelled' } });
}
