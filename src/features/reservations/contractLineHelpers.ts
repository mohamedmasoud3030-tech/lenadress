import { generateId } from '../../services/localDatabase';
import { getTodayISO, isValidTime } from '../../shared/utils/date';
import {
  calculateRentalOutstanding,
  calculateReservationRemainingAmount,
} from '../../shared/utils/financialCalculations.js';
import { getDresses } from '../dresses/dress.service';
import { getDressSecurityDepositAmount } from '../dresses/dress.types';
import {
  findItemConflicts,
} from './reservationConflicts';
import type {
  ContractLine,
  CreateReservationLineInput,
  LineConflictResult,
  LineDeliveryStatus,
  Reservation,
} from './reservation.types';
import {
  getLineSecurityDepositAmount,
  getReservationSecurityDepositAmount,
  getLineBookingAdvanceAmount,
  getReservationBookingAdvanceAmount,
} from './reservation.types';

/**
 * Helpers for multi-item contract lines.
 *
 * Every function in this module operates on the `lines` array of a reservation,
 * keeping the top-level fields in sync for backward compatibility. The first
 * line is the "primary" line whose data is mirrored to the top-level.
 */

const reservableDressStatuses = new Set(['available', 'reserved', 'rented']);

// ── Line construction ────────────────────────────────────────────────────

export function buildLineFromInput(
  input: CreateReservationLineInput,
  defaults: { pickupDate: string; pickupTime?: string; returnDate: string; returnTime?: string },
): ContractLine {
  const dress = getDresses().find((item) => item.id === input.dressId);
  if (!dress) throw new Error('العنصر المحدد غير موجود.');
  if (!dress.isForRent || !reservableDressStatuses.has(dress.status)) {
    throw new Error(`العنصر ${dress.code} غير مؤهل للإيجار حالياً.`);
  }

  const listRentalPrice = dress.rentalPrice;
  const agreedRentalPrice = input.rentalPrice ?? listRentalPrice;
  if (!Number.isFinite(agreedRentalPrice) || agreedRentalPrice < 0) {
    throw new Error('قيمة الإيجار المتفق عليها غير صالحة.');
  }
  if (agreedRentalPrice > listRentalPrice) {
    throw new Error('قيمة الإيجار المتفق عليها لا يمكن أن تتجاوز السعر المسجل للعنصر.');
  }

  // Canonical security deposit: prefer securityDepositAmount, fallback to legacy depositAmount, then dress default // legacy compat
  const rawSecurityDeposit = input.securityDepositAmount ?? input.depositAmount ?? getDressSecurityDepositAmount(dress); // legacy compat
  const securityDepositAmount = rawSecurityDeposit ?? 0;
  if (!Number.isFinite(securityDepositAmount) || securityDepositAmount < 0) {
    throw new Error('قيمة التأمين المسترد غير صالحة.');
  }

  const bookingAdvanceAmount = input.bookingAdvanceAmount ?? 0;
  if (!Number.isFinite(bookingAdvanceAmount) || bookingAdvanceAmount < 0) {
    throw new Error('قيمة دفعة الحجز غير صالحة.');
  }

  // Legacy field kept for backward compatibility
  const depositAmount = securityDepositAmount; // legacy compat: deprecated field synced

  const pickupDate = input.pickupDate ?? defaults.pickupDate;
  const returnDate = input.returnDate ?? defaults.returnDate;
  const pickupTime = input.pickupTime ?? defaults.pickupTime;
  const returnTime = input.returnTime ?? defaults.returnTime;

  if (!pickupDate || !returnDate) throw new Error('حددي تاريخ الاستلام والإرجاع.');
  if (pickupDate < getTodayISO()) throw new Error('تاريخ الاستلام لا يمكن أن يكون في الماضي.');
  if (returnDate <= pickupDate) throw new Error('تاريخ الإرجاع يجب أن يكون بعد تاريخ الاستلام.');

  return {
    id: generateId(),
    inventoryItemId: dress.id,
    dressCodeSnapshot: dress.code,
    dressNameSnapshot: dress.name,
    pickupDate,
    pickupTime: isValidTime(pickupTime) ? pickupTime : undefined,
    returnDate,
    returnTime: isValidTime(returnTime) ? returnTime : undefined,
    rentalPrice: agreedRentalPrice,
    listRentalPrice,
    depositAmount, // legacy compat
    securityDepositAmount,
    bookingAdvanceAmount,
    legacyDepositAmount: input.depositAmount,
    deliveryStatus: 'pending_delivery',
    lateFee: 0,
    damageFee: 0,
    notes: input.notes?.trim() || undefined,
  };
}

