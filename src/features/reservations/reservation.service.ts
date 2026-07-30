import { generateId, generateNumber, readCollection, writeCollection } from '../../services/localDatabase';
import { getTodayISO, isValidTime } from '../../shared/utils/date';
import { calculateReservationRemainingAmount } from '../../shared/utils/financialCalculations.js';
import { getReservationAccessories, releaseAccessoriesForReservation } from '../accessories/reservationAccessory.service';
import { recordAudit } from '../audit/audit.service';
import { getCustomers } from '../customers/customer.service';
import { getDresses, updateDressStatus } from '../dresses/dress.service';
import { assertReservationCanBeCancelled } from '../integrity/integrity.service';
import { getAppPreferences } from '../preferences/preferences.service';
import {
  ACTIVE_RESERVATION_STATUSES,
  assertNoConflicts,
  findAccessoryConflicts,
  findItemConflicts,
} from './reservationConflicts';
import {
  buildLineFromInput,
  calculateLinesTotal,
  checkLineConflicts,
  assertNoLineConflicts,
  syncTopLevelFromLines,
  getReservationLines,
  deriveReservationStatus,
} from './contractLineHelpers';
import type {
  AvailabilityCheck,
  Reservation,
  ReservationFilters,
  ReservationSummary,
  RescheduleReservationInput,
  CreateReservationInput,
  CreateReservationLineInput,
  AddContractLineInput,
  RemoveContractLineInput,
  UpdateContractLineInput,
  ContractLine,
  LineDeliveryInput,
  LineReturnInput,
} from './reservation.types';
import { createSearchMatcher } from '../../shared/utils/search';

const COLLECTION = 'reservations';
const activeStatuses = ACTIVE_RESERVATION_STATUSES;
const reservableDressStatuses = new Set(['available', 'reserved', 'rented']);
type ReservationPaymentType = 'rental' | 'deposit' | 'penalty' | 'refund' | 'adjustment';
type RecordReservationPaymentInput = { reservationNumber: string; type: ReservationPaymentType; direction: 'income' | 'refund'; amount: number };
type SettleReservationReturnInput = { reservationNumber: string; lateFee: number; damageFee: number; refundAmount: number; settledDepositAmount: number; retainedDepositAmount: number };

function remaining(reservation: Reservation): number { return calculateReservationRemainingAmount({ totalAmount: reservation.totalAmount, assessedFeesAmount: reservation.assessedFeesAmount, paidAmount: reservation.paidAmount, settledDepositAmount: reservation.settledDepositAmount, refundedAmount: reservation.refundedAmount }); }
function persist(reservations: Reservation[], updated: Reservation): Reservation { const next = { ...updated, remainingAmount: remaining(updated) }; writeCollection(COLLECTION, reservations.map((item) => item.id === next.id ? next : item)); return next; }
function hydrateOverdueStatus(reservation: Reservation): Reservation {
  // For multi-item reservations, check if any line has a return date in the past
  // and is still out (delivered but not returned)
  const lines = getReservationLines(reservation);
  const hasOverdueLine = lines.some(
    (line) => line.returnDate < getTodayISO()
      && (line.deliveryStatus === 'delivered'),
  );

  if (hasOverdueLine && ['pending', 'confirmed', 'delivered'].includes(reservation.status)) {
    return { ...reservation, status: 'overdue' };
  }

  return reservation.returnDate < getTodayISO() && ['pending', 'confirmed', 'delivered'].includes(reservation.status) ? { ...reservation, status: 'overdue' } : reservation;
}
export function getReservationBufferDays(): number { return getAppPreferences().reservationBufferDays; }
export function getReservationTimeDefaults(): { pickupTime: string; returnTime: string } { const preferences = getAppPreferences(); return { pickupTime: preferences.defaultPickupTime, returnTime: preferences.defaultReturnTime }; }
/** Effective pickup/return times, filling the configured defaults when unset. */
export function getReservationTimes(reservation: Reservation): { pickupTime: string; returnTime: string } { const defaults = getReservationTimeDefaults(); return { pickupTime: isValidTime(reservation.pickupTime) ? reservation.pickupTime : defaults.pickupTime, returnTime: isValidTime(reservation.returnTime) ? reservation.returnTime : defaults.returnTime }; }
function normalizeTimeInput(value: string | undefined, label: string): string | undefined { if (value === undefined || value === '') return undefined; if (!isValidTime(value)) throw new Error(`${label} غير صالح. استخدمي صيغة HH:MM.`); return value; }
export function getReservations(): Reservation[] { return readCollection<Reservation>(COLLECTION, []).map(hydrateOverdueStatus); }

