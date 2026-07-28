/**
 * Accessories are a first-class inventory family (veils, crowns, belts, bags,
 * gloves and everything else that leaves the showroom with a dress). They reuse
 * the same allocator, barcode, reservation-conflict, delivery/return, finance
 * and backup machinery as dresses; only their own catalogue lives here.
 */

export type AccessoryCategory = 'veil' | 'crown' | 'belt' | 'bag' | 'gloves' | 'jewellery' | 'shoes' | 'other';

export type AccessoryStatus =
  | 'available'
  | 'reserved'
  | 'delivered'
  | 'service'
  | 'lost'
  | 'damaged'
  | 'retired';

export type Accessory = {
  id: string;
  /** Monotonic, never-reused stock code allocated by the shared allocator. */
  code: string;
  name: string;
  /** Derived from `code`; regenerating a label always yields the same value. */
  barcode: string;
  category: AccessoryCategory;
  status: AccessoryStatus;
  /** Optional sale price; absent means the accessory is not sold. */
  salePrice?: number;
  /** Optional rental price; absent means the accessory is not rented separately. */
  rentalPrice?: number;
  /** Optional refundable deposit charged with the accessory. */
  depositAmount?: number;
  notes?: string;
  /** Optional single image, stored exactly like inventory images. */
  image?: string;
  /** Set when the accessory is retired instead of deleted; history stays intact. */
  retiredAt?: string;
};

export type AddAccessoryInput = {
  name: string;
  category: AccessoryCategory;
  status?: AccessoryStatus;
  salePrice?: number;
  rentalPrice?: number;
  depositAmount?: number;
  notes?: string;
  image?: string;
};

export type UpdateAccessoryInput = Partial<Omit<Accessory, 'id' | 'code' | 'barcode'>>;

export type AccessoryFilters = {
  search: string;
  category: 'all' | AccessoryCategory;
  status: 'all' | AccessoryStatus;
};

export type AccessorySummary = {
  total: number;
  available: number;
  out: number;
  unavailable: number;
};

/** Condition recorded for each accessory when the rental comes back. */
export type AccessoryReturnCondition = 'intact' | 'damaged' | 'lost' | 'needs_service';

/** Link between a reservation and one accessory, including its handover state. */
export type ReservationAccessory = {
  id: string;
  reservationNumber: string;
  accessoryId: string;
  /** Historical snapshots so the contract stays readable after a rename. */
  accessoryCodeSnapshot: string;
  accessoryNameSnapshot: string;
  rentalPrice: number;
  depositAmount: number;
  deliveredAt?: string;
  returnedAt?: string;
  returnCondition?: AccessoryReturnCondition;
  /** Damage or loss charge assessed on return, posted through the finance layer. */
  chargeAmount?: number;
  notes?: string;
};
