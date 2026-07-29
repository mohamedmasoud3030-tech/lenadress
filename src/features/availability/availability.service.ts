import { addDaysISO, parseLocalDate } from '../../shared/utils/date';
import { matchesSearchQuery, normalizeSearchText } from '../../shared/utils/search';
import { getDresses } from '../dresses/dress.service';
import { getAccessories, isAccessoryBookable } from '../accessories/accessory.service';
import { getReservationAccessories } from '../accessories/reservationAccessory.service';
import { getReservations } from '../reservations/reservation.service';
import {
  findAccessoryConflicts,
  findItemConflicts,
  getBufferSettings,
} from '../reservations/reservationConflicts';
import type { Dress } from '../dresses/dress.types';
import type { Reservation } from '../reservations/reservation.types';
import {
  IN_SERVICE_STATUSES,
  NON_OFFERABLE_STATUSES,
  type AvailabilityAccessoryFilters,
  type AvailabilitySearchInput,
  type AvailabilitySearchResult,
  type AvailableAccessory,
  type AvailableItem,
  type UnavailabilityReason,
} from './availability.types';

/**
 * Reverse-direction availability search.
 *
 * Everything here resolves through the shared conflict rule in
 * `reservationConflicts.ts` rather than reading a stored availability flag.
 * That is deliberate: a stored flag would be a second source of truth and would
 * drift the moment a reservation is cancelled, rescheduled or back-dated. The
 * cost is recomputation on every query, which is negligible for a
 * single-showroom catalogue and is the same rule the write path enforces, so
 * this screen can never promise a piece the booking form would then refuse.
 */

/** How far ahead `nextFreeDate` will look before giving up. */
const NEXT_FREE_SEARCH_HORIZON_DAYS = 180;

function daysBetween(pickupDate: string, returnDate: string): number {
  const pickup = parseLocalDate(pickupDate).getTime();
  const back = parseLocalDate(returnDate).getTime();
  return Math.max(Math.round((back - pickup) / 86_400_000), 0);
}

function assertValidPeriod(pickupDate: string, returnDate: string): void {
  if (!pickupDate || !returnDate) throw new Error('يجب تحديد تاريخ الاستلام وتاريخ الإرجاع.');
  if (returnDate < pickupDate) throw new Error('تاريخ الإرجاع يجب أن يكون بعد تاريخ الاستلام.');
}

/** Status-based reasons, checked before the calendar. */
function statusReason(piece: Dress): UnavailabilityReason | undefined {
  if (piece.archivedAt) return 'archived';
  if (piece.status === 'damaged') return 'damaged';
  if (piece.status === 'sold') return 'sold';
  if (NON_OFFERABLE_STATUSES.has(piece.status)) return 'not_for_rent';
  if (!piece.isForRent) return 'not_for_rent';
  if (IN_SERVICE_STATUSES.has(piece.status)) return 'in_service';
  return undefined;
}

/**
 * The earliest date from which the piece is free for the whole requested
 * duration.
 *
 * Walks forward one day at a time rather than solving analytically: the buffer
 * expansion makes booked windows non-contiguous in a way that is easy to get
 * subtly wrong in arithmetic, and re-asking the canonical rule cannot disagree
 * with it. The horizon bounds the loop so a permanently booked piece cannot
 * hang the screen.
 */
function findNextFreeDate(
  piece: Dress,
  reservations: Reservation[],
  pickupDate: string,
  durationDays: number,
): string | undefined {
  const buffers = getBufferSettings();
  const step = Math.max(buffers.cleaningDaysAfterReturn, 1);

  for (let offset = step; offset <= NEXT_FREE_SEARCH_HORIZON_DAYS; offset += 1) {
    const candidatePickup = addDaysISO(pickupDate, offset);
    const candidateReturn = addDaysISO(candidatePickup, durationDays);
    const conflicts = findItemConflicts({
      inventoryItemId: piece.id,
      dressCode: piece.code,
      pickupDate: candidatePickup,
      returnDate: candidateReturn,
    }, reservations);
    if (conflicts.length === 0) return candidatePickup;
  }

  return undefined;
}

function matchesItemFilters(piece: Dress, input: AvailabilitySearchInput): boolean {
  if (input.category && input.category !== 'all' && piece.category !== input.category) return false;

  if (input.size) {
    // Exact label match: size 42 and size 4 are different garments, so a
    // substring match here would be actively misleading.
    if (normalizeSearchText(piece.size) !== normalizeSearchText(input.size)) return false;
  }

  if (input.color) {
    // Substring, because showrooms record "أبيض عاجي" and the customer says
    // "أبيض".
    if (!matchesSearchQuery(input.color, [piece.color])) return false;
  }

  if (typeof input.minRentalPrice === 'number' && piece.rentalPrice < input.minRentalPrice) return false;
  if (typeof input.maxRentalPrice === 'number' && piece.rentalPrice > input.maxRentalPrice) return false;

  if (input.search && !matchesSearchQuery(input.search, [
    piece.name,
    piece.code,
    piece.barcode,
    piece.color,
    piece.size,
    piece.designCode,
    piece.description,
  ])) return false;

  return true;
}

/**
 * Finds every rentable piece for a period, with the reason and a counter-offer
 * for the ones that are busy.
 */
