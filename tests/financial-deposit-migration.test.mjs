import test from 'node:test';
import assert from 'node:assert/strict';
import { getCollectionKey } from '../src/engines/persistence/collectionRegistry.ts';

function installStorage() {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      get length() { return store.size; },
      getItem(k) { return store.has(k) ? store.get(k) : null; },
      setItem(k, v) { store.set(k, String(v)); },
      removeItem(k) { store.delete(k); },
      key(i) { return Array.from(store.keys())[i] ?? null; },
      clear() { store.clear(); },
    },
  };
  return store;
}
function cleanup() {
  delete globalThis.window;
}

function writeRaw(store, collection, items) {
  store.set(getCollectionKey(collection), JSON.stringify(items));
}

test('unresolved legacy depositAmount must not be silently copied into canonical field as confirmed', async () => {
  const store = installStorage();
  try {
    const { resetMigrationMarkers } = await import('../src/engines/persistence/migrationRunner.ts');
    const { migrateFinancialDepositFields } = await import('../src/engines/persistence/financialDepositMigration.ts');

    resetMigrationMarkers();
    writeRaw(store, 'reservations', [{
      id: 'res-legacy-unresolved',
      reservationNumber: 'RSV-UNRESOLVED',
      customerName: 'عميل قديم',
      customerPhone: '9000',
      dressCode: 'D001',
      dressName: 'فستان قديم',
      pickupDate: '2026-08-10',
      returnDate: '2026-08-12',
      status: 'confirmed',
      rentalPrice: 100,
      depositAmount: 50,
      totalAmount: 150,
      // This legacy value could be the ambiguous old deposit.  With no explicit
      // payment history it must not become canonical rental collection.
      paidAmount: 50,
      remainingAmount: 150,
    }]);
    writeRaw(store, 'payments', []);
    writeRaw(store, 'delivery-return', []);

    const migrated = migrateFinancialDepositFields();
    assert.equal(migrated, true, 'migration should run');

    const { readCollection: readAfter } = await import('../src/engines/persistence/persistenceEngine.ts');
    const reservations = readAfter('reservations');
    const res = reservations.find((r) => r.reservationNumber === 'RSV-UNRESOLVED');
    assert.ok(res, 'reservation exists after migration');
    assert.equal(res.legacyDepositAmount, 50, 'original preserved in legacy_deposit_amount');
    assert.equal(res.legacyDepositClassification, 'unresolved');
    assert.equal(res.needsFinancialClassification, true);
    assert.equal(res.securityDepositAmount, 0, 'canonical security deposit must remain 0 for unresolved, not silently copied');
    assert.equal(res.bookingAdvanceAmount, 0, 'canonical booking advance must remain 0 for unresolved');
    assert.equal(res.securityDepositCollectedAmount, 0, 'collected must remain 0, not refundable');
    assert.equal(res.securityDepositRefundedAmount, 0);
    assert.equal(res.securityDepositRetainedAmount, 0);
    assert.equal(res.rentalCollectedAmount, 0, 'unresolved paidAmount is not rental collection without explicit history');
    assert.equal(res.remainingAmount, 100, 'unresolved paidAmount must not reduce the rental receivable');
    const { calculateSecurityDepositLiability } = await import('../src/shared/utils/financialCalculations.js');
    const liability = calculateSecurityDepositLiability({
      collected: res.securityDepositCollectedAmount,
      refunded: res.securityDepositRefundedAmount,
      retained: res.securityDepositRetainedAmount,
    });
    assert.equal(liability, 0, 'liability must be 0 for unresolved, not refundable/retainable');
  } finally {
    cleanup();
  }
});

test('resolved legacy with settlement evidence populates canonical as security deposit', async () => {
  const store = installStorage();
  try {
    const { resetMigrationMarkers } = await import('../src/engines/persistence/migrationRunner.ts');
    const { migrateFinancialDepositFields } = await import('../src/engines/persistence/financialDepositMigration.ts');

    resetMigrationMarkers();
    writeRaw(store, 'reservations', [{
      id: 'res-legacy-resolved',
      reservationNumber: 'RSV-RESOLVED',
      customerName: 'عميل قديم',
      customerPhone: '9001',
      dressCode: 'D002',
      dressName: 'فستان قديم 2',
      pickupDate: '2026-08-10',
      returnDate: '2026-08-12',
      status: 'returned',
      rentalPrice: 100,
      depositAmount: 50,
      totalAmount: 150,
      paidAmount: 150,
      remainingAmount: 0,
      settledDepositAmount: 50,
    }]);
    writeRaw(store, 'payments', [{
      id: 'pay1',
      reservationNumber: 'RSV-RESOLVED',
      type: 'deposit',
      direction: 'income',
      amount: 50,
    }]);
    writeRaw(store, 'delivery-return', [{
      id: 'dr1',
      reservationNumber: 'RSV-RESOLVED',
      depositAmount: 50,
      depositRefundAmount: 40,
      lateFee: 10,
    }]);

    const migrated = migrateFinancialDepositFields();
    assert.equal(migrated, true);

    const { readCollection } = await import('../src/engines/persistence/persistenceEngine.ts');
    const reservations = readCollection('reservations');
    const res = reservations.find((r) => r.reservationNumber === 'RSV-RESOLVED');
    assert.ok(res);
    assert.equal(res.legacyDepositAmount, 50);
    assert.equal(res.legacyDepositClassification, 'security_deposit', 'with settlement evidence should be classified as security_deposit');
    assert.equal(res.securityDepositAmount, 50, 'canonical should be populated when evidence proves security deposit');
    assert.equal(res.needsFinancialClassification, false);
  } finally {
    cleanup();
  }
});

test('unresolved legacy does not affect canonical rental balance or liability and not refundable automatically', async () => {
  const store = installStorage();
  try {
    const { resetMigrationMarkers } = await import('../src/engines/persistence/migrationRunner.ts');
    const { migrateFinancialDepositFields } = await import('../src/engines/persistence/financialDepositMigration.ts');

    resetMigrationMarkers();
    writeRaw(store, 'reservations', [{
      id: 'res-unresolved-no-auto',
      reservationNumber: 'RSV-NO-AUTO',
      customerName: 'عميل',
      customerPhone: '9002',
      dressCode: 'D003',
      dressName: 'فستان',
      pickupDate: '2026-08-10',
      returnDate: '2026-08-12',
      status: 'delivered',
      rentalPrice: 100,
      depositAmount: 50,
      totalAmount: 150,
      paidAmount: 0,
      remainingAmount: 150,
    }]);
    writeRaw(store, 'payments', []);
    writeRaw(store, 'delivery-return', []);

    migrateFinancialDepositFields();

    const { getReservations } = await import('../src/features/reservations/reservation.service.ts');
    const serviceRes = getReservations().find((r) => r.reservationNumber === 'RSV-NO-AUTO');
    assert.ok(serviceRes);
    assert.equal(serviceRes.needsFinancialClassification, true);
    const { settleReservationReturn } = await import('../src/features/reservations/reservation.service.ts');
    assert.throws(() => {
      settleReservationReturn({
        reservationNumber: 'RSV-NO-AUTO',
        lateFee: 0,
        damageFee: 0,
        refundAmount: 10,
        settledDepositAmount: 50,
        retainedDepositAmount: 0,
      });
    }, /يحتاج مراجعة مالية/);
  } finally {
    cleanup();
  }
});
