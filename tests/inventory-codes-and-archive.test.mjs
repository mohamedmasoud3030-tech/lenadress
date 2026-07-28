import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateCode,
  formatCode,
  parseCodeSequence,
  reconcileCounter,
  getCounterSequence,
  resetCountersForTesting,
  getCollectionKey,
} from '../src/engines/persistence/index.ts';
import { addDress, archiveDress, deleteDress, getDresses, getDressDeletionBlockers } from '../src/features/dresses/dress.service.ts';
import { getCustomerHardDeleteBlockers, getDressHardDeleteBlockers } from '../src/features/integrity/integrity.service.ts';

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

function cleanup() {
  resetCountersForTesting();
  delete globalThis.window;
}

const baseDressInput = {
  name: 'فستان اختبار',
  description: '',
  itemType: 'dress',
  category: 'سهرة',
  color: 'أحمر',
  size: 'M',
  purchasePrice: 100,
  rentalPrice: 20,
  salePrice: 150,
  depositAmount: 30,
  status: 'available',
  isForRent: true,
  isForSale: true,
  images: [],
  barcode: '',
};

test('code helpers parse and format both canonical and legacy shapes', () => {
  assert.equal(parseCodeSequence('D-014', 'D'), 14);
  assert.equal(parseCodeSequence('D014', 'D'), 14);
  assert.equal(parseCodeSequence('', 'D'), 0);
  assert.equal(parseCodeSequence('X-3', 'D'), 0);
  assert.equal(formatCode('D', 7), 'D-007');
});

test('allocator is monotonic and never reuses a code after deletion', () => {
  installStorage();
  try {
    const first = allocateCode('inventory-code', 'D', []);
    const second = allocateCode('inventory-code', 'D', [first]);
    assert.equal(first, 'D-001');
    assert.equal(second, 'D-002');

    // The first item is deleted: the live set no longer contains D-001, but the
    // durable counter must still refuse to hand it out again.
    const third = allocateCode('inventory-code', 'D', [second]);
    assert.equal(third, 'D-003');
    assert.equal(getCounterSequence('inventory-code'), 3);
  } finally {
    cleanup();
  }
});

test('allocator reconciles after a restore that carries higher codes than the counter', () => {
  installStorage();
  try {
    allocateCode('inventory-code', 'D', []);
    // A restored backup brings items numbered far beyond the local counter.
    const restoredCodes = ['D-001', 'D-042'];
    assert.equal(reconcileCounter('inventory-code', 'D', restoredCodes), 42);
    assert.equal(allocateCode('inventory-code', 'D', restoredCodes), 'D-043');
  } finally {
    cleanup();
  }
});

test('allocator skips codes that already exist even when the counter is behind', () => {
  installStorage();
  try {
    const existing = ['D-001', 'D-002', 'D-003'];
    assert.equal(allocateCode('inventory-code', 'D', existing), 'D-004');
  } finally {
    cleanup();
  }
});

test('adding items produces unique codes and deletion never recycles them', () => {
  installStorage();
  try {
    const first = addDress({ ...baseDressInput, name: 'قطعة أولى' });
    const second = addDress({ ...baseDressInput, name: 'قطعة ثانية' });
    assert.notEqual(first.code, second.code);

    // A brand-new item with no history can be hard deleted.
    assert.deepEqual(getDressDeletionBlockers(first.code), []);
    assert.equal(deleteDress(first.code), true);
    assert.equal(getDresses().some((item) => item.code === first.code), false);

    const third = addDress({ ...baseDressInput, name: 'قطعة ثالثة' });
    assert.notEqual(third.code, first.code, 'a retired code must never be reused');
    assert.notEqual(third.code, second.code);
  } finally {
    cleanup();
  }
});

test('an item with history cannot be hard deleted and is archived instead', () => {
  const store = installStorage();
  try {
    const dress = addDress({ ...baseDressInput, name: 'قطعة لها تاريخ' });
    store.set(
      getCollectionKey('sales-invoices'),
      JSON.stringify([{ id: 'inv-1', invoiceNumber: 'INV-1', lines: [{ dressCode: dress.code, amount: 100 }] }]),
    );

    const blockers = getDressDeletionBlockers(dress.code);
    assert.ok(blockers.length > 0);
    assert.throws(() => deleteDress(dress.code), /الأرشفة/);
    assert.equal(getDresses().some((item) => item.code === dress.code), true);

    const archived = archiveDress(dress.code);
    assert.equal(archived.status, 'inactive');
    assert.equal(typeof archived.archivedAt, 'string');
    // Archiving keeps the record so reports and history still resolve it.
    assert.equal(getDresses().some((item) => item.code === dress.code), true);
  } finally {
    cleanup();
  }
});

test('rented or sold items are blocked from archiving', () => {
  installStorage();
  try {
    assert.ok(getDressHardDeleteBlockers('D-999', 'rented').length > 0);
    assert.ok(getDressHardDeleteBlockers('D-999', 'sold').length > 0);
  } finally {
    cleanup();
  }
});

test('a customer with a reservation or an outstanding balance cannot be hard deleted', () => {
  const store = installStorage();
  try {
    store.set(
      getCollectionKey('reservations'),
      JSON.stringify([
        {
          id: 'rsv-1',
          reservationNumber: 'RSV-1',
          customerId: 'cus-1',
          customerPhone: '9000-0001',
          status: 'confirmed',
          remainingAmount: 30,
        },
      ]),
    );

    const blockers = getCustomerHardDeleteBlockers('cus-1', '9000-0001');
    assert.ok(blockers.some((message) => message.includes('حجز')));
    assert.ok(blockers.some((message) => message.includes('رصيد')));

    // A customer with no history at all is not blocked.
    assert.deepEqual(getCustomerHardDeleteBlockers('cus-new', '9111111'), []);
  } finally {
    cleanup();
  }
});
