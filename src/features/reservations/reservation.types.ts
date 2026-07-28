export type ReservationStatus = 'pending' | 'confirmed' | 'delivered' | 'returned' | 'cancelled' | 'overdue';

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
  rentalPrice: number;
  depositAmount: number;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  assessedFeesAmount?: number;
  refundedAmount?: number;
  settledDepositAmount?: number;
  retainedDepositAmount?: number;
  notes?: string;
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
