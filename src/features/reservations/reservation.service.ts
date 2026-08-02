import { generateId, generateNumber, readCollection, writeCollection } from '../../services/localDatabase';
import { getTodayISO, isValidTime } from '../../shared/utils/date';
import {
  calculateReservationRemainingAmount,
  calculateRentalOutstanding,
} from '../../shared/utils/financialCalculations.js';
import { getReservationAccessories, releaseAccessoriesForReservation } from '../accessories/reservationAccessory.service';
import { recordAudit } from '../audit/audit.service';
import { getCustomers } from '../customers/customer.service';
import { getDresses, markDressRented, updateDressStatus } from '../dresses/dress.service';
import { getDressSecurityDepositAmount } from '../dresses/dress.types';
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
  calculateLinesRentalPrice,
  calculateLinesSecurityDeposit,
  calculateLinesBookingAdvance,
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
import {
  getReservationSecurityDepositAmount,
  getLineSecurityDepositAmount,
  getLineBookingAdvanceAmount,
} from './reservation.types';
import { createSearchMatcher } from '../../shared/utils/search';

const COLLECTION = 'reservations';
const activeStatuses = ACTIVE_RESERVATION_STATUSES;
const reservableDressStatuses = new Set(['available', 'reserved', 'rented']);
const allowedReturnItemStatuses = new Set(['inspection', 'laundry', 'maintenance', 'damaged']);
export type RecordReservationPaymentInput = {
  reservationNumber: string;
  type: string;
  direction: 'income' | 'refund' | 'settlement';
  amount: number;
};
type SettleReservationReturnInput = {
  reservationNumber: string;
  lateFee: number;
  damageFee: number;
  refundAmount: number;
  settledDepositAmount: number;
  retainedDepositAmount: number;
  /** Per-line returns have already posted the assessed fees before the final line closes. */
  feesAlreadyAssessed?: boolean;
  /** Canonical fields for new flow */
  securityDepositAmount?: number;
  securityDepositCollectedAmount?: number;
};

function remaining(reservation: Reservation): number {
  // Canonical: rental outstanding excludes security deposit
  const hasCanonical = reservation.securityDepositAmount !== undefined || reservation.bookingAdvanceAmount !== undefined;
  if (hasCanonical) {
    const rentalTotal = reservation.lines && reservation.lines.length > 0
      ? calculateLinesRentalPrice(reservation.lines)
      : reservation.rentalPrice;
    // FIX: Do NOT use bookingAdvanceAmount as collected, and do NOT fallback to paidAmount for rentalCollected
    // paidAmount is derived as rentalCollected + bookingAdvanceCollected, not source of truth
    // bookingAdvanceAmount = required/agreed, bookingAdvanceCollectedAmount = actually paid
    return calculateRentalOutstanding({
      rentalTotal,
      assessedFees: reservation.assessedFeesAmount ?? 0,
      bookingAdvanceCollected: reservation.bookingAdvanceCollectedAmount ?? 0,
      rentalCollected: reservation.rentalCollectedAmount ?? 0,
      rentalRefunded: reservation.rentalRefundedAmount ?? 0,
      retainedDeposit: reservation.securityDepositRetainedAmount ?? reservation.retainedDepositAmount ?? 0,
    });
  }
  // Legacy fallback for old backups
  return calculateReservationRemainingAmount({
    totalAmount: reservation.totalAmount,
    assessedFeesAmount: reservation.assessedFeesAmount,
    paidAmount: reservation.paidAmount,
    settledDepositAmount: reservation.settledDepositAmount,
    refundedAmount: reservation.refundedAmount,
  });
}

