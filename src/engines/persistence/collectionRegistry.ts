import type { StoragePort } from '@platform/storage';

export const DATABASE_APPLICATION_ID = 'dress-roomshow';
export const CURRENT_STORAGE_SCHEMA_VERSION = 1;
export const STORAGE_PREFIX = 'dress-roomshow';
export const METADATA_KEY = `${STORAGE_PREFIX}:metadata`;

/**
 * Prefixed keys that are NOT collections. They hold objects rather than arrays,
 * so treating them as collections silently exported them as `[]` and then wiped
 * them on restore.
 */
export const NON_COLLECTION_KEYS = new Set<string>([METADATA_KEY, `${STORAGE_PREFIX}:migration-markers`]);

export const REGISTERED_COLLECTIONS = [
  'customers',
  'dresses',
  'dress-designs',
  'accessories',
  'reservation-accessories',
  'reservations',
  'appointments',
  'payments',
  'expenses',
  'delivery-return',
  'sales',
  'sales-invoices',
  'sale-returns',
  'service-tasks',
  'audit-log',
  'audit',
  'daily-closings',
  'counters',
  'command-log',
  'reminder-dismissals',
  'operators',
  'customer-conduct-notes',
  'waitlist',
  'print-settings',
  'retired-codes',
  'preferences',
  'showroom-profile',
  'stocktake-sessions',
  'images',
] as const;

export type CollectionName = typeof REGISTERED_COLLECTIONS[number];

const REGISTERED_COLLECTIONS_SET = new Set<string>(REGISTERED_COLLECTIONS);

export function isRegisteredCollection(collection: string): collection is CollectionName {
  return REGISTERED_COLLECTIONS_SET.has(collection);
}

export function getCollectionKey(collection: string): string {
  return `${STORAGE_PREFIX}:${collection}`;
}

export function listCollectionNames(storage?: StoragePort | null, memoryKeys?: Iterable<string>): string[] {
  const names = new Set<string>(REGISTERED_COLLECTIONS);

  if (storage) {
    const length = storage.length;
    for (let index = 0; index < length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(`${STORAGE_PREFIX}:`) && !NON_COLLECTION_KEYS.has(key)) {
        names.add(key.slice(STORAGE_PREFIX.length + 1));
      }
    }
  }

  if (memoryKeys) {
    for (const key of memoryKeys) {
      if (key.startsWith(`${STORAGE_PREFIX}:`) && !NON_COLLECTION_KEYS.has(key)) {
        names.add(key.slice(STORAGE_PREFIX.length + 1));
      }
    }
  }

  return Array.from(names).sort();
}
