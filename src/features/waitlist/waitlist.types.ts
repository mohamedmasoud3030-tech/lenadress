/**
 * Waiting list.
 *
 * A customer asks for a dress that is already booked on her date. Today she
 * simply leaves, and if that booking is later cancelled nobody remembers she
 * wanted it — so the item sits idle and the sale is lost twice over.
 *
 * A waitlist entry records the want. When the period frees up the app can say
 * who to call, in the order they asked.
 */

export type WaitlistStatus =
  /** Still waiting for the period to free up. */
  | 'waiting'
  /** The item became free and the customer was contacted. */
  | 'notified'
  /** Turned into an actual reservation. */
  | 'converted'
  /** No longer wanted, or the date passed. */
  | 'closed';

export type WaitlistEntry = {
  id: string;
  /** Stable customer reference; the phone is a display snapshot. */
  customerId: string;
  customerName: string;
  customerPhone: string;
  /**
   * What she wants. A design is preferred, because any piece of it will do —
   * that is the whole reason designs exist. A specific piece is also allowed.
   */
  designId?: string;
  designCode?: string;
  designName?: string;
  inventoryItemId?: string;
  dressCode?: string;
  /** Optional narrowing when only one size or colour is acceptable. */
  size?: string;
  color?: string;
  pickupDate: string;
  returnDate: string;
  status: WaitlistStatus;
  notes?: string;
  createdAt: string;
  notifiedAt?: string;
  closedAt?: string;
  /** Reservation created from this entry, when it converted. */
  reservationNumber?: string;
};

export type AddWaitlistEntryInput = {
  customerId: string;
  designId?: string;
  inventoryItemId?: string;
  size?: string;
  color?: string;
  pickupDate: string;
  returnDate: string;
  notes?: string;
};

export type WaitlistFilters = {
  search: string;
  status: 'all' | WaitlistStatus;
};

/** A waiting entry whose wanted period is now actually free. */
export type WaitlistOpportunity = {
  entry: WaitlistEntry;
  /** Pieces that became bookable for her exact period. */
  availableCodes: string[];
  /** Ready-to-send Arabic message telling her it is free. */
  message: string;
};

export type WaitlistSummary = {
  waiting: number;
  ready: number;
  notified: number;
  converted: number;
};