function persist(reservations: Reservation[], updated: Reservation): Reservation {
  const next = { ...updated, remainingAmount: remaining(updated) };
  writeCollection(COLLECTION, reservations.map((item) => item.id === next.id ? next : item));
  return next;
}

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
function validateOperationDateTime(value: string, label: string): number {
  const timestamp = new Date(value).getTime();
  if (!value || Number.isNaN(timestamp)) throw new Error(`${label} مطلوبان.`);
  if (timestamp > Date.now()) throw new Error(`${label} لا يمكن أن يكونا في المستقبل.`);
  return timestamp;
}
function assertNoPostedMoneyForContractValueChange(reservation: Reservation): void {
  const hasPostedMoney = (reservation.paidAmount ?? 0) > 0
    || (reservation.rentalCollectedAmount ?? 0) > 0
    || (reservation.bookingAdvanceCollectedAmount ?? 0) > 0
    || (reservation.securityDepositCollectedAmount ?? 0) > 0
    || (reservation.refundedAmount ?? 0) > 0
    || (reservation.settledDepositAmount ?? 0) > 0
    || (reservation.retainedDepositAmount ?? 0) > 0
    || (reservation.securityDepositRetainedAmount ?? 0) > 0;
  if (hasPostedMoney) {
    throw new Error('لا يمكن تغيير قيمة العقد بعد تسجيل حركة مالية أو مبالغ محصلة عليه.');
  }
}
function assertLineDeliveryPaymentGate(reservation: Reservation, overrideReason?: string): string | undefined {
  const outstandingAmount = Math.round((reservation.remainingAmount + Number.EPSILON) * 1_000) / 1_000;
  if (outstandingAmount <= 0) return undefined;
  const reason = overrideReason?.trim();
  if (!reason) {
    throw new Error(`لا يمكن تسليم البند قبل سداد الرصيد المتبقي (${outstandingAmount.toFixed(3)} ر.ع)، أو تسجيل سبب واضح للتجاوز.`);
  }
  return reason;
}
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
    const rentalTotal = calculateLinesRentalPrice(lines);
    const securityTotal = calculateLinesSecurityDeposit(lines);
    const bookingAdvanceTotal = calculateLinesBookingAdvance(lines);

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
      depositAmount: lines[0].securityDepositAmount ?? lines[0].depositAmount, // legacy compat: depositAmount deprecated, use securityDepositAmount
      securityDepositAmount: securityTotal,
      bookingAdvanceAmount: bookingAdvanceTotal,
      bookingAdvanceCollectedAmount: 0,
      rentalCollectedAmount: 0,
      securityDepositCollectedAmount: 0,
      securityDepositRefundedAmount: 0,
      securityDepositRetainedAmount: 0,
      totalAmount,
      paidAmount: 0,
      remainingAmount: rentalTotal, // canonical: rental only
      assessedFeesAmount: 0,
      refundedAmount: 0,
      settledDepositAmount: 0,
      retainedDepositAmount: 0,
      rentalRefundedAmount: 0,
      notes: input.notes?.trim() || undefined,
      lines,
    };

    // Recalculate remaining via canonical logic
    const withRemaining = { ...reservation, remainingAmount: remaining(reservation) };
    writeCollection(COLLECTION, [withRemaining, ...reservations]);
    recordAudit({
      action: 'create',
      entityType: 'reservation',
      entityId: reservation.id,
      summary: `تم إنشاء الحجز ${reservation.reservationNumber} بعدد ${lines.length} بنود.`,
      nextValues: { pickupDate: reservation.pickupDate, returnDate: reservation.returnDate, totalAmount, rentalTotal, securityTotal, lineCount: lines.length, items: lines.map((line) => line.dressCodeSnapshot) },
    });
    return withRemaining;
  }

  // ── Single-item path (backward compatible) ───────────────────────────
  if (!input.dressId) throw new Error('اختاري عنصراً واحداً على الأقل.');

  const dress = getDresses().find((item) => item.id === input.dressId);
  if (!dress) throw new Error('العنصر المحدد غير موجود.');
  if (!dress.isForRent || !reservableDressStatuses.has(dress.status)) throw new Error('العنصر غير مؤهل للإيجار حاليا.');
  if (!Number.isFinite(input.depositAmount) || input.depositAmount < 0) throw new Error('قيمة العربون غير صالحة.'); // legacy compat

  // Central conflict guard
  assertNoConflicts(findItemConflicts({ inventoryItemId: dress.id, dressCode: dress.code, pickupDate: input.pickupDate, returnDate: input.returnDate }, reservations));
  const listRentalPrice = dress.rentalPrice;
  const agreedRentalPrice = input.rentalPrice ?? listRentalPrice;
  if (!Number.isFinite(agreedRentalPrice) || agreedRentalPrice < 0) throw new Error('قيمة الإيجار المتفق عليها غير صالحة.');
  if (agreedRentalPrice > listRentalPrice) throw new Error('قيمة الإيجار المتفق عليها لا يمكن أن تتجاوز السعر المسجل للعنصر.');

  // Canonical handling: securityDepositAmount prefers new field, fallback to legacy depositAmount
  const securityDepositAmount = input.securityDepositAmount ?? input.depositAmount ?? 0; // legacy compat
  const bookingAdvanceAmount = input.bookingAdvanceAmount ?? 0;
  const totalAmount = agreedRentalPrice + securityDepositAmount;

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
    depositAmount: securityDepositAmount, // legacy compat
    securityDepositAmount,
    bookingAdvanceAmount,
    legacyDepositAmount: input.depositAmount,
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
    depositAmount: securityDepositAmount, // legacy compat
    securityDepositAmount,
    bookingAdvanceAmount,
    bookingAdvanceCollectedAmount: 0,
    rentalCollectedAmount: 0,
    securityDepositCollectedAmount: 0,
    securityDepositRefundedAmount: 0,
    securityDepositRetainedAmount: 0,
    legacyDepositAmount: input.depositAmount,
    totalAmount,
    paidAmount: 0,
    remainingAmount: agreedRentalPrice,
    assessedFeesAmount: 0,
    refundedAmount: 0,
    settledDepositAmount: 0,
    retainedDepositAmount: 0,
    rentalRefundedAmount: 0,
    notes: input.notes?.trim() || undefined,
    lines: [line],
  };

  const withRemaining = { ...reservation, remainingAmount: remaining(reservation) };
  writeCollection(COLLECTION, [withRemaining, ...reservations]);
  recordAudit({ action: 'create', entityType: 'reservation', entityId: reservation.id, summary: `تم إنشاء الحجز ${reservation.reservationNumber} للفستان ${reservation.dressCode}.`, nextValues: { pickupDate: reservation.pickupDate, returnDate: reservation.returnDate, totalAmount, rentalPrice: agreedRentalPrice, securityDepositAmount } });
  return withRemaining;
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
    depositAmount: input.depositAmount, // legacy compat input
    securityDepositAmount: input.securityDepositAmount,
    bookingAdvanceAmount: input.bookingAdvanceAmount,
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
  assertNoPostedMoneyForContractValueChange(reservation);

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
  if ((line.deliveryStatus === 'delivered' || line.deliveryStatus === 'late') && (input.rentalPrice !== undefined || input.depositAmount !== undefined || input.securityDepositAmount !== undefined || input.bookingAdvanceAmount !== undefined)) { // legacy compat check
    throw new Error('لا يمكن تعديل تسعير بند تم تسليمه.');
  }
  if (input.rentalPrice !== undefined || input.depositAmount !== undefined || input.securityDepositAmount !== undefined || input.bookingAdvanceAmount !== undefined) { // legacy compat check

    assertNoPostedMoneyForContractValueChange(reservation);
  }

  const updatedLine: ContractLine = {
    ...line,
    ...(input.pickupDate !== undefined && { pickupDate: input.pickupDate }),
    ...(input.pickupTime !== undefined && { pickupTime: normalizeTimeInput(input.pickupTime, 'وقت الاستلام') }),
    ...(input.returnDate !== undefined && { returnDate: input.returnDate }),
    ...(input.returnTime !== undefined && { returnTime: normalizeTimeInput(input.returnTime, 'وقت الإرجاع') }),
    ...(input.rentalPrice !== undefined && { rentalPrice: input.rentalPrice }),
    ...(input.depositAmount !== undefined && { depositAmount: input.depositAmount, securityDepositAmount: input.depositAmount }), // legacy compat mapping

    ...(input.securityDepositAmount !== undefined && { securityDepositAmount: input.securityDepositAmount, depositAmount: input.securityDepositAmount }), // legacy compat mapping

    ...(input.bookingAdvanceAmount !== undefined && { bookingAdvanceAmount: input.bookingAdvanceAmount }),
    ...(input.notes !== undefined && { notes: input.notes?.trim() || undefined }),
  };

  if (!updatedLine.pickupDate || !updatedLine.returnDate) throw new Error('حددي تاريخ الاستلام والإرجاع.');
  if (updatedLine.pickupDate < getTodayISO()) throw new Error('تاريخ الاستلام لا يمكن أن يكون في الماضي.');
  if (updatedLine.returnDate <= updatedLine.pickupDate) throw new Error('تاريخ الإرجاع يجب أن يكون بعد تاريخ الاستلام.');
  if (!Number.isFinite(updatedLine.rentalPrice) || updatedLine.rentalPrice < 0) {
    throw new Error('قيمة الإيجار المتفق عليها غير صالحة.');
  }
  if (updatedLine.rentalPrice > (updatedLine.listRentalPrice ?? line.rentalPrice)) {
    throw new Error('قيمة الإيجار المتفق عليها لا يمكن أن تتجاوز السعر المسجل للعنصر.');
  }
  const secDep = getLineSecurityDepositAmount(updatedLine);
  if (!Number.isFinite(secDep) || secDep < 0) {
    throw new Error('قيمة التأمين المسترد غير صالحة.');
  }
  const bookAdv = getLineBookingAdvanceAmount(updatedLine);
  if (!Number.isFinite(bookAdv) || bookAdv < 0) {
    throw new Error('قيمة دفعة الحجز غير صالحة.');
  }

  // If dates changed, re-check conflicts for this line
  if (input.pickupDate !== undefined || input.returnDate !== undefined) {
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

  recordAudit({
    action: 'update',
    entityType: 'reservation',
    entityId: reservation.id,
    summary: `تم تعديل البند ${line.dressCodeSnapshot} في الحجز ${reservation.reservationNumber}.`,
    previousValues: {
      pickupDate: line.pickupDate,
      returnDate: line.returnDate,
      rentalPrice: line.rentalPrice,
      depositAmount: getLineSecurityDepositAmount(line), // legacy compat
      securityDepositAmount: getLineSecurityDepositAmount(line),
      bookingAdvanceAmount: getLineBookingAdvanceAmount(line),
    },
    nextValues: {
      pickupDate: updatedLine.pickupDate,
      returnDate: updatedLine.returnDate,
      rentalPrice: updatedLine.rentalPrice,
      depositAmount: getLineSecurityDepositAmount(updatedLine), // legacy compat
      securityDepositAmount: getLineSecurityDepositAmount(updatedLine),
      bookingAdvanceAmount: getLineBookingAdvanceAmount(updatedLine),
    },
  });
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
          securityDepositAmount: getDressSecurityDepositAmount(dress),
          depositAmount: getDressSecurityDepositAmount(dress), // legacy compat

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

  const totalAmount = nextItem.rentalPrice + getReservationSecurityDepositAmount(reservation);
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
  const reservations = getReservations();
  const reservation = reservations.find((item) => item.reservationNumber === input.reservationNumber);
  if (!reservation) throw new Error('الحجز المحدد غير موجود.');
  if (reservation.status === 'cancelled') throw new Error('لا يمكن تسجيل حركة مالية على حجز ملغي.');
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('قيمة الدفعة يجب أن تكون أكبر من صفر.');

  // Strict type-direction mapping: fixed per blocker #1 and #2
  // refund type = rental refund only, direction must be refund
  // security_deposit_refund = deposit refund only, direction refund
  // security_deposit_retention / retained_deposit = settlement only
  // All other income types = income
  const isRentalRefund = input.type === 'refund';
  const isSecurityDepositRefund = input.type === 'security_deposit_refund';
  const isSecurityDepositRetention = input.type === 'security_deposit_retention' || input.type === 'retained_deposit';
  const isSecurityDepositCollection = input.type === 'security_deposit_collection' || input.type === 'deposit';
  const isBookingAdvance = input.type === 'booking_advance';
  const isRental = input.type === 'rental' || input.type === 'rental_payment';
  const isFee = input.type === 'penalty' || input.type === 'adjustment';

  if (isRentalRefund && input.direction !== 'refund') throw new Error('حركة الاسترجاع غير صالحة.');
  if (isSecurityDepositRefund && input.direction !== 'refund') throw new Error('حركة استرداد التأمين غير صالحة.');
  if (isSecurityDepositRetention && input.direction !== 'settlement') throw new Error('حركة احتجاز التأمين يجب أن تكون settlement.');
  if (!isRentalRefund && !isSecurityDepositRefund && input.direction === 'refund') {
    throw new Error('اختاري نوع حركة مالية مناسب للاسترجاع.');
  }

  // Refund guards - strictly separated per requirement #1
  if (input.direction === 'refund') {
    if (isRentalRefund) {
      // Rental refund checked against rentalCollected + bookingAdvanceCollected (when cancellation documented) - rentalRefunded
      // For strict separation: must NOT use security deposit liability
      // Allowed: rentalCollectedAmount + bookingAdvanceCollectedAmount (booking only when cancellation policy)
      // Here we check against rentalCollected + bookingAdvanceCollected to support cancellation case, but never security deposit
      const rentalCollected = reservation.rentalCollectedAmount ?? 0;
      const bookingAdvanceCollected = reservation.bookingAdvanceCollectedAmount ?? 0;
      const rentalRefunded = reservation.rentalRefundedAmount ?? 0;
      // For cancellation, bookingAdvanceCollected is included; for normal rental refund we also allow it as fallback
      const available = rentalCollected + bookingAdvanceCollected - rentalRefunded;
      const legacyAvailable = (reservation.paidAmount ?? 0) - (reservation.refundedAmount ?? 0);
      // Use the canonical available, but also allow legacy check for backward compat
      if (input.amount > available + 1e-6 && input.amount > legacyAvailable + 1e-6) {
        // If rentalCollected alone is enough, allow; if not, check inclusive of bookingAdvance
        if (input.amount > rentalCollected - rentalRefunded + 1e-6) {
          // If bookingAdvance exists, we consider cancellation scenario - allow if within total
          if (input.amount > available + 1e-6) {
            throw new Error('قيمة استرجاع الإيجار تتجاوز المبلغ المحصل فعلياً للإيجار.');
          }
        }
      }
    } else if (isSecurityDepositRefund) {
      const collected = reservation.securityDepositCollectedAmount ?? 0;
      const refunded = reservation.securityDepositRefundedAmount ?? 0;
      const retained = reservation.securityDepositRetainedAmount ?? 0;
      const available = Math.max(collected - refunded - retained, 0);
      if (input.amount > available + 1e-6) {
        throw new Error('قيمة استرداد التأمين المسترد تتجاوز المبلغ المتاح للاسترداد.');
      }
    } else {
      // Any other refund type not allowed as per separation
      throw new Error('نوع الاسترداد غير مدعوم؛ استخدمي refund للإيجار أو security_deposit_refund للتأمين.');
    }
  }

  if (input.direction === 'income' && !isFee && !isSecurityDepositCollection) {
    const rentalRemaining = remaining(reservation);
    if (input.amount > rentalRemaining + 1e-6) {
      const legacyRemaining = calculateReservationRemainingAmount({
        totalAmount: reservation.totalAmount,
        assessedFeesAmount: reservation.assessedFeesAmount,
        paidAmount: reservation.paidAmount,
        settledDepositAmount: reservation.settledDepositAmount,
        refundedAmount: reservation.refundedAmount,
      });
      if (input.amount > rentalRemaining && input.amount > legacyRemaining) {
        throw new Error('قيمة الدفعة تتجاوز الرصيد المتبقي على الحجز.');
      }
    }
  }

  if (input.direction === 'settlement') {
    if (isSecurityDepositRetention) {
      const collected = reservation.securityDepositCollectedAmount ?? 0;
      const refunded = reservation.securityDepositRefundedAmount ?? 0;
      const retained = reservation.securityDepositRetainedAmount ?? 0;
      const available = Math.max(collected - refunded - retained, 0);
      if (input.amount > available + 1e-6) {
        throw new Error('قيمة احتجاز التأمين المسترد تتجاوز المبلغ المتاح.');
      }
    }
  }

  const nextReservation: Reservation = { ...reservation };

  // Unified paidAmount = rentalCollectedAmount + bookingAdvanceCollectedAmount per requirement #4
  if (input.direction === 'income') {
    if (isBookingAdvance) {
      // FIX: bookingAdvanceCollectedAmount must be derived from actually paid, NOT from required bookingAdvanceAmount
      const currentCollected = reservation.bookingAdvanceCollectedAmount ?? 0;
      nextReservation.bookingAdvanceCollectedAmount = currentCollected + input.amount;
      // DO NOT overwrite bookingAdvanceAmount (required/agreed) - keep as is
      const rentalCollected = reservation.rentalCollectedAmount ?? 0;
      nextReservation.rentalCollectedAmount = rentalCollected;
      nextReservation.paidAmount = rentalCollected + nextReservation.bookingAdvanceCollectedAmount;
    } else if (isRental) {
      const currentRentalCollected = reservation.rentalCollectedAmount ?? 0;
      const bookingAdvanceCollected = reservation.bookingAdvanceCollectedAmount ?? 0;
      nextReservation.rentalCollectedAmount = currentRentalCollected + input.amount;
      nextReservation.bookingAdvanceCollectedAmount = bookingAdvanceCollected;
      nextReservation.paidAmount = nextReservation.rentalCollectedAmount + bookingAdvanceCollected;
    } else if (isSecurityDepositCollection) {
      nextReservation.securityDepositCollectedAmount = (reservation.securityDepositCollectedAmount ?? 0) + input.amount;
      // FIX: paidAmount must NOT include security deposit for canonical
      const rentalCollected = reservation.rentalCollectedAmount ?? 0;
      const bookingAdvanceCollected = reservation.bookingAdvanceCollectedAmount ?? 0;
      nextReservation.rentalCollectedAmount = rentalCollected;
      nextReservation.bookingAdvanceCollectedAmount = bookingAdvanceCollected;
      nextReservation.paidAmount = rentalCollected + bookingAdvanceCollected;
      // Legacy fallback: if reservation has no canonical fields, keep old behavior for backward compat
      if (reservation.securityDepositAmount === undefined && reservation.bookingAdvanceAmount === undefined) {
        nextReservation.paidAmount = (reservation.paidAmount ?? 0) + input.amount;
      }
    } else {
      // fee or other
      const rentalCollected = reservation.rentalCollectedAmount ?? 0;
      const bookingAdvanceCollected = reservation.bookingAdvanceCollectedAmount ?? 0;
      nextReservation.rentalCollectedAmount = rentalCollected;
      nextReservation.bookingAdvanceCollectedAmount = bookingAdvanceCollected;
      nextReservation.paidAmount = rentalCollected + bookingAdvanceCollected;
      if (isFee) {
        nextReservation.assessedFeesAmount = (reservation.assessedFeesAmount ?? 0) + input.amount;
      }
    }
  } else if (input.direction === 'refund') {
    if (isRentalRefund) {
      nextReservation.rentalRefundedAmount = (reservation.rentalRefundedAmount ?? 0) + input.amount;
      nextReservation.refundedAmount = (reservation.refundedAmount ?? 0) + input.amount;
      // paidAmount stays as sum of collected, refund increases remaining via rentalRefunded
      const rentalCollected = reservation.rentalCollectedAmount ?? 0;
      const bookingAdvanceCollected = reservation.bookingAdvanceCollectedAmount ?? 0;
      nextReservation.paidAmount = rentalCollected + bookingAdvanceCollected;
    } else if (isSecurityDepositRefund) {
      nextReservation.securityDepositRefundedAmount = (reservation.securityDepositRefundedAmount ?? 0) + input.amount;
      nextReservation.securityDepositCollectedAmount = reservation.securityDepositCollectedAmount ?? 0;
      nextReservation.securityDepositRetainedAmount = reservation.securityDepositRetainedAmount ?? 0;
      // paidAmount must NOT change for security deposit refund
      const rentalCollected = reservation.rentalCollectedAmount ?? 0;
      const bookingAdvanceCollected = reservation.bookingAdvanceCollectedAmount ?? 0;
      nextReservation.rentalCollectedAmount = rentalCollected;
      nextReservation.bookingAdvanceCollectedAmount = bookingAdvanceCollected;
      nextReservation.paidAmount = rentalCollected + bookingAdvanceCollected;
    }
  } else if (input.direction === 'settlement') {
    // Settlement = security deposit retention / fee proof, must NOT affect paidAmount/rentalCollected/bookingAdvanceCollected
    if (isSecurityDepositRetention) {
      nextReservation.securityDepositRetainedAmount = (reservation.securityDepositRetainedAmount ?? 0) + input.amount;
      // Keep other collected amounts unchanged
      const rentalCollected = reservation.rentalCollectedAmount ?? 0;
      const bookingAdvanceCollected = reservation.bookingAdvanceCollectedAmount ?? 0;
      nextReservation.rentalCollectedAmount = rentalCollected;
      nextReservation.bookingAdvanceCollectedAmount = bookingAdvanceCollected;
      nextReservation.paidAmount = rentalCollected + bookingAdvanceCollected;
      // Retained deposit covers fees but does NOT increase paidAmount; it reduces liability only
      // Assessed fees handling is done in settleReservationReturn (adds late/damage)
      // For manual retention, we do NOT automatically add to assessedFees here - retention reason must cover proven fees
    } else {
      // late_fee, damage_fee, deposit_settlement as settlement - do not affect paidAmount
      const rentalCollected = reservation.rentalCollectedAmount ?? 0;
      const bookingAdvanceCollected = reservation.bookingAdvanceCollectedAmount ?? 0;
      nextReservation.rentalCollectedAmount = rentalCollected;
      nextReservation.bookingAdvanceCollectedAmount = bookingAdvanceCollected;
      nextReservation.paidAmount = rentalCollected + bookingAdvanceCollected;
      if (input.type === 'late_fee' || input.type === 'damage_fee') {
        // Settlement fees proof - assessedFees already increased in settleReservationReturn, but for manual keep consistent
        // Do not double count if feesAlreadyAssessed path
      }
    }
  }

  // Final unification: ensure paidAmount = rentalCollected + bookingAdvanceCollected for canonical
  const hasCanonical = nextReservation.securityDepositAmount !== undefined || nextReservation.bookingAdvanceAmount !== undefined;
  if (hasCanonical) {
    const rc = nextReservation.rentalCollectedAmount ?? 0;
    const bac = nextReservation.bookingAdvanceCollectedAmount ?? 0;
    nextReservation.paidAmount = rc + bac;
    if (nextReservation.rentalCollectedAmount === undefined) nextReservation.rentalCollectedAmount = rc;
    if (nextReservation.bookingAdvanceCollectedAmount === undefined) nextReservation.bookingAdvanceCollectedAmount = bac;
    if (nextReservation.rentalRefundedAmount === undefined) nextReservation.rentalRefundedAmount = reservation.rentalRefundedAmount ?? 0;
    if (nextReservation.securityDepositCollectedAmount === undefined) nextReservation.securityDepositCollectedAmount = reservation.securityDepositCollectedAmount ?? 0;
    if (nextReservation.securityDepositRefundedAmount === undefined) nextReservation.securityDepositRefundedAmount = reservation.securityDepositRefundedAmount ?? 0;
    if (nextReservation.securityDepositRetainedAmount === undefined) nextReservation.securityDepositRetainedAmount = reservation.securityDepositRetainedAmount ?? 0;
  }

  return persist(reservations, nextReservation);
}

