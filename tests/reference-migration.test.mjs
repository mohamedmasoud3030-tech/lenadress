import test from 'node:test';
import assert from 'node:assert/strict';
import {
  migrateStableReferences,
  backfillRecordReferences,
  normalizePhoneValue,
  REFERENCE_MIGRATION_ID,
  getMigrationMarker,
  resetMigrationMarkers,
  getCollectionKey,
} from '../src/engines/persistence/index.ts';

function installStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  globalThis.window = {
    localStorage: {
      get length() {
        return store.size;
      },
      getItem(key) {
        return store.has(key) ? store.get(key) : null;
      },
      setItem(key, value) {
        store.set(key, String(value));
      },
      removeItem(key) {
        store.delete(key);
      },
      key(index) {
        return Array.from(store.keys())[index] ?? null;
      },
      clear() {
        store.clear();
      },
    },
  };
  return store;
}

function seedFixture() {
  return {
    [getCollectionKey('customers')]: JSON.stringify([
      { id: 'cus-1', name: 'مريم', phone: '9000-0001' },
      { id: 'cus-2', name: 'سارة', phone: '9000-0002' },
    ]),
    [getCollectionKey('dresses')]: JSON.stringify([
      { id: 'itm-1', code: 'DR-001', name: 'فستان سهرة' },
      { id: 'itm-2', code: 'DR-002', name: 'فستان زفاف' },
    ]),
    [getCollectionKey('reservations')]: JSON.stringify([
      {
        id: 'rsv-1',
        reservationNumber: 'RSV-001',
        customerName: 'مريم',
        customerPhone: '9000-0001',
        dressCode: 'DR-001',
        dressName: 'فستان سهرة',
        paidAmount: 10,
      },
      {
        id: 'rsv-2',
        reservationNumber: 'RSV-002',
        customerName: 'سارة',
        customerPhone: '90000002',
        dressCode: 'DR-002',
        dressName: 'فستان زفاف',
        paidAmount: 0,
      },
    ]),
  };
}

function readReservations(store) {
  return JSON.parse(store.get(getCollectionKey('reservations')));
}

test('normalizePhoneValue keeps only digits and tolerates non-strings', () => {
  assert.equal(normalizePhoneValue('9000-0001'), '90000001');
  assert.equal(normalizePhoneValue(undefined), '');
});

test('migration backfills stable references and display snapshots without losing records', () => {
  const store = installStorage(seedFixture());
  resetMigrationMarkers();
  try {
    assert.equal(migrateStableReferences(), true);
    const reservations = readReservations(store);
    assert.equal(reservations.length, 2);
    assert.equal(reservations[0].customerId, 'cus-1');
    assert.equal(reservations[0].inventoryItemId, 'itm-1');
    assert.equal(reservations[0].customerNameSnapshot, 'مريم');
    assert.equal(reservations[0].customerPhoneSnapshot, '9000-0001');
    assert.equal(reservations[0].dressCodeSnapshot, 'DR-001');
    assert.equal(reservations[0].dressNameSnapshot, 'فستان سهرة');
    // Matching tolerates different phone formatting.
    assert.equal(reservations[1].customerId, 'cus-2');
    // Original values are preserved, nothing removed.
    assert.equal(reservations[0].paidAmount, 10);
    assert.equal(getMigrationMarker(REFERENCE_MIGRATION_ID).status, 'completed');
  } finally {
    resetMigrationMarkers();
    delete globalThis.window;
  }
});

test('migration is idempotent and does not duplicate or re-write completed data', () => {
  const store = installStorage(seedFixture());
  resetMigrationMarkers();
  try {
    migrateStableReferences();
    const first = store.get(getCollectionKey('reservations'));
    assert.equal(migrateStableReferences(), false, 'second run must be skipped by the marker');
    assert.equal(store.get(getCollectionKey('reservations')), first);

    // Even if markers are lost, re-running produces no further changes.
    resetMigrationMarkers();
    assert.equal(migrateStableReferences(), false);
    assert.equal(store.get(getCollectionKey('reservations')), first);
    assert.equal(readReservations(store).length, 2);
  } finally {
    resetMigrationMarkers();
    delete globalThis.window;
  }
});

test('records that already carry stable ids keep their original references', () => {
  const record = {
    customerId: 'kept-customer',
    inventoryItemId: 'kept-item',
    customerName: 'اسم قديم',
    customerPhone: '9000-0001',
    dressCode: 'DR-001',
    dressName: 'اسم قطعة قديم',
  };
  const lookups = {
    customerByPhone: new Map([['90000001', { id: 'cus-1' }]]),
    itemByCode: new Map([['DR-001', { id: 'itm-1' }]]),
  };
  assert.equal(backfillRecordReferences(record, lookups), true);
  assert.equal(record.customerId, 'kept-customer');
  assert.equal(record.inventoryItemId, 'kept-item');
  assert.equal(record.customerNameSnapshot, 'اسم قديم');
});

test('unmatched legacy records are preserved untouched instead of dropped', () => {
  const seed = seedFixture();
  seed[getCollectionKey('reservations')] = JSON.stringify([
    { id: 'rsv-x', reservationNumber: 'RSV-X', customerPhone: '999', dressCode: 'UNKNOWN' },
  ]);
  const store = installStorage(seed);
  resetMigrationMarkers();
  try {
    migrateStableReferences();
    const reservations = readReservations(store);
    assert.equal(reservations.length, 1);
    assert.equal(reservations[0].customerId, undefined);
    assert.equal(reservations[0].inventoryItemId, undefined);
    assert.equal(reservations[0].customerPhoneSnapshot, '999');
    assert.equal(reservations[0].dressCodeSnapshot, 'UNKNOWN');
  } finally {
    resetMigrationMarkers();
    delete globalThis.window;
  }
});

test('failed migration rolls back to the exact previous collection state', () => {
  const store = installStorage(seedFixture());
  resetMigrationMarkers();
  const before = store.get(getCollectionKey('reservations'));
  const originalSet = globalThis.window.localStorage.setItem;
  globalThis.window.localStorage.setItem = function guardedSet(key, value) {
    if (key === getCollectionKey('reservations')) {
      throw new Error('forced write failure');
    }
    return originalSet.call(this, key, value);
  };
  try {
    assert.throws(() => migrateStableReferences(), /forced write failure/);
  } finally {
    globalThis.window.localStorage.setItem = originalSet;
  }
  assert.equal(store.get(getCollectionKey('reservations')), before);
  assert.equal(getMigrationMarker(REFERENCE_MIGRATION_ID).status, 'failed');
  resetMigrationMarkers();
  delete globalThis.window;
});
