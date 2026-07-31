import type { ConditionPhoto } from '../delivery-return/deliveryReturn.types';

export type ReservationStatus = 'pending' | 'confirmed' | 'delivered' | 'returned' | 'cancelled' | 'overdue';

/**
 * Per-line delivery/return status for multi-item contracts.
 *
 * When a reservation has multiple items, each item can be delivered or returned
 * independently. The overall reservation status is derived from the aggregate
 * of its lines.
 */
export type LineDeliveryStatus =
  | 'pending_delivery'
  | 'delivered'
  | 'returned'
  | 'late';

/**
 * A single line (item) within a multi-item contract.
 *
 * Each line carries its own item reference, dates, pricing, delivery/return
 * state, condition photos, and late-fee data. This makes partial delivery,
 * partial return, and per-item late fees natural without any special-casing.
 *
 * The first line's data is also copied to the top-level reservation fields
 * for backward compatibility with code that assumes a single-item reservation.
 */
export type ContractLine = {
  id: string;
  /** Stable reference to the inventory item; never derived from the item code. */
  inventoryItemId?: string;
  /** Historical display snapshots captured when the reservation was created. */
  dressCodeSnapshot: string;
  dressNameSnapshot: string;
  /** Per-line dates so a veil can have a different return date than the dress. */
  pickupDate: string;
  pickupTime?: string;
  returnDate: string;
  returnTime?: string;
  /** Agreed rental price actually charged to the customer for this line. */
  rentalPrice: number;
  /**
   * Catalogue rental price at the moment of booking. The difference against
   * `rentalPrice` is the recorded discount for this line.
   */
  listRentalPrice?: number;
  /** Refundable deposit or down-payment for this line. */
  depositAmount: number;
  /** Per-line delivery/return state. */
  deliveryStatus: LineDeliveryStatus;
  /** Photographs of the piece as it left the showroom. */
  deliveryPhotos?: ConditionPhoto[];
  deliveryDateTime?: string;
  deliveryCondition?: string;
  /** Photographs of the piece as it came back. */
  returnPhotos?: ConditionPhoto[];
  returnDateTime?: string;
  returnCondition?: string;
  /** Late fees assessed on this line upon return. */
  lateFee: number;
  /** Damage fees assessed on this line upon return. */
  damageFee: number;
  /** Optional notes for this line. */
  notes?: string;
};

export type Reservation = {
  id: string;
  reservationNumber: string;
  /** Stable reference to the customer record; never derived from the phone number. */
  customerId?: string;
  /** Stable reference to the inventory item; never derived from the item code. */
  inventoryItemId?: string;
  customerName: string;
  customerPhone: string;
  dressCode: string;
  dressName: string;
  /** Historical display snapshots captured when the reservation was created. */
  customerNameSnapshot?: string;
  customerPhoneSnapshot?: string;
  dressCodeSnapshot?: string;
  dressNameSnapshot?: string;
  pickupDate: string;
  /** Local `HH:MM` pickup time; falls back to the configured default when absent. */
  pickupTime?: string;
  returnDate: string;
  /** Local `HH:MM` return time; falls back to the configured default when absent. */
  returnTime?: string;
  status: ReservationStatus;
  /** Agreed rental price actually charged to the customer. */
  rentalPrice: number;
  /**
   * Catalogue rental price at the moment of booking. The difference against
   * `rentalPrice` is the recorded discount; without this snapshot a later price
   * change would look like a concession that was never granted.
   */
  listRentalPrice?: number;
  depositAmount: number;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  assessedFeesAmount?: number;
  refundedAmount?: number;
  settledDepositAmount?: number;
  retainedDepositAmount?: number;
  notes?: string;
  /**
   * Multi-item contract lines.
   *
   * When absent, the reservation is a legacy single-item reservation and the
   * line data is derived from the top-level fields. When present, each line
   * carries its own item, dates, pricing, and delivery/return state.
   *
   * The first line's snapshot fields are always kept in sync with the top-level
   * reservation fields for backward compatibility.
   */
  lines?: ContractLine[];
};

export type ReservationFilters = {
  search: string;
  status: 'all' | ReservationStatus;
  timing: 'all' | 'today' | 'upcoming' | 'overdue';
};

export type ReservationSummary = {
  total: number;
  active: number;
  today: number;
  overdue: number;
};

export type AvailabilityCheck = {
  inventoryItemId?: string;
  dressCode: string;
  pickupDate: string;
  returnDate: string;
  /** Reservation being edited; excluded from its own conflict check. */
  excludeReservationNumber?: string;
};

export type RescheduleReservationInput = {
  reservationNumber: string;
  pickupDate: string;
  pickupTime?: string;
  returnDate: string;
  returnTime?: string;
  /** Optional item swap performed in the same guarded operation. */
  dressId?: string;
};

/**
 * Input for creating a multi-item reservation.
 * Each entry produces one contract line.
 */
export type CreateReservationLineInput = {
  dressId: string;
  pickupDate?: string;
  pickupTime?: string;
  returnDate?: string;
  returnTime?: string;
  rentalPrice?: number;
  depositAmount?: number;
  notes?: string;
};

/**
 * Input for creating a reservation (single or multi-item).
 */
export type CreateReservationInput = {
  customerId: string;
  /** Single-item shortcut: equivalent to lines=[{dressId}]. */
  dressId?: string;
  pickupDate: string;
  pickupTime?: string;
  returnDate: string;
  returnTime?: string;
  depositAmount: number;
  /** Agreed price when a discount is granted; defaults to the catalogue price. */
  rentalPrice?: number;
  notes?: string;
  /** Multi-item lines. When provided, dressId is ignored. */
  lines?: CreateReservationLineInput[];
};

/**
 * Result of a per-line conflict check for a multi-item contract.
 */
export type LineConflictResult = {
  lineIndex: number;
  dressCode: string;
  dressName: string;
  conflicts: import('./reservationConflicts').ConflictDetail[];
};

/**
 * Input for adding a line to an existing reservation.
 */
export type AddContractLineInput = {
  reservationNumber: string;
  dressId: string;
  pickupDate?: string;
  pickupTime?: string;
  returnDate?: string;
  returnTime?: string;
  rentalPrice?: number;
  depositAmount?: number;
  notes?: string;
};

/**
 * Input for removing a line from an existing reservation.
 */
export type RemoveContractLineInput = {
  reservationNumber: string;
  lineId: string;
};

/**
 * Input for updating a single line's data.
 */
export type UpdateContractLineInput = {
  reservationNumber: string;
  lineId: string;
  pickupDate?: string;
  pickupTime?: string;
  returnDate?: string;
  returnTime?: string;
  rentalPrice?: number;
  depositAmount?: number;
  notes?: string;
};

/**
 * Per-line delivery input.
 */
export type LineDeliveryInput = {
  reservationNumber: string;
  lineId: string;
  deliveryDateTime: string;
  deliveryCondition?: string;
  deliveryPhotos?: ConditionPhoto[];
  /** Audited reason for an exceptional handover with money outstanding. */
  paymentOverrideReason?: string;
  notes?: string;
};

/**
 * Per-line return input.
 */
export type LineReturnInput = {
  reservationNumber: string;
  lineId: string;
  returnDateTime: string;
  returnCondition?: string;
  returnPhotos?: ConditionPhoto[];
  lateFee: number;
  damageFee: number;
  nextItemStatus: 'inspection' | 'laundry' | 'maintenance' | 'damaged';
  notes?: string;
};