// ── Conflict checking ────────────────────────────────────────────────────

export function checkLineConflicts(
  lines: CreateReservationLineInput[],
  defaults: { pickupDate: string; returnDate: string },
  existingReservations: Reservation[],
  excludeReservationNumber?: string,
): LineConflictResult[] {
  const results: LineConflictResult[] = [];

  lines.forEach((input, index) => {
    const dress = getDresses().find((item) => item.id === input.dressId);
    if (!dress) return;

    const pickupDate = input.pickupDate ?? defaults.pickupDate;
    const returnDate = input.returnDate ?? defaults.returnDate;

    const conflicts = findItemConflicts(
      {
        inventoryItemId: dress.id,
        dressCode: dress.code,
        pickupDate,
        returnDate,
        excludeReservationNumber,
      },
      existingReservations,
    );

    results.push({
      lineIndex: index,
      dressCode: dress.code,
      dressName: dress.name,
      conflicts,
    });
  });

  return results;
}

/**
 * Asserts that no line has conflicts. Throws with all conflict messages.
 */
export function assertNoLineConflicts(results: LineConflictResult[]): void {
  const messages = results
    .filter((result) => result.conflicts.length > 0)
    .map((result) => `القطعة ${result.dressCode} (${result.dressName}): ${result.conflicts.map((c) => c.message).join(' ')}`);

  if (messages.length > 0) {
    throw new Error(messages.join(' '));
  }
}

// ── Financial calculations ───────────────────────────────────────────────

export function calculateLinesTotal(lines: ContractLine[]): number {
  // Legacy total = rental + security deposit (for backward compat cash to collect)
  return lines.reduce((sum, line) => sum + line.rentalPrice + getLineSecurityDepositAmount(line), 0);
}

export function calculateLinesRentalPrice(lines: ContractLine[]): number {
  return lines.reduce((sum, line) => sum + line.rentalPrice, 0);
}

/** @deprecated use calculateLinesSecurityDeposit */
export function calculateLinesDeposit(lines: ContractLine[]): number {
  return calculateLinesSecurityDeposit(lines);
}

export function calculateLinesSecurityDeposit(lines: ContractLine[]): number {
  return lines.reduce((sum, line) => sum + getLineSecurityDepositAmount(line), 0);
}

export function calculateLinesBookingAdvance(lines: ContractLine[]): number {
  return lines.reduce((sum, line) => sum + getLineBookingAdvanceAmount(line), 0);
}

export function calculateLinesFees(lines: ContractLine[]): number {
  return lines.reduce((sum, line) => sum + line.lateFee + line.damageFee, 0);
}

// ── Status derivation ────────────────────────────────────────────────────

/**
 * Derives the overall reservation status from its line statuses.
 *
 * Rules:
 * - If all lines are pending_delivery → confirmed (or pending if no payment)
 * - If any line is delivered and any is not → delivered (partial)
 * - If all lines are delivered → delivered
 * - If any line is late → overdue
 * - If all lines are returned → returned
 */
