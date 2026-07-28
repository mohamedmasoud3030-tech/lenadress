import { getBrowserLocalStorage, type StoragePort } from '@platform/storage';
import { getCollectionKey } from './collectionRegistry';
import { getMigrationMarker, runMigratorWithRollback } from './migrationRunner';

/**
 * Phase 1.18 — immutable historical references.
 *
 * Historical operational records used to point at customers and inventory items
 * through mutable values only (phone number, item code). This migration backfills
 * stable `customerId` / `inventoryItemId` references while keeping the existing
 * display values as historical snapshots. It never deletes or duplicates records
 * and is idempotent: records that already carry stable references are untouched.
 */

export const REFERENCE_MIGRATION_ID = 'stable-references-v1';

const REFERENCED_COLLECTIONS = ['reservations', 'delivery-return', 'sales', 'sales-invoices', 'sale-returns'];

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

export function normalizePhoneValue(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\D/g, '') : '';
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

type LookupMaps = {
  customerByPhone: Map<string, UnknownRecord>;
  itemByCode: Map<string, UnknownRecord>;
};

function buildLookups(customers: UnknownRecord[], items: UnknownRecord[]): LookupMaps {
  const customerByPhone = new Map<string, UnknownRecord>();
  customers.forEach((customer) => {
    const phone = normalizePhoneValue(customer.phone);
    if (phone && !customerByPhone.has(phone)) customerByPhone.set(phone, customer);
  });

  const itemByCode = new Map<string, UnknownRecord>();
  items.forEach((item) => {
    const code = stringOf(item.code);
    if (code && !itemByCode.has(code)) itemByCode.set(code, item);
  });

  return { customerByPhone, itemByCode };
}

/**
 * Adds stable references and display snapshots to one record without removing
 * any existing field. Returns `true` when the record changed.
 */
export function backfillRecordReferences(record: UnknownRecord, lookups: LookupMaps): boolean {
  let changed = false;

  if (!stringOf(record.customerId)) {
    const customer = lookups.customerByPhone.get(normalizePhoneValue(record.customerPhone));
    const customerId = customer ? stringOf(customer.id) : '';
    if (customerId) {
      record.customerId = customerId;
      changed = true;
    }
  }

  if (!stringOf(record.customerNameSnapshot) && stringOf(record.customerName)) {
    record.customerNameSnapshot = record.customerName;
    changed = true;
  }

  if (!stringOf(record.customerPhoneSnapshot) && stringOf(record.customerPhone)) {
    record.customerPhoneSnapshot = record.customerPhone;
    changed = true;
  }

  if (!stringOf(record.inventoryItemId)) {
    const item = lookups.itemByCode.get(stringOf(record.dressCode));
    const itemId = item ? stringOf(item.id) : '';
    if (itemId) {
      record.inventoryItemId = itemId;
      changed = true;
    }
  }

  if (!stringOf(record.dressCodeSnapshot) && stringOf(record.dressCode)) {
    record.dressCodeSnapshot = record.dressCode;
    changed = true;
  }

  if (!stringOf(record.dressNameSnapshot) && stringOf(record.dressName)) {
    record.dressNameSnapshot = record.dressName;
    changed = true;
  }

  return changed;
}

export function migrateStableReferences(): boolean {
  const storage = getStorage();
  if (!storage) return false;

  if (getMigrationMarker(REFERENCE_MIGRATION_ID)?.status === 'completed') return false;

  // Nothing historical to backfill yet: stay completely passive so a fresh or
  // empty database is not touched and no marker is written.
  const hasHistoricalRecords = REFERENCED_COLLECTIONS.some((collection) => readArray(storage, collection).length > 0);
  if (!hasHistoricalRecords) return false;

  const outcome = runMigratorWithRollback(REFERENCE_MIGRATION_ID, () => {
    const lookups = buildLookups(readArray(storage, 'customers'), readArray(storage, 'dresses'));
    let anyChange = false;

    REFERENCED_COLLECTIONS.forEach((collection) => {
      const records = readArray(storage, collection);
      if (records.length === 0) return;

      let collectionChanged = false;
      records.forEach((record) => {
        if (backfillRecordReferences(record, lookups)) collectionChanged = true;
      });

      if (collectionChanged) {
        writeArray(storage, collection, records);
        anyChange = true;
      }
    });

    return anyChange;
  });

  return Boolean(outcome.result);
}
