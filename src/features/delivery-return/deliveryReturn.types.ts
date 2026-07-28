export type DeliveryReturnStatus =
  | 'pending_delivery'
  | 'delivered'
  | 'returned'
  | 'late'
  | 'damaged';

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
  returnDateTime?: string;
  returnCondition?: string;
  status: DeliveryReturnStatus;
  depositAmount: number;
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