export function filterReservations(reservations: Reservation[], filters: ReservationFilters): Reservation[] {
  const matchesQuery = createSearchMatcher(filters.search); const today = getTodayISO();
  return reservations.filter((item) => {
    // Search matches across all line items in addition to top-level fields
    const lines = getReservationLines(item);
    const lineCodes = lines.map((line) => line.dressCodeSnapshot);
    const lineNames = lines.map((line) => line.dressNameSnapshot);
    const searchFields = [item.reservationNumber, item.customerName, item.customerPhone, item.dressCode, item.dressName, ...lineCodes, ...lineNames];
    return matchesQuery(searchFields)
      && (filters.status === 'all' || item.status === filters.status)
      && (filters.timing === 'all' || (filters.timing === 'today' && (item.pickupDate === today || item.returnDate === today)) || (filters.timing === 'upcoming' && item.pickupDate > today) || (filters.timing === 'overdue' && item.status === 'overdue'));
  });
}
export function summarizeReservations(reservations: Reservation[]): ReservationSummary { const today = getTodayISO(); return { total: reservations.length, active: reservations.filter((item) => activeStatuses.has(item.status)).length, today: reservations.filter((item) => item.pickupDate === today || item.returnDate === today).length, overdue: reservations.filter((item) => item.status === 'overdue').length }; }
/**
 * Availability is answered by the central conflict module, so the reservation
 * screen, the calendar, the service queue and the write path can never disagree.
 */
export function hasReservationOverlap(check: AvailabilityCheck, reservations: Reservation[]): boolean { return findItemConflicts(check, reservations).length > 0; }

