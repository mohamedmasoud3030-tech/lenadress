function normalizeAmount(value) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * Legacy: old remaining calculation that mixed rental + deposit.
 * Kept for migration compatibility only.
 * New runtime code must use calculateRentalOutstanding.
 */
export function calculateReservationRemainingAmount(input) {
  const totalAmount = normalizeAmount(input.totalAmount);
  const assessedFeesAmount = normalizeAmount(input.assessedFeesAmount);
  const paidAmount = normalizeAmount(input.paidAmount);
  const settledDepositAmount = normalizeAmount(input.settledDepositAmount);
  const refundedAmount = normalizeAmount(input.refundedAmount);

  return Math.max(totalAmount + assessedFeesAmount - paidAmount - settledDepositAmount + refundedAmount, 0);
}

/**
 * Canonical rental outstanding balance.
 * Rental outstanding = rentalCharges + fees - bookingAdvances - rentalPayments - retainedDeposit (covers fees) + rentalRefunds
 * Security deposit must NOT affect this balance except via retained covering fees.
 */
export function calculateRentalOutstanding(input) {
  const rentalTotal = normalizeAmount(input.rentalTotal);
  const assessedFees = normalizeAmount(input.assessedFees);
  const bookingAdvanceCollected = normalizeAmount(input.bookingAdvanceCollected);
  const rentalCollected = normalizeAmount(input.rentalCollected);
  const rentalRefunded = normalizeAmount(input.rentalRefunded);
  const retainedDeposit = normalizeAmount(input.retainedDeposit);

  // Fees not covered by retained deposit remain owed: effective fees owed = fees - retained
  // So remaining = rental + fees - bookingAdvance - rentalCollected - retained + rentalRefunded
  return Math.max(rentalTotal + assessedFees - bookingAdvanceCollected - rentalCollected - retainedDeposit + rentalRefunded, 0);
}

/**
 * Security deposit liability: collected - refunded - retained, never negative.
 */
export function calculateSecurityDepositLiability(input) {
  const collected = normalizeAmount(input.collected);
  const refunded = normalizeAmount(input.refunded);
  const retained = normalizeAmount(input.retained);
  return Math.max(collected - refunded - retained, 0);
}

export function calculateSecurityDepositAvailable(input) {
  return calculateSecurityDepositLiability(input);
}

export function calculateReturnSettlement(input) {
  // Support both legacy and new inputs
  const isLegacy = 'depositAmount' in input && !('securityDepositAmount' in input);
  if (isLegacy) {
    const depositAmount = normalizeAmount(input.depositAmount);
    const depositCollected = Math.min(normalizeAmount(input.depositCollected), depositAmount);
    const totalCollected = normalizeAmount(input.totalCollected);
    const previouslyRefundedAmount = normalizeAmount(input.previouslyRefundedAmount);
    const previouslyRefundedDepositAmount = Math.min(
      normalizeAmount(input.previouslyRefundedDepositAmount),
      previouslyRefundedAmount,
      depositCollected,
    );
    const lateFee = normalizeAmount(input.lateFee);
    const damageFee = normalizeAmount(input.damageFee);
    const netCollectedAmount = Math.max(totalCollected - previouslyRefundedAmount, 0);
    const refundableDepositBalance = Math.max(depositCollected - previouslyRefundedDepositAmount, 0);
    const availableDepositAmount = Math.min(refundableDepositBalance, netCollectedAmount);
    const assessedFeesAmount = lateFee + damageFee;
    const retainedDepositAmount = Math.min(availableDepositAmount, assessedFeesAmount);

    return {
      assessedFeesAmount,
      availableDepositAmount,
      retainedDepositAmount,
      refundAmount: Math.max(availableDepositAmount - retainedDepositAmount, 0),
      settledDepositAmount: depositAmount,
    };
  }

  // Canonical new settlement based on security deposit liability
  const securityDepositAmount = normalizeAmount(input.securityDepositAmount ?? input.depositAmount);
  const collected = normalizeAmount(input.securityDepositCollected ?? input.depositCollected);
  const refunded = normalizeAmount(input.securityDepositRefunded ?? input.previouslyRefundedDepositAmount);
  const retained = normalizeAmount(input.securityDepositRetained ?? 0);
  const previouslyRefundedAmount = normalizeAmount(input.previouslyRefundedAmount); // total refunds, for netCollected check
  const totalCollected = input.totalCollected !== undefined ? normalizeAmount(input.totalCollected) : collected + normalizeAmount(input.rentalCollected ?? 0) + normalizeAmount(input.bookingAdvanceCollected ?? 0);
  const lateFee = normalizeAmount(input.lateFee);
  const damageFee = normalizeAmount(input.damageFee);

  // Available liability
  const liability = Math.max(collected - refunded - retained, 0);
  // Net cash check: should not refund more than net collected, but liability already ensures collected >= refunded+retained
  // For backward compat, also cap by netCollectedAmount
  const netCollectedAmount = Math.max(totalCollected - previouslyRefundedAmount, 0);
  const availableDepositAmount = Math.min(liability, netCollectedAmount, collected);

  const assessedFeesAmount = lateFee + damageFee;
  const retainedDepositAmount = Math.min(availableDepositAmount, assessedFeesAmount);

  return {
    assessedFeesAmount,
    availableDepositAmount,
    retainedDepositAmount,
    refundAmount: Math.max(availableDepositAmount - retainedDepositAmount, 0),
    settledDepositAmount: securityDepositAmount,
    securityDepositAmount,
    securityDepositCollected: collected,
    securityDepositLiability: liability,
  };
}

/**
 * Canonical booking advance + rental outstanding helper.
 * Returns remaining rental.
 */
export function calculateBookingAdvanceAndRentalOutstanding(input) {
  return calculateRentalOutstanding(input);
}
