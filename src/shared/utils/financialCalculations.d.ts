export type ReservationRemainingAmountInput = {
  totalAmount: number;
  assessedFeesAmount?: number;
  paidAmount: number;
  settledDepositAmount?: number;
  refundedAmount?: number;
};

export type RentalOutstandingInput = {
  rentalTotal: number;
  assessedFees?: number;
  bookingAdvanceCollected?: number;
  rentalCollected?: number;
  rentalRefunded?: number;
  retainedDeposit?: number;
};

export type SecurityDepositLiabilityInput = {
  collected: number;
  refunded?: number;
  retained?: number;
};

export type ReturnSettlementCalculationInput = {
  depositAmount: number; // legacy compat
  depositCollected: number;
  totalCollected: number;
  previouslyRefundedAmount?: number;
  previouslyRefundedDepositAmount?: number;
  lateFee: number;
  damageFee: number;
};

export type CanonicalReturnSettlementInput = {
  securityDepositAmount: number;
  securityDepositCollected?: number;
  securityDepositRefunded?: number;
  securityDepositRetained?: number;
  depositCollected?: number; // legacy compat
  totalCollected?: number;
  rentalCollected?: number;
  bookingAdvanceCollected?: number;
  previouslyRefundedAmount?: number;
  previouslyRefundedDepositAmount?: number;
  lateFee: number;
  damageFee: number;
};

export type ReturnSettlementCalculation = {
  assessedFeesAmount: number;
  availableDepositAmount: number;
  retainedDepositAmount: number;
  refundAmount: number;
  settledDepositAmount: number;
  securityDepositAmount?: number;
  securityDepositCollected?: number;
  securityDepositLiability?: number;
};

export function calculateReservationRemainingAmount(
  input: ReservationRemainingAmountInput,
): number;

export function calculateRentalOutstanding(input: RentalOutstandingInput): number;

export function calculateSecurityDepositLiability(input: SecurityDepositLiabilityInput): number;

export function calculateSecurityDepositAvailable(input: SecurityDepositLiabilityInput): number;

export function calculateReturnSettlement(
  input: ReturnSettlementCalculationInput | CanonicalReturnSettlementInput,
): ReturnSettlementCalculation;

export function calculateBookingAdvanceAndRentalOutstanding(input: RentalOutstandingInput): number;
