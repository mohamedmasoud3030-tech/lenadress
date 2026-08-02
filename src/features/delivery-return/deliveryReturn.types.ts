export type DeliveryReturnStatus =
  | 'pending_delivery'
  | 'delivered'
  | 'returned'
  | 'late'
  | 'damaged';

/**
 * Condition evidence attached to a handover.
 *
 * The condition of a garment was recorded as free text only. The first time a
 * customer says "that stain was already there", free text is one person's word
 * against another's and the showroom either eats a cleaning bill or loses a
 * customer. Photographs taken at the counter, timestamped and tied to the
 * handover, settle it in seconds.
 *
 * Images are stored as compressed data URLs on the record itself rather than in
 * the IndexedDB image store. That store is keyed by dress id and is about
 * catalogue photos; evidence must travel inside the backup with the record it
 * proves, and must survive the dress being archived or re-photographed.
 */
export type ConditionPhoto = {
  id: string;
  dataUrl: string;
  capturedAt: string;
  note?: string;
};

export type DeliveryReturnRecord = {
  id: string;
  reservationNumber: string;
  customerId?: string;
  inventoryItemId?: string;
  customerName: string;
  customerPhone?: string;
  dressCode: string;
  dressName: string;
  deliveryDateTime?: string;
  deliveryCondition?: string;
  /** Photographs of the piece as it left the showroom. */
  deliveryPhotos?: ConditionPhoto[];
  returnDateTime?: string;
  returnCondition?: string;
  /** Photographs of the piece as it came back. */
  returnPhotos?: ConditionPhoto[];
  status: DeliveryReturnStatus;
  depositAmount: number; // legacy compat
  lateFee: number;
  damageFee: number;
  depositRefundAmount: number;
  notes?: string;
};

export type DeliveryReturnFilters = {
  search: string;
  status: DeliveryReturnStatus | 'all';
};

export type DeliveryReturnSummary = {
  pendingDelivery: number;
  deliveredOut: number;
  returned: number;
  lateOrDamaged: number;
};
