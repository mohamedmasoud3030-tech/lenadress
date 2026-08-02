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

function hasSettlementEvidence(reservation: UnknownRecord, payments: UnknownRecord[], returns: UnknownRecord[]): boolean {
  const reservationNumber = getStringProp(reservation, 'reservationNumber');
  if (!reservationNumber) return false;

  const hasReturn = returns.some((r) => getStringProp(r, 'reservationNumber') === reservationNumber && (
    numberOrZero(r['depositRefundAmount']) > 0 ||
    numberOrZero(r['lateFee']) > 0 ||
    numberOrZero(r['damageFee']) > 0 ||
    numberOrZero(r['depositAmount']) > 0
  ));

  const relatedPayments = payments.filter((p) => getStringProp(p, 'reservationNumber') === reservationNumber);
  const hasSettlementPayments = relatedPayments.some((p) => {
    const t = getStringProp(p, 'type');
    const source = getStringProp(p, 'source');
    return t === 'deposit_settlement' || t === 'retained_deposit' || t === 'security_deposit_retention' || t === 'security_deposit_refund' || (t === 'refund' && source === 'return');
  });

  const settledDeposit = numberOrZero(reservation['settledDepositAmount']) + numberOrZero(reservation['securityDepositRefundedAmount']) + numberOrZero(reservation['securityDepositRetainedAmount']);
  return hasReturn || hasSettlementPayments || settledDeposit > 0;
}

