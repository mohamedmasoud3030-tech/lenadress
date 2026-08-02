import { getBrowserLocalStorage, type StoragePort } from '@platform/storage';
import { getCollectionKey } from './collectionRegistry';
import { getMigrationMarker, runMigratorWithRollback } from './migrationRunner';

export const FINANCIAL_DEPOSIT_MIGRATION_ID = 'financial-deposit-separation-v1';

type UnknownRecord = Record<string, unknown>;

function getStorage(): StoragePort | null {
  return getBrowserLocalStorage();
}

function readArray(storage: StoragePort, collection: string): UnknownRecord[] {
  try {
    const raw = storage.getItem(getCollectionKey(collection));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as UnknownRecord[]) : [];
  } catch {
    return [];
  }
}

function writeArray(storage: StoragePort, collection: string, items: UnknownRecord[]): void {
  storage.setItem(getCollectionKey(collection), JSON.stringify(items));
}

function numberOrZero(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

function getStringProp(record: UnknownRecord, key: string): string {
  const val = record[key];
  return typeof val === 'string' ? val : String(val ?? '');
}

function sumPaymentAmounts(payments: UnknownRecord[], filter: (p: UnknownRecord) => boolean): number {
  return payments.filter(filter).reduce((sum, p) => sum + numberOrZero(p['amount']), 0);
}

// FIX: lateFee or damageFee alone are NOT sufficient evidence that old amount was refundable security deposit
// Only explicit deposit refund / settlement evidence proves security deposit nature
function hasSettlementEvidence(reservation: UnknownRecord, payments: UnknownRecord[], returns: UnknownRecord[]): boolean {
  const reservationNumber = getStringProp(reservation, 'reservationNumber');
  if (!reservationNumber) return false;

  // Return settlement evidence: only deposit refund or explicit deposit amount in return, NOT just late/damage fees
  const hasReturn = returns.some((r) => {
    if (getStringProp(r, 'reservationNumber') !== reservationNumber) return false;
    // Only consider deposit-related fields as evidence, not lateFee/damageFee alone
    const hasDepositRefund = numberOrZero(r['depositRefundAmount']) > 0 || numberOrZero(r['securityDepositRefundAmount']) > 0;
    const hasDepositAmount = numberOrZero(r['depositAmount']) > 0 || numberOrZero(r['securityDepositAmount']) > 0;
    const hasDepositSettlement = numberOrZero(r['settledDepositAmount']) > 0;
    return hasDepositRefund || hasDepositAmount || hasDepositSettlement;
  });

  const relatedPayments = payments.filter((p) => getStringProp(p, 'reservationNumber') === reservationNumber);
  const hasSettlementPayments = relatedPayments.some((p) => {
    const t = getStringProp(p, 'type');
    const source = getStringProp(p, 'source');
    // Explicit security deposit refund/retention or deposit settlement are deterministic evidence
    return (
      t === 'deposit_settlement' ||
      t === 'retained_deposit' ||
      t === 'security_deposit_retention' ||
      t === 'security_deposit_refund' ||
      (t === 'refund' && source === 'return')
    );
  });

  const settledDeposit = numberOrZero(reservation['settledDepositAmount']) + numberOrZero(reservation['securityDepositRefundedAmount']) + numberOrZero(reservation['securityDepositRetainedAmount']);
  return hasReturn || hasSettlementPayments || settledDeposit > 0;
}

function hasLegacyDeposit(reservation: UnknownRecord): boolean {
  return numberOrZero(reservation['depositAmount']) > 0 || numberOrZero(reservation['securityDepositAmount']) > 0;
}

function getBookingAdvanceCollectedFromPayments(payments: UnknownRecord[], reservationNumber: string): number {
  return sumPaymentAmounts(
    payments.filter((p) => getStringProp(p, 'reservationNumber') === reservationNumber),
    (p) => getStringProp(p, 'type') === 'booking_advance' && getStringProp(p, 'direction') === 'income',
  );
}

function getRentalCollectedFromPayments(payments: UnknownRecord[], reservationNumber: string): number {
  return sumPaymentAmounts(
    payments.filter((p) => getStringProp(p, 'reservationNumber') === reservationNumber),
    (p) => {
      const t = getStringProp(p, 'type');
      return (t === 'rental' || t === 'rental_payment') && getStringProp(p, 'direction') === 'income';
    },
  );
}

function getSecurityDepositCollectedFromPayments(payments: UnknownRecord[], reservationNumber: string): number {
  return sumPaymentAmounts(
    payments.filter((p) => getStringProp(p, 'reservationNumber') === reservationNumber),
    (p) => {
      const t = getStringProp(p, 'type');
      return (t === 'deposit' || t === 'security_deposit_collection') && getStringProp(p, 'direction') === 'income';
    },
  );
}

function getSecurityDepositRefundedFromPayments(payments: UnknownRecord[], reservationNumber: string): number {
  return sumPaymentAmounts(
    payments.filter((p) => getStringProp(p, 'reservationNumber') === reservationNumber),
    (p) => {
      const t = getStringProp(p, 'type');
      return t === 'security_deposit_refund' || (t === 'refund' && getStringProp(p, 'source') === 'return');
    },
  );
}

function getSecurityDepositRetainedFromPayments(payments: UnknownRecord[], reservationNumber: string): number {
  return sumPaymentAmounts(
    payments.filter((p) => getStringProp(p, 'reservationNumber') === reservationNumber),
    (p) => {
      const t = getStringProp(p, 'type');
      return t === 'retained_deposit' || t === 'security_deposit_retention';
    },
  );
}

function migrateReservationsArray(
  reservations: UnknownRecord[],
  payments: UnknownRecord[],
  returns: UnknownRecord[],
): { migrated: UnknownRecord[]; changed: boolean } {
  let changed = false;
  const migrated = reservations.map((res) => {
    const reservationNumber = getStringProp(res, 'reservationNumber');
    const legacyAmount = numberOrZero(res['depositAmount']);
    const hasNewSecurity = res['securityDepositAmount'] !== undefined;
    const hasNewBooking = res['bookingAdvanceAmount'] !== undefined;

    // If already canonical, ensure collected amounts derived from payment history only, NOT from configured amounts
    if (hasNewSecurity && hasNewBooking) {
      let localChanged = false;
      if (res['securityDepositCollectedAmount'] === undefined) {
        const fromPayments = reservationNumber ? getSecurityDepositCollectedFromPayments(payments, reservationNumber) : 0;
        res['securityDepositCollectedAmount'] = fromPayments;
        localChanged = true;
      }
      if (res['securityDepositRefundedAmount'] === undefined) {
        const fromPayments = reservationNumber ? getSecurityDepositRefundedFromPayments(payments, reservationNumber) : 0;
        res['securityDepositRefundedAmount'] = fromPayments;
        localChanged = true;
      }
      if (res['securityDepositRetainedAmount'] === undefined) {
        const fromPayments = reservationNumber ? getSecurityDepositRetainedFromPayments(payments, reservationNumber) : 0;
        res['securityDepositRetainedAmount'] = fromPayments;
        localChanged = true;
      }
      if (res['bookingAdvanceCollectedAmount'] === undefined) {
        // FIX: Do NOT set bookingAdvanceCollectedAmount = bookingAdvanceAmount. Extract from payment history only, else zero
        const fromPayments = reservationNumber ? getBookingAdvanceCollectedFromPayments(payments, reservationNumber) : 0;
        res['bookingAdvanceCollectedAmount'] = fromPayments;
        localChanged = true;
      }
      if (res['rentalCollectedAmount'] === undefined) {
        const fromPayments = reservationNumber ? getRentalCollectedFromPayments(payments, reservationNumber) : 0;
        // If no payment history, keep 0 rather than using paidAmount which mixes rental and deposit in legacy
        // For backward compat, if paidAmount exists and no payment history, use paidAmount only for no-legacy case
        if (fromPayments === 0 && !hasLegacyDeposit(res)) {
          res['rentalCollectedAmount'] = numberOrZero(res['paidAmount']);
        } else {
          res['rentalCollectedAmount'] = fromPayments;
        }
        localChanged = true;
      }
      if (res['rentalRefundedAmount'] === undefined) {
        res['rentalRefundedAmount'] = 0;
        localChanged = true;
      }
      if (localChanged) changed = true;
      return res;
    }

    if (!hasLegacyDeposit(res)) {
      if (res['securityDepositAmount'] === undefined) { res['securityDepositAmount'] = 0; changed = true; }
      if (res['bookingAdvanceAmount'] === undefined) { res['bookingAdvanceAmount'] = 0; changed = true; }
      if (res['securityDepositCollectedAmount'] === undefined) { res['securityDepositCollectedAmount'] = 0; changed = true; }
      if (res['securityDepositRefundedAmount'] === undefined) { res['securityDepositRefundedAmount'] = 0; changed = true; }
      if (res['securityDepositRetainedAmount'] === undefined) { res['securityDepositRetainedAmount'] = 0; changed = true; }
      if (res['bookingAdvanceCollectedAmount'] === undefined) {
        const fromPayments = reservationNumber ? getBookingAdvanceCollectedFromPayments(payments, reservationNumber) : 0;
        res['bookingAdvanceCollectedAmount'] = fromPayments;
        changed = true;
      }
      if (res['rentalCollectedAmount'] === undefined) {
        const fromPayments = reservationNumber ? getRentalCollectedFromPayments(payments, reservationNumber) : 0;
        res['rentalCollectedAmount'] = fromPayments > 0 ? fromPayments : numberOrZero(res['paidAmount']);
        changed = true;
      }
      if (res['rentalRefundedAmount'] === undefined) { res['rentalRefundedAmount'] = 0; changed = true; }
      return res;
    }

    const evidenceSecurity = hasSettlementEvidence(res, payments, returns);

    if (evidenceSecurity) {
      res['securityDepositAmount'] = legacyAmount;
      res['bookingAdvanceAmount'] = numberOrZero(res['bookingAdvanceAmount']);
      res['legacyDepositAmount'] = legacyAmount;
      res['legacyDepositClassification'] = 'security_deposit';
      res['needsFinancialClassification'] = false;
      res['classificationReason'] = 'Found explicit return settlement / deposit refund/retention evidence';
      res['classifiedAt'] = new Date().toISOString();

      if (reservationNumber) {
        const collected = getSecurityDepositCollectedFromPayments(payments, reservationNumber);
        const refunded = getSecurityDepositRefundedFromPayments(payments, reservationNumber);
        const retained = getSecurityDepositRetainedFromPayments(payments, reservationNumber);
        const bookingAdvanceCollected = getBookingAdvanceCollectedFromPayments(payments, reservationNumber);
        const rentalCollected = getRentalCollectedFromPayments(payments, reservationNumber);

        // FIX: Extract collected from payment history only, else zero
        res['securityDepositCollectedAmount'] = collected;
        res['securityDepositRefundedAmount'] = refunded;
        res['securityDepositRetainedAmount'] = retained;
        res['bookingAdvanceCollectedAmount'] = bookingAdvanceCollected;
        // rentalCollected from history, else 0, not from paidAmount minus collected
        res['rentalCollectedAmount'] = rentalCollected > 0 ? rentalCollected : 0;
      } else {
        res['securityDepositCollectedAmount'] = numberOrZero(res['securityDepositCollectedAmount']);
        res['securityDepositRefundedAmount'] = numberOrZero(res['securityDepositRefundedAmount']);
        res['securityDepositRetainedAmount'] = numberOrZero(res['securityDepositRetainedAmount']);
        res['bookingAdvanceCollectedAmount'] = 0;
        res['rentalCollectedAmount'] = 0;
      }

      if (res['rentalRefundedAmount'] === undefined) res['rentalRefundedAmount'] = 0;
      changed = true;
    } else {
      // Unresolved: canonical remains 0, legacy preserved, not refundable
      res['securityDepositAmount'] = 0;
      res['bookingAdvanceAmount'] = 0;
      res['legacyDepositAmount'] = legacyAmount;
      res['legacyDepositClassification'] = 'unresolved';
      res['needsFinancialClassification'] = true;
      res['classificationReason'] = 'Legacy depositAmount present without settlement evidence; requires review';
      res['securityDepositCollectedAmount'] = 0;
      res['securityDepositRefundedAmount'] = 0;
      res['securityDepositRetainedAmount'] = 0;
      // FIX: Do NOT set bookingAdvanceCollectedAmount = bookingAdvanceAmount. Extract from payment history only, else zero
      res['bookingAdvanceCollectedAmount'] = 0;
      // An unresolved legacy paidAmount can include the ambiguous deposit.  It is
      // evidence neither of a rental collection nor of a booking advance, so it
      // must never reduce the canonical rental receivable.  Keep it only in the
      // legacy record for the human classification workflow.
      res['rentalCollectedAmount'] = reservationNumber
        ? getRentalCollectedFromPayments(payments, reservationNumber)
        : 0;
      if (res['rentalRefundedAmount'] === undefined) res['rentalRefundedAmount'] = 0;
      // The legacy total included the ambiguous deposit.  Rebuild the stored
      // receivable from rental-only values so the unresolved amount cannot
      // falsely make the rental look paid (or remain part of the receivable).
      const rentalTotal = numberOrZero(res['rentalPrice']) || Math.max(numberOrZero(res['totalAmount']) - legacyAmount, 0);
      res['remainingAmount'] = Math.max(
        rentalTotal
          + numberOrZero(res['assessedFeesAmount'])
          - numberOrZero(res['rentalCollectedAmount'])
          - numberOrZero(res['bookingAdvanceCollectedAmount'])
          + numberOrZero(res['rentalRefundedAmount']),
        0,
      );
      changed = true;
    }

    return res;
  });

  return { migrated, changed };
}

// FIX: Do not copy line.depositAmount directly to securityDepositAmount without evidence
// Preserve in legacy metadata and link classification state to parent
function migrateEmbeddedLines(reservations: UnknownRecord[]): { migrated: UnknownRecord[]; changed: boolean } {
  let changed = false;
  // Build map of parent classification
  const parentClassificationMap = new Map<string, { classification: string; needsReview: boolean }>();
  for (const res of reservations) {
    const num = getStringProp(res, 'reservationNumber');
    if (!num) continue;
    parentClassificationMap.set(num, {
      classification: getStringProp(res, 'legacyDepositClassification') || 'unresolved',
      needsReview: Boolean(res['needsFinancialClassification']),
    });
  }

  const migrated = reservations.map((res) => {
    const lines = res['lines'] as UnknownRecord[] | undefined;
    if (!Array.isArray(lines) || lines.length === 0) return res;

    const parentInfo = parentClassificationMap.get(getStringProp(res, 'reservationNumber'));
    const isParentUnresolved = !parentInfo || parentInfo.needsReview || parentInfo.classification === 'unresolved';

    const newLines = lines.map((line) => {
      const hasCanonical = line['securityDepositAmount'] !== undefined && line['bookingAdvanceAmount'] !== undefined;
      if (hasCanonical) return line;

      const legacyDep = numberOrZero(line['depositAmount']);

      // Always preserve legacy in metadata
      line['legacyDepositAmount'] = legacyDep;
      line['legacyDepositClassification'] = isParentUnresolved ? 'unresolved' : parentInfo?.classification || 'unresolved';

      // FIX: If parent unresolved, canonical values remain neutral (0)
      if (isParentUnresolved) {
        line['securityDepositAmount'] = 0;
        line['bookingAdvanceAmount'] = 0;
      } else {
        // Parent is deterministically classified, so we can classify line based on parent
        // But still preserve evidence linking to parent
        if (parentInfo?.classification === 'security_deposit') {
          line['securityDepositAmount'] = legacyDep;
          line['bookingAdvanceAmount'] = 0;
        } else if (parentInfo?.classification === 'booking_advance') {
          line['securityDepositAmount'] = 0;
          line['bookingAdvanceAmount'] = legacyDep;
        } else {
          line['securityDepositAmount'] = 0;
          line['bookingAdvanceAmount'] = 0;
        }
      }
      changed = true;
      return line;
    });
    res['lines'] = newLines;
    return res;
  });
  return { migrated, changed };
}

function migrateCatalogueCollection(items: UnknownRecord[]): { migrated: UnknownRecord[]; changed: boolean } {
  let changed = false;
  const migrated = items.map((item) => {
    if (item['defaultSecurityDepositAmount'] !== undefined) return item;
    const legacy = numberOrZero(item['depositAmount']);
    item['defaultSecurityDepositAmount'] = legacy;
    changed = true;
    return item;
  });
  return { migrated, changed };
}

// FIX: Do not copy reservation-accessory depositAmount directly to securityDepositAmount without evidence
// Preserve legacy and link to parent classification
function migrateReservationAccessoryLinks(links: UnknownRecord[], reservations: UnknownRecord[]): { migrated: UnknownRecord[]; changed: boolean } {
  let changed = false;
  const parentMap = new Map<string, { classification: string; needsReview: boolean }>();
  for (const res of reservations) {
    const num = getStringProp(res, 'reservationNumber');
    if (!num) continue;
    parentMap.set(num, {
      classification: getStringProp(res, 'legacyDepositClassification') || 'unresolved',
      needsReview: Boolean(res['needsFinancialClassification']),
    });
  }

  const migrated = links.map((link) => {
    if (link['securityDepositAmount'] !== undefined && link['bookingAdvanceAmount'] !== undefined) return link;

    const legacy = numberOrZero(link['depositAmount']);
    const parentInfo = parentMap.get(getStringProp(link, 'reservationNumber'));
    const isUnresolved = !parentInfo || parentInfo.needsReview || parentInfo.classification === 'unresolved';

    link['legacyDepositAmount'] = legacy;
    link['legacyDepositClassification'] = isUnresolved ? 'unresolved' : parentInfo?.classification || 'unresolved';

    if (isUnresolved) {
      link['securityDepositAmount'] = 0;
      link['bookingAdvanceAmount'] = 0;
    } else {
      if (parentInfo?.classification === 'security_deposit') {
        link['securityDepositAmount'] = legacy;
        link['bookingAdvanceAmount'] = 0;
      } else if (parentInfo?.classification === 'booking_advance') {
        link['securityDepositAmount'] = 0;
        link['bookingAdvanceAmount'] = legacy;
      } else {
        link['securityDepositAmount'] = 0;
        link['bookingAdvanceAmount'] = 0;
      }
    }
    changed = true;
    return link;
  });
  return { migrated, changed };
}

export function migrateFinancialDepositFields(): boolean {
  const storage = getStorage();
  if (!storage) return false;

  if (getMigrationMarker(FINANCIAL_DEPOSIT_MIGRATION_ID)?.status === 'completed') return false;

  const reservations = readArray(storage, 'reservations');
  const payments = readArray(storage, 'payments');
  const returns = readArray(storage, 'delivery-return');

  if (reservations.length === 0) return false;

  const outcome = runMigratorWithRollback(FINANCIAL_DEPOSIT_MIGRATION_ID, () => {
    let anyChange = false;

    const resResult = migrateReservationsArray(reservations, payments, returns);
    if (resResult.changed) {
      writeArray(storage, 'reservations', resResult.migrated);
      anyChange = true;
    }

    const afterRes = readArray(storage, 'reservations');
    const linesResult = migrateEmbeddedLines(afterRes);
    if (linesResult.changed) {
      writeArray(storage, 'reservations', linesResult.migrated);
      anyChange = true;
    }

    const dresses = readArray(storage, 'dresses');
    const dressesResult = migrateCatalogueCollection(dresses);
    if (dressesResult.changed) {
      writeArray(storage, 'dresses', dressesResult.migrated);
      anyChange = true;
    }

    const accessories = readArray(storage, 'accessories');
    const accessoriesResult = migrateCatalogueCollection(accessories);
    if (accessoriesResult.changed) {
      writeArray(storage, 'accessories', accessoriesResult.migrated);
      anyChange = true;
    }

    const resAcc = readArray(storage, 'reservation-accessories');
    const resAccResult = migrateReservationAccessoryLinks(resAcc, afterRes);
    if (resAccResult.changed) {
      writeArray(storage, 'reservation-accessories', resAccResult.migrated);
      anyChange = true;
    }

    return anyChange;
  });

  return Boolean(outcome.result);
}