export function createReservation(input: CreateReservationInput): Reservation {
  const customer = getCustomers().find((item) => item.id === input.customerId);
  const today = getTodayISO();
  if (!customer) throw new Error('العميلة المحددة غير موجودة.');
  if (customer.status === 'blocked') throw new Error('لا يمكن إنشاء حجز لعميلة محظورة قبل تسوية حالتها.');

  const pickupTime = normalizeTimeInput(input.pickupTime, 'وقت الاستلام');
  const returnTime = normalizeTimeInput(input.returnTime, 'وقت الإرجاع');

  if (!input.pickupDate || !input.returnDate) throw new Error('حددي تاريخ الاستلام والإرجاع.');
  if (input.pickupDate < today) throw new Error('تاريخ الاستلام لا يمكن أن يكون في الماضي.');
  if (input.returnDate <= input.pickupDate) throw new Error('تاريخ الإرجاع يجب أن يكون بعد تاريخ الاستلام.');

  const reservations = getReservations();

  // ── Multi-item path ──────────────────────────────────────────────────
  if (input.lines && input.lines.length > 0) {
    const defaults = { pickupDate: input.pickupDate, pickupTime, returnDate: input.returnDate, returnTime };
    const lines = input.lines.map((lineInput) => buildLineFromInput(lineInput, defaults));

    // Check conflicts for every line
    const conflictResults = checkLineConflicts(input.lines, defaults, reservations);
    assertNoLineConflicts(conflictResults);

    const totalAmount = calculateLinesTotal(lines);
    const reservation: Reservation = {
      id: generateId(),
      reservationNumber: generateNumber('RSV'),
      customerId: customer.id,
      customerNameSnapshot: customer.name,
      customerPhoneSnapshot: customer.phone,
      // Top-level fields synced from the first line for backward compatibility
      inventoryItemId: lines[0].inventoryItemId,
      dressCodeSnapshot: lines[0].dressCodeSnapshot,
      dressNameSnapshot: lines[0].dressNameSnapshot,
      customerName: customer.name,
      customerPhone: customer.phone,
      dressCode: lines[0].dressCodeSnapshot,
      dressName: lines[0].dressNameSnapshot,
      pickupDate: input.pickupDate,
      pickupTime,
      returnDate: input.returnDate,
      returnTime,
      status: 'confirmed',
      rentalPrice: lines[0].rentalPrice,
      listRentalPrice: lines[0].listRentalPrice,
      depositAmount: lines[0].depositAmount,
      totalAmount,
      paidAmount: 0,
      remainingAmount: totalAmount,
      assessedFeesAmount: 0,
      refundedAmount: 0,
      settledDepositAmount: 0,
      retainedDepositAmount: 0,
      notes: input.notes?.trim() || undefined,
      lines,
    };

    writeCollection(COLLECTION, [reservation, ...reservations]);
    recordAudit({
      action: 'create',
      entityType: 'reservation',
      entityId: reservation.id,
      summary: `تم إنشاء الحجز ${reservation.reservationNumber} بعدد ${lines.length} بنود.`,
      nextValues: { pickupDate: reservation.pickupDate, returnDate: reservation.returnDate, totalAmount, lineCount: lines.length, items: lines.map((line) => line.dressCodeSnapshot) },
    });
    return reservation;
  }

  // ── Single-item path (backward compatible) ───────────────────────────
  if (!input.dressId) throw new Error('اختاري عنصراً واحداً على الأقل.');

  const dress = getDresses().find((item) => item.id === input.dressId);
  if (!dress) throw new Error('العنصر المحدد غير موجود.');
  if (!dress.isForRent || !reservableDressStatuses.has(dress.status)) throw new Error('العنصر غير مؤهل للإيجار حاليا.');
  if (!Number.isFinite(input.depositAmount) || input.depositAmount < 0) throw new Error('قيمة العربون غير صالحة.');

  // Central conflict guard
  assertNoConflicts(findItemConflicts({ inventoryItemId: dress.id, dressCode: dress.code, pickupDate: input.pickupDate, returnDate: input.returnDate }, reservations));
  const listRentalPrice = dress.rentalPrice;
  const agreedRentalPrice = input.rentalPrice ?? listRentalPrice;
  if (!Number.isFinite(agreedRentalPrice) || agreedRentalPrice < 0) throw new Error('قيمة الإيجار المتفق عليها غير صالحة.');
  if (agreedRentalPrice > listRentalPrice) throw new Error('قيمة الإيجار المتفق عليها لا يمكن أن تتجاوز السعر المسجل للعنصر.');
  const totalAmount = agreedRentalPrice + input.depositAmount;

  // Create a single line for consistency
  const line: ContractLine = {
    id: generateId(),
    inventoryItemId: dress.id,
    dressCodeSnapshot: dress.code,
    dressNameSnapshot: dress.name,
    pickupDate: input.pickupDate,
    pickupTime,
    returnDate: input.returnDate,
    returnTime,
    rentalPrice: agreedRentalPrice,
    listRentalPrice,
    depositAmount: input.depositAmount,
    deliveryStatus: 'pending_delivery',
    lateFee: 0,
    damageFee: 0,
    notes: input.notes?.trim() || undefined,
  };

  const reservation: Reservation = {
    id: generateId(),
    reservationNumber: generateNumber('RSV'),
    customerId: customer.id,
    inventoryItemId: dress.id,
    customerNameSnapshot: customer.name,
    customerPhoneSnapshot: customer.phone,
    dressCodeSnapshot: dress.code,
    dressNameSnapshot: dress.name,
    customerName: customer.name,
    customerPhone: customer.phone,
    dressCode: dress.code,
    dressName: dress.name,
    pickupDate: input.pickupDate,
    pickupTime,
    returnDate: input.returnDate,
    returnTime,
    status: 'confirmed',
    rentalPrice: agreedRentalPrice,
    listRentalPrice,
    depositAmount: input.depositAmount,
    totalAmount,
    paidAmount: 0,
    remainingAmount: totalAmount,
    assessedFeesAmount: 0,
    refundedAmount: 0,
    settledDepositAmount: 0,
    retainedDepositAmount: 0,
    notes: input.notes?.trim() || undefined,
    lines: [line],
  };

  writeCollection(COLLECTION, [reservation, ...reservations]);
  recordAudit({ action: 'create', entityType: 'reservation', entityId: reservation.id, summary: `تم إنشاء الحجز ${reservation.reservationNumber} للفستان ${reservation.dressCode}.`, nextValues: { pickupDate: reservation.pickupDate, returnDate: reservation.returnDate, totalAmount } });
  return reservation;
}

/**
 * Adds a line (item) to an existing reservation.
 */
