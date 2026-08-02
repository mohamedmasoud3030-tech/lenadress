import {
  calculateRentalOutstanding,
  calculateSecurityDepositLiability,
} from '../../shared/utils/financialCalculations.js';

/**
 * Canonical financial definitions:
 * - bookingAdvanceAmount: دفعة الحجز, reduces rental receivable, not liability
 * - securityDepositAmount: التأمين المسترد, refundable liability, does not reduce rental
 */

export type RentalBalanceInput = {
  rentalTotal: number;
  assessedFees?: number;
  bookingAdvanceCollected?: number;
  rentalCollected?: number;
  rentalRefunded?: number;
  retainedDeposit?: number;
};

export function getRentalOutstandingBalance(input: RentalBalanceInput): number {
  return calculateRentalOutstanding({
    rentalTotal: input.rentalTotal,
    assessedFees: input.assessedFees,
    bookingAdvanceCollected: input.bookingAdvanceCollected,
    rentalCollected: input.rentalCollected,
    rentalRefunded: input.rentalRefunded,
    retainedDeposit: input.retainedDeposit,
  });
}

export type SecurityDepositLiabilityInput = {
  collected: number;
  refunded?: number;
  retained?: number;
};

export function getSecurityDepositLiability(input: SecurityDepositLiabilityInput): number {
  return calculateSecurityDepositLiability(input);
}

export function assertSecurityDepositLiabilityNonNegative(input: SecurityDepositLiabilityInput): void {
  const liability = getSecurityDepositLiability(input);
  if (liability < 0) {
    throw new Error('التزام التأمين المسترد لا يمكن أن يكون سالباً.');
  }
}

export function assertRefundDoesNotExceedLiability(input: {
  collected: number;
  refunded: number;
  retained?: number;
  requestedRefund: number;
}): void {
  const available = calculateSecurityDepositLiability({
    collected: input.collected,
    refunded: input.refunded,
    retained: input.retained,
  });
  if (input.requestedRefund > available + 1e-6) {
    throw new Error('قيمة استرداد التأمين تتجاوز المبلغ المتاح للاسترداد.');
  }
}

export function assertRetentionDoesNotExceedLiability(input: {
  collected: number;
  refunded?: number;
  retained: number;
  requestedRetention: number;
  reason?: string;
}): void {
  if (!input.reason || !input.reason.trim()) {
    throw new Error('سبب احتجاز التأمين مطلوب.');
  }
  const available = calculateSecurityDepositLiability({
    collected: input.collected,
    refunded: input.refunded,
    retained: input.retained,
  });
  if (input.requestedRetention > available + 1e-6) {
    throw new Error('قيمة احتجاز التأمين تتجاوز المبلغ المتاح.');
  }
}

export const CANONICAL_PAYMENT_TYPES = [
  'booking_advance',
  'rental_payment',
  'security_deposit_collection',
  'security_deposit_refund',
  'security_deposit_retention',
  'late_fee',
  'damage_fee',
  'adjustment',
  'reversal',
] as const;

export type CanonicalPaymentType = typeof CANONICAL_PAYMENT_TYPES[number];

export const LEGACY_PAYMENT_TYPES = [
  'rental',
  'deposit',
  'penalty',
  'refund',
  'adjustment',
  'late_fee',
  'damage_fee',
  'deposit_settlement',
  'retained_deposit',
] as const;

export function isCanonicalPaymentType(type: string): boolean {
  return (CANONICAL_PAYMENT_TYPES as readonly string[]).includes(type);
}

export function isLegacyPaymentType(type: string): boolean {
  return (LEGACY_PAYMENT_TYPES as readonly string[]).includes(type);
}

/**
 * Map old ambiguous 'deposit' to new canonical only when evidence is clear.
 * For new records, must use explicit canonical types.
 */
export function normalizePaymentTypeForNewRecord(type: string): string {
  if (type === 'deposit') {
    throw new Error('نوع الحركة deposit غامض؛ استخدمي security_deposit_collection أو booking_advance.');
  }
  if (type === 'rental') {
    // Map to canonical rental_payment for new records, but allow backward compat reading
    return 'rental_payment';
  }
  return type;
}
