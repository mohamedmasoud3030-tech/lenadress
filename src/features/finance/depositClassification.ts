/**
 * Legacy deposit classification policy.
 * Existing depositAmount values are potentially ambiguous.
 * Never silently classify every historical value as one category.
 * Deterministic classification only when evidence is clear.
 */

export type DepositClassification =
  | 'booking_advance'
  | 'security_deposit'
  | 'mixed'
  | 'unresolved'
  | 'reviewed';

export type FinancialClassificationMetadata = {
  /** Original ambiguous amount preserved */
  legacyDepositAmount?: number;
  legacyDepositClassification?: DepositClassification;
  needsFinancialClassification?: boolean;
  classificationReason?: string;
  classifiedAt?: string;
  classifiedBy?: string;
};

export function createUnresolvedClassification(
  legacyAmount: number,
  reason: string,
): FinancialClassificationMetadata {
  return {
    legacyDepositAmount: legacyAmount,
    legacyDepositClassification: 'unresolved',
    needsFinancialClassification: true,
    classificationReason: reason,
  };
}

export function createSecurityDepositClassification(
  legacyAmount: number,
  reason: string,
): FinancialClassificationMetadata {
  return {
    legacyDepositAmount: legacyAmount,
    legacyDepositClassification: 'security_deposit',
    needsFinancialClassification: false,
    classificationReason: reason,
    classifiedAt: new Date().toISOString(),
  };
}

export function createBookingAdvanceClassification(
  legacyAmount: number,
  reason: string,
): FinancialClassificationMetadata {
  return {
    legacyDepositAmount: legacyAmount,
    legacyDepositClassification: 'booking_advance',
    needsFinancialClassification: false,
    classificationReason: reason,
    classifiedAt: new Date().toISOString(),
  };
}

export function isUnresolved(entry: FinancialClassificationMetadata | undefined): boolean {
  if (!entry) return false;
  return entry.needsFinancialClassification === true || entry.legacyDepositClassification === 'unresolved';
}