export function addContractLine(input: AddContractLineInput): Reservation {
  const reservations = getReservations();
  const reservation = reservations.find((item) => item.reservationNumber === input.reservationNumber);
  if (!reservation) throw new Error('الحجز المحدد غير موجود.');
  if (reservation.status === 'cancelled' || reservation.status === 'returned') throw new Error('لا يمكن إضافة بنود إلى حجز مغلق.');

  const timeDefaults = getReservationTimeDefaults();
  const defaults = {
    pickupDate: input.pickupDate ?? reservation.pickupDate,
    pickupTime: input.pickupTime ?? timeDefaults.pickupTime,
    returnDate: input.returnDate ?? reservation.returnDate,
    returnTime: input.returnTime ?? timeDefaults.returnTime,
  };

  const lineInput: CreateReservationLineInput = {
    dressId: input.dressId,
    pickupDate: defaults.pickupDate,
    pickupTime: defaults.pickupTime,
    returnDate: defaults.returnDate,
    returnTime: defaults.returnTime,
    rentalPrice: input.rentalPrice,
    depositAmount: input.depositAmount,
    notes: input.notes,
  };

  const line = buildLineFromInput(lineInput, defaults);

  // Check conflicts for the new line
  assertNoConflicts(findItemConflicts({
    inventoryItemId: line.inventoryItemId,
    dressCode: line.dressCodeSnapshot,
    pickupDate: line.pickupDate,
    returnDate: line.returnDate,
    excludeReservationNumber: reservation.reservationNumber,
  }, reservations));

  const existingLines = reservation.lines ?? [];
  const updatedLines = [...existingLines, line];
  const updated = syncTopLevelFromLines({ ...reservation, lines: updatedLines });

  return persist(reservations, updated);
}

/**
 * Removes a line from an existing reservation.
 *
 * Cannot remove a line that has been delivered or has payments attached.
 */
export function removeContractLine(input: RemoveContractLineInput): Reservation {
  const reservations = getReservations();
  const reservation = reservations.find((item) => item.reservationNumber === input.reservationNumber);
  if (!reservation) throw new Error('الحجز المحدد غير موجود.');
  if (reservation.status === 'cancelled' || reservation.status === 'returned') throw new Error('لا يمكن حذف بنود من حجز مغلق.');

  const lines = reservation.lines ?? [];
  const line = lines.find((l) => l.id === input.lineId);
  if (!line) throw new Error('البند المحدد غير موجود في الحجز.');

  if (line.deliveryStatus === 'delivered' || line.deliveryStatus === 'late') {
    throw new Error('لا يمكن حذف بند تم تسليمه. سجّلي الإرجاع أولاً.');
  }

  if (lines.length <= 1) {
    throw new Error('لا يمكن حذف البند الأخير. استخدمي إلغاء الحجز بدلاً من ذلك.');
  }

  const updatedLines = lines.filter((l) => l.id !== input.lineId);
  const updated = syncTopLevelFromLines({ ...reservation, lines: updatedLines });

  recordAudit({
    action: 'update',
    entityType: 'reservation',
    entityId: reservation.id,
    summary: `تم حذف البند ${line.dressCodeSnapshot} من الحجز ${reservation.reservationNumber}.`,
    previousValues: { lineId: line.id, dressCode: line.dressCodeSnapshot },
    nextValues: { lineCount: updatedLines.length },
  });

  return persist(reservations, updated);
}

/**
 * Updates a line's dates, pricing, or notes.
 */