export function deriveReservationStatus(
  lines: ContractLine[],
  currentStatus: Reservation['status'],
): Reservation['status'] {
  if (lines.length === 0) return currentStatus;

  const statuses = new Set(lines.map((line) => line.deliveryStatus));

  // All returned → returned
  if (statuses.size === 1 && statuses.has('returned')) return 'returned';

  // Any late → overdue
  if (statuses.has('late')) return 'overdue';

  // All pending → confirmed (or keep current if already delivered)
  if (statuses.size === 1 && statuses.has('pending_delivery')) {
    if (currentStatus === 'delivered' || currentStatus === 'overdue') return 'delivered';
    return 'confirmed';
  }

  // Has delivered (possibly with some pending) → delivered
  if (statuses.has('delivered')) return 'delivered';

  return currentStatus;
}

// ── Top-level field sync ─────────────────────────────────────────────────

/**
 * Syncs the top-level reservation fields from the first line.
 *
 * This ensures backward compatibility: any code that reads reservation.dressCode,
 * reservation.rentalPrice, etc. will get the first line's data.
 */
export function syncTopLevelFromLines(reservation: Reservation): Reservation {
  if (!reservation.lines || reservation.lines.length === 0) return reservation;

  const primary = reservation.lines[0];
  const totalAmount = calculateLinesTotal(reservation.lines);
  const rentalTotal = calculateLinesRentalPrice(reservation.lines);
  const bookingAdvanceTotal = calculateLinesBookingAdvance(reservation.lines);

  // Canonical remaining is rental outstanding, not including security deposit
  const remainingAmount = calculateRentalOutstanding({
    rentalTotal,
    assessedFees: reservation.assessedFeesAmount ?? 0,
    bookingAdvanceCollected: reservation.bookingAdvanceCollectedAmount ?? reservation.bookingAdvanceAmount ?? bookingAdvanceTotal,
    rentalCollected: reservation.rentalCollectedAmount ?? reservation.paidAmount ?? 0,
    rentalRefunded: reservation.rentalRefundedAmount ?? 0,
    retainedDeposit: reservation.securityDepositRetainedAmount ?? reservation.retainedDepositAmount ?? 0,
  });

  // Fallback legacy calculation if new fields missing (for old backups)
  const legacyRemaining = calculateReservationRemainingAmount({
    totalAmount,
    assessedFeesAmount: reservation.assessedFeesAmount,
    paidAmount: reservation.paidAmount,
    settledDepositAmount: reservation.settledDepositAmount,
    refundedAmount: reservation.refundedAmount,
  });

  const hasNewFields = reservation.securityDepositAmount !== undefined || reservation.bookingAdvanceAmount !== undefined;

  return {
    ...reservation,
    inventoryItemId: primary.inventoryItemId,
    dressCode: primary.dressCodeSnapshot,
    dressName: primary.dressNameSnapshot,
    dressCodeSnapshot: primary.dressCodeSnapshot,
    dressNameSnapshot: primary.dressNameSnapshot,
    pickupDate: primary.pickupDate,
    pickupTime: primary.pickupTime,
    returnDate: primary.returnDate,
    returnTime: primary.returnTime,
    rentalPrice: primary.rentalPrice,
    listRentalPrice: primary.listRentalPrice,
    depositAmount: primary.securityDepositAmount ?? primary.depositAmount, // legacy compat

    securityDepositAmount: getLineSecurityDepositAmount(primary),
    bookingAdvanceAmount: getLineBookingAdvanceAmount(primary),
    totalAmount,
    // Use canonical remaining when new fields exist, otherwise legacy
    remainingAmount: hasNewFields ? remainingAmount : legacyRemaining,
  };
}

/** Canonical refundable-deposit total across every contract line. */
export function getReservationDepositTotal(reservation: Reservation): number {
  return calculateLinesDeposit(getReservationLines(reservation));
}

export function getReservationSecurityDepositTotal(reservation: Reservation): number {
  return calculateLinesSecurityDeposit(getReservationLines(reservation));
}

export function getReservationRentalTotal(reservation: Reservation): number {
  return calculateLinesRentalPrice(getReservationLines(reservation));
}

export function getReservationBookingAdvanceTotal(reservation: Reservation): number {
  return calculateLinesBookingAdvance(getReservationLines(reservation));
}

