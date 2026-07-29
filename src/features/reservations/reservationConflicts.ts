import { addDaysISO } from '../../shared/utils/date';
import { getAppPreferences } from '../preferences/preferences.service';
import type { Reservation, ReservationStatus } from './reservation.types';
import type { ReservationAccessory } from '../accessories/accessory.types';
import { getReservationLines } from './contractLineHelpers';

/**
 * One central conflict rule for the whole application.
 *
 * Every path that can put an item on a date — creating a reservation, moving
 * its dates, swapping the item, extending the rental, or attaching an accessory
 * — resolves through this module. UI validation is only a preview; the service
 * layer calls the same functions before it writes, so a conflicting period can
 * never be persisted by bypassing a screen.
 *
 * Rule set:
 * - Only **active** reservations block a period. Cancelled and returned
 *   reservations release their item immediately.
 * - The blocked window is widened by the configured preparation days before the
 *   pickup and cleaning days after the return.
 * - A reservation never conflicts with itself, so editing dates in place works.
 * - For multi-item contracts, each line is checked independently.
 */

export const ACTIVE_RESERVATION_STATUSES: ReadonlySet<ReservationStatus> = new Set<ReservationStatus>([
  'pending',
  'confirmed',
  'delivered',
  'overdue',
]);

export function isActiveReservation(reservation: Pick<Reservation, 'status'>): boolean {
  return ACTIVE_RESERVATION_STATUSES.has(reservation.status);
}

export type BufferSettings = {
  preparationDaysBeforePickup: number;
  cleaningDaysAfterReturn: number;
};

export function getBufferSettings(): BufferSettings {
  const preferences = getAppPreferences();
  return {
    preparationDaysBeforePickup: preferences.preparationDaysBeforePickup,
    cleaningDaysAfterReturn: preferences.cleaningDaysAfterReturn,
  };
}

export type DatePeriod = { pickupDate: string; returnDate: string };

/** Expands a booked period by the preparation and cleaning windows. */
export function expandPeriodWithBuffers(period: DatePeriod, buffers: BufferSettings): DatePeriod {
  return {
    pickupDate: addDaysISO(period.pickupDate, -buffers.preparationDaysBeforePickup),
    returnDate: addDaysISO(period.returnDate, buffers.cleaningDaysAfterReturn),
  };
}

export function periodsOverlap(left: DatePeriod, right: DatePeriod): boolean {
  return left.pickupDate <= right.returnDate && right.pickupDate <= left.returnDate;
}

export type ItemConflictCheck = {
  /** Stable item reference; preferred over the code. */
  inventoryItemId?: string;
  dressCode: string;
  pickupDate: string;
  returnDate: string;
  /** Reservation being edited, excluded from its own conflict check. */
  excludeReservationNumber?: string;
};

export type ConflictDetail = {
  reservationNumber: string;
  pickupDate: string;
  returnDate: string;
  message: string;
};

/**
 * Every active reservation whose buffered window overlaps the requested one.
 *
 * For multi-item contracts, each line's dates and item are checked independently.
 */
export function findItemConflicts(check: ItemConflictCheck, reservations: Reservation[]): ConflictDetail[] {
  const buffers = getBufferSettings();
  const requested: DatePeriod = { pickupDate: check.pickupDate, returnDate: check.returnDate };

  const conflicts: ConflictDetail[] = [];

  reservations
    .filter((reservation) => reservation.reservationNumber !== check.excludeReservationNumber)
    .filter(isActiveReservation)
    .forEach((reservation) => {
      // Check each line independently
      const lines = getReservationLines(reservation);
      lines.forEach((line) => {
        // Check if this line's item matches
        const itemMatches = (check.inventoryItemId && line.inventoryItemId && line.inventoryItemId === check.inventoryItemId)
          || (!check.inventoryItemId || !line.inventoryItemId) && line.dressCodeSnapshot === check.dressCode;

        if (!itemMatches) return;

        const linePeriod: DatePeriod = { pickupDate: line.pickupDate, returnDate: line.returnDate };
        if (periodsOverlap(expandPeriodWithBuffers(linePeriod, buffers), requested)) {
          // Avoid duplicate conflicts from the same reservation
          if (!conflicts.some((c) => c.reservationNumber === reservation.reservationNumber)) {
            conflicts.push({
              reservationNumber: reservation.reservationNumber,
              pickupDate: line.pickupDate,
              returnDate: line.returnDate,
              message: `العنصر محجوز ضمن الحجز ${reservation.reservationNumber} من ${line.pickupDate} إلى ${line.returnDate} بعد احتساب أيام التجهيز والتنظيف.`,
            });
          }
        }
      });
    });

  return conflicts;
}

export function hasItemConflict(check: ItemConflictCheck, reservations: Reservation[]): boolean {
  return findItemConflicts(check, reservations).length > 0;
}

export type AccessoryConflictCheck = {
  accessoryId: string;
  pickupDate: string;
  returnDate: string;
  excludeReservationNumber?: string;
};

/**
 * Accessory conflicts are resolved against the reservations their links point
 * at, so an accessory attached to a cancelled reservation is free again without
 * any extra bookkeeping.
 */
export function findAccessoryConflicts(
  check: AccessoryConflictCheck,
  links: ReservationAccessory[],
  reservations: Reservation[],
): ConflictDetail[] {
  const buffers = getBufferSettings();
  const requested: DatePeriod = { pickupDate: check.pickupDate, returnDate: check.returnDate };
  const reservationByNumber = new Map(reservations.map((reservation) => [reservation.reservationNumber, reservation]));

  return links
    .filter((link) => link.accessoryId === check.accessoryId)
    .filter((link) => link.reservationNumber !== check.excludeReservationNumber)
    .map((link) => reservationByNumber.get(link.reservationNumber))
    .filter((reservation): reservation is Reservation => reservation !== undefined)
    .filter(isActiveReservation)
    .filter((reservation) => periodsOverlap(expandPeriodWithBuffers(reservation, buffers), requested))
    .map((reservation) => ({
      reservationNumber: reservation.reservationNumber,
      pickupDate: reservation.pickupDate,
      returnDate: reservation.returnDate,
      message: `الملحق محجوز ضمن الحجز ${reservation.reservationNumber} من ${reservation.pickupDate} إلى ${reservation.returnDate} بعد احتساب أيام التجهيز والتنظيف.`,
    }));
}

export function hasAccessoryConflict(
  check: AccessoryConflictCheck,
  links: ReservationAccessory[],
  reservations: Reservation[],
): boolean {
  return findAccessoryConflicts(check, links, reservations).length > 0;
}

export function assertNoConflicts(conflicts: ConflictDetail[]): void {
  if (conflicts.length > 0) throw new Error(conflicts.map((conflict) => conflict.message).join(' '));
}