export function updateContractLine(input: UpdateContractLineInput): Reservation {
  const reservations = getReservations();
  const reservation = reservations.find((item) => item.reservationNumber === input.reservationNumber);
  if (!reservation) throw new Error('الحجز المحدد غير موجود.');
  if (reservation.status === 'cancelled' || reservation.status === 'returned') throw new Error('لا يمكن تعديل بنود حجز مغلق.');

  const lines = reservation.lines ?? [];
  const lineIndex = lines.findIndex((l) => l.id === input.lineId);
  if (lineIndex === -1) throw new Error('البند المحدد غير موجود في الحجز.');

  const line = lines[lineIndex];

  // If the line is delivered, only allow date/notes changes, not pricing
  if ((line.deliveryStatus === 'delivered' || line.deliveryStatus === 'late') && (input.rentalPrice !== undefined || input.depositAmount !== undefined)) {
    throw new Error('لا يمكن تعديل تسعير بند تم تسليمه.');
  }

  const updatedLine: ContractLine = {
    ...line,
    ...(input.pickupDate !== undefined && { pickupDate: input.pickupDate }),
    ...(input.pickupTime !== undefined && { pickupTime: normalizeTimeInput(input.pickupTime, 'وقت الاستلام') }),
    ...(input.returnDate !== undefined && { returnDate: input.returnDate }),
    ...(input.returnTime !== undefined && { returnTime: normalizeTimeInput(input.returnTime, 'وقت الإرجاع') }),
    ...(input.rentalPrice !== undefined && { rentalPrice: input.rentalPrice }),
    ...(input.depositAmount !== undefined && { depositAmount: input.depositAmount }),
    ...(input.notes !== undefined && { notes: input.notes?.trim() || undefined }),
  };

  // If dates changed, re-check conflicts for this line
  if (input.pickupDate || input.returnDate) {
    assertNoConflicts(findItemConflicts({
      inventoryItemId: updatedLine.inventoryItemId,
      dressCode: updatedLine.dressCodeSnapshot,
      pickupDate: updatedLine.pickupDate,
      returnDate: updatedLine.returnDate,
      excludeReservationNumber: reservation.reservationNumber,
    }, reservations));
  }

  const updatedLines = lines.map((l, i) => i === lineIndex ? updatedLine : l);
  const updated = syncTopLevelFromLines({ ...reservation, lines: updatedLines });

  return persist(reservations, updated);
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

  // For multi-item reservations, update all lines' dates
  const lines = reservation.lines ?? [];
  if (lines.length > 0) {
    let updatedLines = lines.map((line) => {
      if (line.deliveryStatus === 'delivered' || line.deliveryStatus === 'late') {
        // Don't change dates for already-delivered lines
        return line;
      }
      return { ...line, pickupDate: input.pickupDate, pickupTime, returnDate: input.returnDate, returnTime };
    });

    // Handle dress swap for single-line reservations
    if (input.dressId && input.dressId !== reservation.inventoryItemId) {
      if (reservation.status === 'delivered' || reservation.status === 'overdue') throw new Error('لا يمكن تغيير العنصر بعد التسليم.');
      const dress = getDresses().find((item) => item.id === input.dressId);
      if (!dress) throw new Error('العنصر المحدد غير موجود.');
      if (!dress.isForRent || !reservableDressStatuses.has(dress.status)) throw new Error('العنصر غير مؤهل للإيجار حالياً.');

      // Update the first pending line to the new item
      const pendingIndex = updatedLines.findIndex((l) => l.deliveryStatus === 'pending_delivery');
      if (pendingIndex >= 0) {
        updatedLines = updatedLines.map((l, i) => i === pendingIndex ? {
          ...l,
          inventoryItemId: dress.id,
          dressCodeSnapshot: dress.code,
          dressNameSnapshot: dress.name,
          rentalPrice: dress.rentalPrice,
          listRentalPrice: dress.rentalPrice,
        } : l);
      }
    }

    // Check conflicts for each pending line
    updatedLines
      .filter((line) => line.deliveryStatus === 'pending_delivery')
      .forEach((line) => {
        assertNoConflicts(findItemConflicts({
          inventoryItemId: line.inventoryItemId,
          dressCode: line.dressCodeSnapshot,
          pickupDate: line.pickupDate,
          returnDate: line.returnDate,
          excludeReservationNumber: reservation.reservationNumber,
        }, reservations));
      });

    // Also re-check attached accessories against the new dates
    const accessoryLinks = getReservationAccessories();
    accessoryLinks
      .filter((link) => link.reservationNumber === reservation.reservationNumber)
      .forEach((link) => assertNoConflicts(findAccessoryConflicts({
        accessoryId: link.accessoryId,
        pickupDate: input.pickupDate,
        returnDate: input.returnDate,
        excludeReservationNumber: reservation.reservationNumber,
      }, accessoryLinks, reservations)));

    const updated = syncTopLevelFromLines({ ...reservation, lines: updatedLines, pickupDate: input.pickupDate, pickupTime, returnDate: input.returnDate, returnTime });
    recordAudit({ action: 'update', entityType: 'reservation', entityId: reservation.id, summary: `تم تعديل موعد الحجز ${reservation.reservationNumber}.`, previousValues: { pickupDate: reservation.pickupDate, returnDate: reservation.returnDate }, nextValues: { pickupDate: updated.pickupDate, returnDate: updated.returnDate } });
    return persist(reservations, updated);
  }

  // Legacy single-item path
  let nextItem = { inventoryItemId: reservation.inventoryItemId, dressCode: reservation.dressCode, dressName: reservation.dressName, rentalPrice: reservation.rentalPrice, listRentalPrice: reservation.listRentalPrice ?? reservation.rentalPrice };
  if (input.dressId && input.dressId !== reservation.inventoryItemId) {
    if (reservation.status === 'delivered' || reservation.status === 'overdue') throw new Error('لا يمكن تغيير العنصر بعد التسليم.');
    const dress = getDresses().find((item) => item.id === input.dressId);
    if (!dress) throw new Error('العنصر المحدد غير موجود.');
    if (!dress.isForRent || !reservableDressStatuses.has(dress.status)) throw new Error('العنصر غير مؤهل للإيجار حالياً.');
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

/**
 * Per-line delivery: marks one line as delivered and updates the item status.
 */
export function deliverContractLine(input: LineDeliveryInput): Reservation {
  const reservations = getReservations();
  const reservation = reservations.find((item) => item.reservationNumber === input.reservationNumber);
  if (!reservation) throw new Error('الحجز المحدد غير موجود.');

  const lines = reservation.lines ?? [];
  const lineIndex = lines.findIndex((l) => l.id === input.lineId);
  if (lineIndex === -1) throw new Error('البند المحدد غير موجود في الحجز.');

  const line = lines[lineIndex];
  if (line.deliveryStatus !== 'pending_delivery') {
    throw new Error('هذا البند تم تسليمه بالفعل.');
  }

  const updatedLine: ContractLine = {
    ...line,
    deliveryStatus: 'delivered',
    deliveryPhotos: input.deliveryPhotos,
    notes: input.notes?.trim() || line.notes,
  };

  const updatedLines = lines.map((l, i) => i === lineIndex ? updatedLine : l);
  const newStatus = deriveReservationStatus(updatedLines, reservation.status);
  let updated: Reservation = { ...reservation, lines: updatedLines, status: newStatus };
  updated = syncTopLevelFromLines(updated);

  // Update the dress status
  const dress = getDresses().find((d) => d.id === line.inventoryItemId);
  if (dress) {
    updateDressStatus(line.dressCodeSnapshot, 'rented');
  }

  recordAudit({
    action: 'deliver',
    entityType: 'reservation',
    entityId: reservation.id,
    summary: `تم تسليم البند ${line.dressCodeSnapshot} من الحجز ${reservation.reservationNumber}.`,
    nextValues: { lineId: line.id, deliveryStatus: 'delivered' },
  });

  return persist(reservations, updated);
}

/**
 * Per-line return: marks one line as returned and updates the item status.
 */
export function returnContractLine(input: LineReturnInput): Reservation {
  const reservations = getReservations();
  const reservation = reservations.find((item) => item.reservationNumber === input.reservationNumber);
  if (!reservation) throw new Error('الحجز المحدد غير موجود.');

  const lines = reservation.lines ?? [];
  const lineIndex = lines.findIndex((l) => l.id === input.lineId);
  if (lineIndex === -1) throw new Error('البند المحدد غير موجود في الحجز.');

  const line = lines[lineIndex];
  if (line.deliveryStatus !== 'delivered' && line.deliveryStatus !== 'late') {
    throw new Error('هذا البند لم يتم تسليمه بعد.');
  }

  const updatedLine: ContractLine = {
    ...line,
    deliveryStatus: input.lateFee > 0 ? 'late' : 'returned',
    returnPhotos: input.returnPhotos,
    lateFee: input.lateFee,
    damageFee: input.damageFee,
    notes: input.notes?.trim() || line.notes,
  };

  const updatedLines = lines.map((l, i) => i === lineIndex ? updatedLine : l);
  const newStatus = deriveReservationStatus(updatedLines, reservation.status);

  // Update assessed fees
  const additionalFees = input.lateFee + input.damageFee;
  let updated: Reservation = {
    ...reservation,
    lines: updatedLines,
    status: newStatus,
    assessedFeesAmount: (reservation.assessedFeesAmount ?? 0) + additionalFees,
  };
  updated = syncTopLevelFromLines(updated);

  // Update the dress status
  updateDressStatus(line.dressCodeSnapshot, input.nextItemStatus);

  recordAudit({
    action: 'return',
    entityType: 'reservation',
    entityId: reservation.id,
    summary: `تم استرجاع البند ${line.dressCodeSnapshot} من الحجز ${reservation.reservationNumber}.`,
    nextValues: { lineId: line.id, deliveryStatus: updatedLine.deliveryStatus, lateFee: input.lateFee, damageFee: input.damageFee },
  });

  return persist(reservations, updated);
}