function hasLegacyDeposit(reservation: UnknownRecord): boolean {
  return numberOrZero(reservation['depositAmount']) > 0 || numberOrZero(reservation['securityDepositAmount']) > 0;
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

    const newReservations = reservations.map((res) => {
      const legacyAmount = numberOrZero(res['depositAmount']);
      const hasNewSecurity = res['securityDepositAmount'] !== undefined || res['defaultSecurityDepositAmount'] !== undefined;
      const hasNewBooking = res['bookingAdvanceAmount'] !== undefined;

      if (hasNewSecurity && hasNewBooking) {
        let changed = false;
        if (res['securityDepositCollectedAmount'] === undefined) { res['securityDepositCollectedAmount'] = 0; changed = true; }
        if (res['securityDepositRefundedAmount'] === undefined) { res['securityDepositRefundedAmount'] = 0; changed = true; }
        if (res['securityDepositRetainedAmount'] === undefined) { res['securityDepositRetainedAmount'] = 0; changed = true; }
        if (res['bookingAdvanceCollectedAmount'] === undefined) { res['bookingAdvanceCollectedAmount'] = numberOrZero(res['bookingAdvanceAmount']); changed = true; }
        if (res['rentalCollectedAmount'] === undefined) { res['rentalCollectedAmount'] = numberOrZero(res['paidAmount']); changed = true; }
        if (res['rentalRefundedAmount'] === undefined) { res['rentalRefundedAmount'] = 0; changed = true; }
        if (changed) anyChange = true;
        return res;
      }

      if (!hasLegacyDeposit(res)) {
        if (res['securityDepositAmount'] === undefined) { res['securityDepositAmount'] = 0; anyChange = true; }
        if (res['bookingAdvanceAmount'] === undefined) { res['bookingAdvanceAmount'] = 0; anyChange = true; }
        if (res['securityDepositCollectedAmount'] === undefined) { res['securityDepositCollectedAmount'] = 0; anyChange = true; }
        if (res['securityDepositRefundedAmount'] === undefined) { res['securityDepositRefundedAmount'] = 0; anyChange = true; }
        if (res['securityDepositRetainedAmount'] === undefined) { res['securityDepositRetainedAmount'] = 0; anyChange = true; }
        if (res['bookingAdvanceCollectedAmount'] === undefined) { res['bookingAdvanceCollectedAmount'] = 0; anyChange = true; }
        if (res['rentalCollectedAmount'] === undefined) { res['rentalCollectedAmount'] = numberOrZero(res['paidAmount']); anyChange = true; }
        if (res['rentalRefundedAmount'] === undefined) { res['rentalRefundedAmount'] = 0; anyChange = true; }
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
        const related = payments.filter((p) => getStringProp(p, 'reservationNumber') === getStringProp(res, 'reservationNumber'));
        const collected = related
          .filter((p) => getStringProp(p, 'type') === 'deposit' || getStringProp(p, 'type') === 'security_deposit_collection')
          .filter((p) => getStringProp(p, 'direction') === 'income')
          .reduce((sum, p) => sum + numberOrZero(p['amount']), 0);
        const refunded = related
          .filter((p) => getStringProp(p, 'type') === 'security_deposit_refund' || (getStringProp(p, 'type') === 'refund' && getStringProp(p, 'source') === 'return'))
          .reduce((sum, p) => sum + numberOrZero(p['amount']), 0);
        const retained = related
          .filter((p) => getStringProp(p, 'type') === 'retained_deposit' || getStringProp(p, 'type') === 'security_deposit_retention')
          .reduce((sum, p) => sum + numberOrZero(p['amount']), 0);
        res['securityDepositCollectedAmount'] = collected > 0 ? collected : numberOrZero(res['securityDepositCollectedAmount']);
        res['securityDepositRefundedAmount'] = refunded > 0 ? refunded : numberOrZero(res['securityDepositRefundedAmount']);
        res['securityDepositRetainedAmount'] = retained > 0 ? retained : numberOrZero(res['securityDepositRetainedAmount']);
        res['bookingAdvanceCollectedAmount'] = numberOrZero(res['bookingAdvanceCollectedAmount']);
        const rentalCollectedRaw = numberOrZero(res['rentalCollectedAmount'] ?? res['paidAmount']) - collected;
        res['rentalCollectedAmount'] = rentalCollectedRaw < 0 ? 0 : rentalCollectedRaw;
        if (res['rentalRefundedAmount'] === undefined) res['rentalRefundedAmount'] = 0;
        anyChange = true;
      } else {
        res['securityDepositAmount'] = 0;
        res['bookingAdvanceAmount'] = 0;
        res['legacyDepositAmount'] = legacyAmount;
        res['legacyDepositClassification'] = 'unresolved';
        res['needsFinancialClassification'] = true;
        res['classificationReason'] = 'Legacy depositAmount present without settlement evidence; requires review';
        res['securityDepositCollectedAmount'] = 0;
        res['securityDepositRefundedAmount'] = 0;
        res['securityDepositRetainedAmount'] = 0;
        res['bookingAdvanceCollectedAmount'] = 0;
        res['rentalCollectedAmount'] = numberOrZero(res['paidAmount']);
        if (res['rentalRefundedAmount'] === undefined) res['rentalRefundedAmount'] = 0;
        anyChange = true;
      }

      return res;
    });

    if (anyChange) {
      writeArray(storage, 'reservations', newReservations);
    }

    const migratedReservations = readArray(storage, 'reservations');
    let linesChanged = false;
    const withLines = migratedReservations.map((res) => {
      const lines = res['lines'] as UnknownRecord[] | undefined;
      if (!Array.isArray(lines) || lines.length === 0) return res;
      const newLines = lines.map((line) => {
        if (line['securityDepositAmount'] !== undefined && line['bookingAdvanceAmount'] !== undefined) return line;
        const legacyDep = numberOrZero(line['depositAmount']);
        line['securityDepositAmount'] = legacyDep;
        line['bookingAdvanceAmount'] = numberOrZero(line['bookingAdvanceAmount']);
        line['legacyDepositAmount'] = legacyDep;
        linesChanged = true;
        return line;
      });
      if (linesChanged) {
        res['lines'] = newLines;
      }
      return res;
    });
    if (linesChanged) {
      writeArray(storage, 'reservations', withLines);
      anyChange = true;
    }

    const dresses = readArray(storage, 'dresses');
    let dressesChanged = false;
    const newDresses = dresses.map((d) => {
      if (d['defaultSecurityDepositAmount'] !== undefined) return d;
      const legacy = numberOrZero(d['depositAmount']);
      d['defaultSecurityDepositAmount'] = legacy;
      dressesChanged = true;
      return d;
    });
    if (dressesChanged) {
      writeArray(storage, 'dresses', newDresses);
      anyChange = true;
    }

    const accessories = readArray(storage, 'accessories');
    let accChanged = false;
    const newAcc = accessories.map((a) => {
      if (a['defaultSecurityDepositAmount'] !== undefined) return a;
      const legacy = numberOrZero(a['depositAmount']);
      a['defaultSecurityDepositAmount'] = legacy;
      accChanged = true;
      return a;
    });
    if (accChanged) {
      writeArray(storage, 'accessories', newAcc);
      anyChange = true;
    }

    const resAcc = readArray(storage, 'reservation-accessories');
    let resAccChanged = false;
    const newResAcc = resAcc.map((link) => {
      if (link['securityDepositAmount'] !== undefined) return link;
      const legacy = numberOrZero(link['depositAmount']);
      link['securityDepositAmount'] = legacy;
      link['bookingAdvanceAmount'] = 0;
      resAccChanged = true;
      return link;
    });
    if (resAccChanged) {
      writeArray(storage, 'reservation-accessories', newResAcc);
      anyChange = true;
    }

    return anyChange;
  });

  return Boolean(outcome.result);
}
