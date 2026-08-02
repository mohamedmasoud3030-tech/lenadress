export type CanonicalPaymentType =
  | 'booking_advance'
  | 'rental_payment'
  | 'security_deposit_collection'
  | 'security_deposit_refund'
  | 'security_deposit_retention'
  | 'late_fee'
  | 'damage_fee'
  | 'adjustment'
  | 'reversal';

export type LegacyPaymentType =
  | 'rental'
  | 'deposit'
  | 'late_fee'
  | 'damage_fee'
  | 'deposit_settlement'
  | 'retained_deposit'
  | 'penalty'
  | 'refund'
  | 'adjustment';

export type PaymentType = CanonicalPaymentType | LegacyPaymentType;

export type ManualPaymentType =
  | 'rental_payment'
  | 'booking_advance'
  | 'security_deposit_collection'
  | 'security_deposit_refund'
  | 'security_deposit_retention'
  | 'rental'
  | 'deposit'
  | 'penalty'
  | 'refund'
  | 'adjustment';

export type PaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'other';

export type PaymentDirection = 'income' | 'refund' | 'settlement';

export type PaymentRecord = {
  id: string;
  paymentNumber: string;
  reservationNumber: string;
  customerName: string;
  dressCode: string;
  dressName: string;
  paymentDate: string;
  type: PaymentType;
  method: PaymentMethod;
  direction: PaymentDirection;
  amount: number;
  reservationTotal: number;
  /** Canonical breakdown: rental payment, booking advance, security deposit */
  rentalAmount?: number;
  bookingAdvanceAmount?: number;
  securityDepositAmount?: number;
  source?: 'manual' | 'return';
  /** Explicit reason for retention (required for security_deposit_retention) */
  retentionReason?: string;
  /** Idempotency key for duplicate protection */
  idempotencyKey?: string;
  notes?: string;
};

export type PaymentFilters = {
  search: string;
  type: PaymentType | 'all';
  method: PaymentMethod | 'all';
  direction: PaymentDirection | 'all';
};

export type PaymentSummary = {
  totalCollected: number;
  rentalCollected: number;
  bookingAdvanceCollected: number;
  deposits: number;
  securityDepositsCollected: number;
  securityDepositsRefunded: number;
  securityDepositsRetained: number;
  retainedDeposits: number;
  penalties: number;
  lateFees: number;
  damageFees: number;
  totalRefunded: number;
  remainingBalance: number;
  securityDepositLiability: number;
};