export function settleReservationReturn(input: SettleReservationReturnInput): Reservation {
  const reservations = getReservations();
  const reservation = reservations.find((item) => item.reservationNumber === input.reservationNumber);
  if (!reservation) throw new Error('الحجز المحدد غير موجود.');
  const eligibleStatuses = input.feesAlreadyAssessed ? ['delivered', 'overdue', 'returned'] : ['delivered', 'overdue'];
  if (!eligibleStatuses.includes(reservation.status)) throw new Error('الحجز غير مؤهل لتسوية الاسترجاع حالياً.');
  if ((reservation.settledDepositAmount ?? 0) > 0 && (reservation.securityDepositAmount === undefined)) {
    throw new Error('تمت تسوية عربون هذا الحجز بالفعل.');
  }
  // For canonical, check if security deposit already fully settled
  if (reservation.securityDepositAmount !== undefined) {
    const collected = reservation.securityDepositCollectedAmount ?? 0;
    const refunded = reservation.securityDepositRefundedAmount ?? 0;
    const retained = reservation.securityDepositRetainedAmount ?? 0;
    const liability = Math.max(collected - refunded - retained, 0);
    if (liability === 0 && collected > 0 && (reservation.settledDepositAmount ?? 0) > 0) {
      throw new Error('تمت تسوية التأمين المسترد لهذا الحجز بالفعل.');
    }
    // Prevent settlement if needs classification
    if (reservation.needsFinancialClassification) {
      throw new Error('هذا الحجز يحتاج مراجعة مالية لتصنيف العربون قبل التسوية.');
    }
  }

  if (![input.lateFee, input.damageFee, input.refundAmount, input.settledDepositAmount, input.retainedDepositAmount].every((amount) => Number.isFinite(amount) && amount >= 0)) throw new Error('بيانات التسوية المالية غير صالحة.');
  if (input.refundAmount + input.retainedDepositAmount > input.settledDepositAmount + 1e-6) {
    // For canonical, also check against liability
    if (reservation.securityDepositAmount !== undefined) {
      const collected = reservation.securityDepositCollectedAmount ?? 0;
      const refunded = reservation.securityDepositRefundedAmount ?? 0;
      const retained = reservation.securityDepositRetainedAmount ?? 0;
      const available = Math.max(collected - refunded - retained, 0);
      if (input.refundAmount + input.retainedDepositAmount > available + 1e-6) {
        throw new Error('إجمالي رد التأمين والتأمين المحتجز يتجاوز المبلغ المتاح.');
      }
    } else {
      throw new Error('إجمالي رد العربون والعربون المحتجز يتجاوز قيمة العربون المسوّاة.');
    }
  }

  return persist(reservations, {
    ...reservation,
    assessedFeesAmount: (reservation.assessedFeesAmount ?? 0)
      + (input.feesAlreadyAssessed ? 0 : input.lateFee + input.damageFee),
    refundedAmount: (reservation.refundedAmount ?? 0) + input.refundAmount,
    settledDepositAmount: (reservation.settledDepositAmount ?? 0) + input.settledDepositAmount,
    retainedDepositAmount: (reservation.retainedDepositAmount ?? 0) + input.retainedDepositAmount,
    // Canonical
    securityDepositRefundedAmount: (reservation.securityDepositRefundedAmount ?? 0) + input.refundAmount,
    securityDepositRetainedAmount: (reservation.securityDepositRetainedAmount ?? 0) + input.retainedDepositAmount,
    securityDepositCollectedAmount: reservation.securityDepositCollectedAmount ?? input.securityDepositCollectedAmount ?? 0,
  });
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
  const paymentOverrideReason = assertLineDeliveryPaymentGate(reservation, input.paymentOverrideReason);
  validateOperationDateTime(input.deliveryDateTime, 'تاريخ ووقت التسليم');

  const updatedLine: ContractLine = {
    ...line,
    deliveryStatus: 'delivered',
    deliveryDateTime: input.deliveryDateTime,
    deliveryCondition: input.deliveryCondition?.trim() || undefined,
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
    markDressRented(line.dressCodeSnapshot);
  }

  recordAudit({
    action: 'deliver',
    entityType: 'reservation',
    entityId: reservation.id,
    summary: `تم تسليم البند ${line.dressCodeSnapshot} من الحجز ${reservation.reservationNumber}.`,
    nextValues: {
      lineId: line.id,
      deliveryStatus: 'delivered',
      deliveryDateTime: input.deliveryDateTime,
      paymentOverrideReason,
    },
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
  if (line.deliveryStatus === 'returned') {
    throw new Error('تم استرجاع هذا البند بالفعل.');
  }
  if (line.deliveryStatus !== 'delivered' && line.deliveryStatus !== 'late') {
    throw new Error('هذا البند لم يتم تسليمه بعد.');
  }
  if (!allowedReturnItemStatuses.has(input.nextItemStatus)) {
    throw new Error('العنصر المسترجع يجب أن ينتقل إلى الفحص أو الغسيل أو الصيانة أو التالف، ولا يصبح متاحاً مباشرة.');
  }
  const returnTimestamp = validateOperationDateTime(input.returnDateTime, 'تاريخ ووقت الاسترجاع');
  if (line.deliveryDateTime && returnTimestamp < new Date(line.deliveryDateTime).getTime()) {
    throw new Error('وقت الاسترجاع لا يمكن أن يسبق وقت التسليم.');
  }
  if (![input.lateFee, input.damageFee].every((amount) => Number.isFinite(amount) && amount >= 0)) {
    throw new Error('رسوم التأخير أو الضرر غير صالحة.');
  }

  const updatedLine: ContractLine = {
    ...line,
    deliveryStatus: 'returned',
    returnDateTime: input.returnDateTime,
    returnCondition: input.returnCondition?.trim() || undefined,
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
    nextValues: {
      lineId: line.id,
      deliveryStatus: updatedLine.deliveryStatus,
      returnDateTime: input.returnDateTime,
      lateFee: input.lateFee,
      damageFee: input.damageFee,
    },
  });

  return persist(reservations, updated);
}

export function getReservationsNeedingFinancialClassification(): Reservation[] {
  return getReservations().filter((r) => r.needsFinancialClassification);
}