/**
 * Allocates a reservation-level movement to one contract item.
 *
 * Payments are posted against the contract, while profitability is reported
 * per item. Rental-price weight is the durable, agreed-at-booking split. An
 * all-zero complimentary contract falls back to an equal split so totals still
 * reconcile without assigning the whole movement to every item.
 */
export function getReservationItemShare(reservation: Reservation, itemCode: string): number {
  const lines = getReservationLines(reservation);
  const matching = lines.filter((line) => line.dressCodeSnapshot === itemCode);
  if (matching.length === 0) return 0;

  const totalRentalPrice = calculateLinesRentalPrice(lines);
  if (totalRentalPrice > 0) {
    return matching.reduce((total, line) => total + line.rentalPrice, 0) / totalRentalPrice;
  }
  return matching.length / lines.length;
}

// ── Legacy compatibility ─────────────────────────────────────────────────

/**
 * Returns the lines array, deriving a single-element array from the top-level
 * fields when the reservation was created before multi-item support.
 */
export function getReservationLines(reservation: Reservation): ContractLine[] {
  if (reservation.lines && reservation.lines.length > 0) return reservation.lines;

  // Derive a single line from the top-level fields for backward compatibility
  return [{
    id: `legacy-${reservation.id}`,
    inventoryItemId: reservation.inventoryItemId,
    dressCodeSnapshot: reservation.dressCodeSnapshot ?? reservation.dressCode,
    dressNameSnapshot: reservation.dressNameSnapshot ?? reservation.dressName,
    pickupDate: reservation.pickupDate,
    pickupTime: reservation.pickupTime,
    returnDate: reservation.returnDate,
    returnTime: reservation.returnTime,
    rentalPrice: reservation.rentalPrice,
    listRentalPrice: reservation.listRentalPrice,
    depositAmount: reservation.securityDepositAmount ?? reservation.depositAmount, // legacy compat
    securityDepositAmount: getReservationSecurityDepositAmount(reservation),
    bookingAdvanceAmount: getReservationBookingAdvanceAmount(reservation),
    deliveryStatus: deriveLineDeliveryStatus(reservation.status),
    lateFee: 0,
    damageFee: 0,
    notes: reservation.notes,
  }];
}

/**
 * Derives the per-line delivery status from the overall reservation status.
 * Used only for legacy single-item reservations without an explicit lines array.
 */
export function deriveLineDeliveryStatus(reservationStatus: Reservation['status']): LineDeliveryStatus {
  switch (reservationStatus) {
    case 'delivered': return 'delivered';
    case 'overdue': return 'late';
    case 'returned': return 'returned';
    default: return 'pending_delivery';
  }
}

/**
 * Determines which lines are still with the customer (delivered but not returned).
 */
export function getOutstandingLines(reservation: Reservation): ContractLine[] {
  return getReservationLines(reservation).filter(
    (line) => line.deliveryStatus === 'delivered' || line.deliveryStatus === 'late',
  );
}

/**
 * Determines which lines are still pending delivery.
 */
export function getPendingDeliveryLines(reservation: Reservation): ContractLine[] {
  return getReservationLines(reservation).filter(
    (line) => line.deliveryStatus === 'pending_delivery',
  );
}

/**
 * Determines which lines have been returned.
 */
export function getReturnedLines(reservation: Reservation): ContractLine[] {
  return getReservationLines(reservation).filter(
    (line) => line.deliveryStatus === 'returned',
  );
}

/**
 * Returns a summary of all item codes in the reservation, useful for search
 * and display.
 */
export function getReservationItemCodes(reservation: Reservation): string[] {
  return getReservationLines(reservation).map((line) => line.dressCodeSnapshot);
}

/**
 * Returns a summary of all item names in the reservation, useful for search
 * and display.
 */
export function getReservationItemNames(reservation: Reservation): string[] {
  return getReservationLines(reservation).map((line) => line.dressNameSnapshot);
}

/**
 * Checks if a reservation is a multi-item contract.
 */
export function isMultiItemReservation(reservation: Reservation): boolean {
  return (reservation.lines?.length ?? 0) > 1;
}
