import type { Dress } from '../dresses/dress.types';
import type { Accessory, AccessoryCategory } from '../accessories/accessory.types';
import type { DressCategory, DressStatus } from '../dresses/dress.types';

/**
 * Availability search answers the question the showroom is actually asked at
 * the counter: *"I have a wedding on 20 September — what do you have in white,
 * size 42?"*
 *
 * Until now the application only supported the opposite direction: pick an
 * item, then be told it clashes. That forced the operator to guess an item,
 * hit a conflict, back out and guess again — in front of the customer. The
 * booking data was always sufficient to answer the real question; only the
 * query direction was missing.
 */

/** Why a piece cannot be offered for the requested period. */
export type UnavailabilityReason =
  | 'booked'
  | 'not_for_rent'
  | 'damaged'
  | 'sold'
  | 'in_service'
  | 'archived';

export type AvailabilitySearchInput = {
  pickupDate: string;
  returnDate: string;
  /** Free text over name, code, barcode, colour and design code. */
  search?: string;
  category?: DressCategory | 'all';
  /** Exact size label, matched case-insensitively after Arabic folding. */
  size?: string;
  /** Colour term, matched as a substring so "أبيض" finds "أبيض عاجي". */
  color?: string;
  minRentalPrice?: number;
  maxRentalPrice?: number;
  /** Include pieces that are busy, flagged with the reason. Default false. */
  includeUnavailable?: boolean;
};

export type AvailableItem = {
  dress: Dress;
  available: boolean;
  /** Present only when `available` is false. */
  reason?: UnavailabilityReason;
  /** Booked periods overlapping the request, so the operator can counter-offer. */
  conflicts: Array<{ reservationNumber: string; pickupDate: string; returnDate: string }>;
  /**
   * When the piece is busy, the first date from which it is continuously free
   * for the requested duration. Lets the operator say "not that weekend, but
   * it is yours from the 27th" instead of a bare "no".
   */
  nextFreeDate?: string;
  /** Sibling pieces of the same design that ARE free for the period. */
  alternativePieceCodes: string[];
};

export type AvailableAccessory = {
  accessory: Accessory;
  available: boolean;
  reason?: UnavailabilityReason;
  conflicts: Array<{ reservationNumber: string; pickupDate: string; returnDate: string }>;
};

export type AvailabilitySearchResult = {
  period: { pickupDate: string; returnDate: string };
  /** Nights the customer keeps the item; drives duration-aware suggestions. */
  durationDays: number;
  items: AvailableItem[];
  accessories: AvailableAccessory[];
  summary: {
    availableItems: number;
    busyItems: number;
    availableAccessories: number;
    /** Distinct sizes among the available pieces, for the filter chips. */
    sizes: string[];
    colors: string[];
  };
};

export type AvailabilityAccessoryFilters = {
  search?: string;
  category?: AccessoryCategory | 'all';
  includeUnavailable?: boolean;
};

/** Statuses that make a piece unofferable regardless of the calendar. */
export const NON_OFFERABLE_STATUSES: ReadonlySet<DressStatus> = new Set<DressStatus>([
  'damaged',
  'sold',
  'inactive',
]);

/** Statuses meaning the piece is physically in the back room, not on the rail. */
export const IN_SERVICE_STATUSES: ReadonlySet<DressStatus> = new Set<DressStatus>([
  'inspection',
  'laundry',
  'maintenance',
]);