export function searchAvailability(input: AvailabilitySearchInput): AvailabilitySearchResult {
  assertValidPeriod(input.pickupDate, input.returnDate);

  const durationDays = daysBetween(input.pickupDate, input.returnDate);
  const reservations = getReservations();
  const pieces = getDresses().filter((piece) => matchesItemFilters(piece, input));

  const evaluated: AvailableItem[] = pieces.map((piece) => {
    const reason = statusReason(piece);
    const conflicts = reason
      ? []
      : findItemConflicts({
        inventoryItemId: piece.id,
        dressCode: piece.code,
        pickupDate: input.pickupDate,
        returnDate: input.returnDate,
      }, reservations).map(({ reservationNumber, pickupDate, returnDate }) => ({
        reservationNumber,
        pickupDate,
        returnDate,
      }));

    const available = !reason && conflicts.length === 0;

    return {
      dress: piece,
      available,
      reason: available ? undefined : (reason ?? 'booked'),
      conflicts,
      nextFreeDate: available || reason
        ? undefined
        : findNextFreeDate(piece, reservations, input.pickupDate, durationDays),
      alternativePieceCodes: [],
    };
  });

  // Sibling suggestion: when a piece is busy, the same design in another size
  // or colour is usually an acceptable substitute, and the operator should not
  // have to look it up manually.
  const freeCodesByDesign = new Map<string, string[]>();
  evaluated.forEach((item) => {
    if (!item.available || !item.dress.designId) return;
    const existing = freeCodesByDesign.get(item.dress.designId) ?? [];
    existing.push(item.dress.code);
    freeCodesByDesign.set(item.dress.designId, existing);
  });

  evaluated.forEach((item) => {
    if (item.available || !item.dress.designId) return;
    item.alternativePieceCodes = (freeCodesByDesign.get(item.dress.designId) ?? [])
      .filter((code) => code !== item.dress.code);
  });

  const visible = input.includeUnavailable ? evaluated : evaluated.filter((item) => item.available);

  // Available first, then cheapest, then by code so the order is stable between
  // renders and between devices.
  visible.sort((left, right) => {
    if (left.available !== right.available) return left.available ? -1 : 1;
    if (left.dress.rentalPrice !== right.dress.rentalPrice) return left.dress.rentalPrice - right.dress.rentalPrice;
    return left.dress.code.localeCompare(right.dress.code);
  });

  const availableItems = evaluated.filter((item) => item.available);

  return {
    period: { pickupDate: input.pickupDate, returnDate: input.returnDate },
    durationDays,
    items: visible,
    accessories: [],
    summary: {
      availableItems: availableItems.length,
      busyItems: evaluated.length - availableItems.length,
      availableAccessories: 0,
      sizes: Array.from(new Set(availableItems.map((item) => item.dress.size).filter(Boolean))).sort(),
      colors: Array.from(new Set(availableItems.map((item) => item.dress.color).filter(Boolean))).sort(),
    },
  };
}

/** The same question for accessories, resolved through the accessory conflict rule. */
export function searchAvailableAccessories(
  pickupDate: string,
  returnDate: string,
  filters: AvailabilityAccessoryFilters = {},
): AvailableAccessory[] {
  assertValidPeriod(pickupDate, returnDate);

  const reservations = getReservations();
  const links = getReservationAccessories();

  const evaluated = getAccessories()
    .filter((accessory) => {
      if (filters.category && filters.category !== 'all' && accessory.category !== filters.category) return false;
      if (filters.search && !matchesSearchQuery(filters.search, [accessory.name, accessory.code, accessory.barcode, accessory.notes])) {
        return false;
      }
      return true;
    })
    .map((accessory): AvailableAccessory => {
      let reason: UnavailabilityReason | undefined;
      if (accessory.retiredAt) reason = 'archived';
      else if (accessory.status === 'damaged') reason = 'damaged';
      else if (accessory.status === 'lost') reason = 'not_for_rent';
      else if (accessory.status === 'service') reason = 'in_service';
      else if (!isAccessoryBookable(accessory)) reason = 'not_for_rent';

      const conflicts = reason
        ? []
        : findAccessoryConflicts({ accessoryId: accessory.id, pickupDate, returnDate }, links, reservations)
          .map(({ reservationNumber, pickupDate: from, returnDate: to }) => ({
            reservationNumber,
            pickupDate: from,
            returnDate: to,
          }));

      const available = !reason && conflicts.length === 0;
      return { accessory, available, reason: available ? undefined : (reason ?? 'booked'), conflicts };
    });

  const visible = filters.includeUnavailable ? evaluated : evaluated.filter((entry) => entry.available);
  return visible.sort((left, right) => {
    if (left.available !== right.available) return left.available ? -1 : 1;
    return left.accessory.code.localeCompare(right.accessory.code);
  });
}

/**
 * Convenience wrapper combining pieces and accessories in one pass, which is
 * what the availability screen renders.
 */
export function searchAvailabilityWithAccessories(
  input: AvailabilitySearchInput,
  accessoryFilters: AvailabilityAccessoryFilters = {},
): AvailabilitySearchResult {
  const result = searchAvailability(input);
  const accessories = searchAvailableAccessories(input.pickupDate, input.returnDate, {
    ...accessoryFilters,
    includeUnavailable: accessoryFilters.includeUnavailable ?? input.includeUnavailable,
  });

  return {
    ...result,
    accessories,
    summary: {
      ...result.summary,
      availableAccessories: accessories.filter((entry) => entry.available).length,
    },
  };
}
