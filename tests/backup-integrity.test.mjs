import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REGISTERED_COLLECTIONS,
  exportDatabaseBackup,
  importDatabaseBackup,
  writeCollection,
  readCollection,
  getCollectionKey,
  getMigrationMarker,
  markMigrationSuccess,
  resetMigrationMarkers,
  createDatabaseSnapshot,
  restoreDatabaseSnapshot,
  resetDatabase,
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

function cleanup() {
  resetMigrationMarkers();
  delete globalThis.window;
}

/** Every collection the showroom can create must be part of the backup. */
const REQUIRED_COLLECTIONS = [
  'customers',
  'dresses',
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
  'retired-codes',
  'preferences',
  'showroom-profile',
  'images',
];

test('every operational collection is registered', () => {
  for (const collection of REQUIRED_COLLECTIONS) {
    assert.ok(REGISTERED_COLLECTIONS.includes(collection), `${collection} must be registered`);
  }
});

test('the backup contains every registered collection, including counters and allocators', () => {
  installStorage();
  try {
    REQUIRED_COLLECTIONS.forEach((collection, index) => {
      writeCollection(collection, [{ id: `${collection}-${index}` }]);
    });

    const backup = exportDatabaseBackup();
    for (const collection of REQUIRED_COLLECTIONS) {
      assert.ok(collection in backup.collections, `${collection} must be exported`);
      assert.equal(backup.collections[collection].length, 1, `${collection} rows must be exported`);
    }
  } finally {
    cleanup();
  }
});

test('a full export/import round trip preserves every record exactly', () => {
  installStorage();
  try {
    REQUIRED_COLLECTIONS.forEach((collection, index) => {
      writeCollection(collection, [{ id: `${collection}-${index}`, value: index }]);
    });
    const before = exportDatabaseBackup();

    resetDatabase();
    assert.equal(readCollection('customers', []).length, 0);

    importDatabaseBackup(before);
    for (const collection of REQUIRED_COLLECTIONS) {
      assert.deepEqual(readCollection(collection, []), before.collections[collection], collection);
    }
  } finally {
    cleanup();
  }
});

test('migration markers survive backup and restore so one-time migrations never re-run', () => {
  installStorage();
  try {
    writeCollection('customers', [{ id: 'c1' }]);
    markMigrationSuccess('inventory-v1');
    markMigrationSuccess('stable-references-v1');

    const backup = exportDatabaseBackup();
    // Markers are objects, not a collection: they must not be exported as an empty array.
    assert.equal('migration-markers' in backup.collections, false);
    assert.ok(backup.migrationMarkers);

    importDatabaseBackup(backup);
    assert.equal(getMigrationMarker('inventory-v1').status, 'completed');
    assert.equal(getMigrationMarker('stable-references-v1').status, 'completed');
  } finally {
    cleanup();
  }
});

test('an invalid backup is rejected before any data is mutated', () => {
  installStorage();
  try {
    writeCollection('customers', [{ id: 'live-1' }]);
    const live = readCollection('customers', []);

    const invalidBackups = [
      null,
      'not-an-object',
      { applicationId: 'other-app', schemaVersion: 1, exportedAt: 'x', collections: {} },
      { applicationId: 'dress-roomshow', schemaVersion: 999, exportedAt: 'x', collections: {} },
      { applicationId: 'dress-roomshow', schemaVersion: 1, exportedAt: 'x' },
      { applicationId: 'dress-roomshow', schemaVersion: 1, exportedAt: 'x', collections: { customers: 'nope' } },
    ];

    for (const invalid of invalidBackups) {
      assert.throws(() => importDatabaseBackup(invalid));
      assert.deepEqual(readCollection('customers', []), live, 'live data must be untouched by a rejected backup');
    }
  } finally {
    cleanup();
  }
});

test('a valid legacy collection-only backup stays importable', () => {
  installStorage();
  try {
    const legacy = {
      applicationId: 'dress-roomshow',
      schemaVersion: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
      collections: { customers: [{ id: 'legacy-1' }], dresses: [{ id: 'legacy-dress' }] },
      // no backupVersion, no imageBlobs, no migrationMarkers
    };

    importDatabaseBackup(legacy);
    assert.equal(readCollection('customers', [])[0].id, 'legacy-1');
    assert.equal(readCollection('dresses', [])[0].id, 'legacy-dress');
  } finally {
    cleanup();
  }
});

test('a failed import restores the exact previous state instead of leaving half the data', () => {
  const store = installStorage();
  try {
    writeCollection('customers', [{ id: 'live-1' }]);
    writeCollection('dresses', [{ id: 'live-dress' }]);
    const liveCustomers = readCollection('customers', []);
    const liveDresses = readCollection('dresses', []);

    const incoming = exportDatabaseBackup();
    incoming.collections.customers = [{ id: 'incoming-1' }];
    incoming.collections.dresses = [{ id: 'incoming-dress' }];

    // Fail midway through writing the incoming data.
    const originalSet = globalThis.window.localStorage.setItem;
    let writes = 0;
    globalThis.window.localStorage.setItem = function guarded(key, value) {
      if (key === getCollectionKey('dresses')) {
        writes += 1;
        if (writes === 1) throw new Error('forced import failure');
      }
      return originalSet.call(this, key, value);
    };

    try {
      // The engine wraps storage faults in a user-facing Arabic persistence error.
      assert.throws(() => importDatabaseBackup(incoming), (error) => {
        assert.match(error.message, /تعذر حفظ البيانات محلياً/);
        return true;
      });
    } finally {
      globalThis.window.localStorage.setItem = originalSet;
    }

    assert.deepEqual(readCollection('customers', []), liveCustomers, 'no partial restore');
    assert.deepEqual(readCollection('dresses', []), liveDresses, 'no partial restore');
    assert.ok(store.size > 0);
  } finally {
    cleanup();
  }
});

test('restoring into an empty database works and does not resurrect stale collections', () => {
  installStorage();
  try {
    writeCollection('customers', [{ id: 'c1' }]);
    writeCollection('payments', [{ id: 'p1' }]);
    const backup = exportDatabaseBackup();

    resetDatabase();
    importDatabaseBackup(backup);

    assert.equal(readCollection('customers', []).length, 1);
    assert.equal(readCollection('payments', []).length, 1);
  } finally {
    cleanup();
  }
});

test('restoring over existing live data replaces it completely without merging', () => {
  installStorage();
  try {
    writeCollection('customers', [{ id: 'from-backup' }]);
    const backup = exportDatabaseBackup();

    writeCollection('customers', [{ id: 'live-a' }, { id: 'live-b' }]);
    writeCollection('sales', [{ id: 'live-sale' }]);

    importDatabaseBackup(backup);
    const customers = readCollection('customers', []);
    assert.equal(customers.length, 1);
    assert.equal(customers[0].id, 'from-backup');
    assert.equal(readCollection('sales', []).length, 0, 'data absent from the backup must not survive');
  } finally {
    cleanup();
  }
});

test('a snapshot rollback keeps migration markers and does not destroy data when storage fails', () => {
  installStorage();
  try {
    writeCollection('customers', [{ id: 'before' }]);
    markMigrationSuccess('inventory-v1');
    const snapshot = createDatabaseSnapshot();

    writeCollection('customers', [{ id: 'before' }, { id: 'after' }]);
    resetMigrationMarkers();

    restoreDatabaseSnapshot(snapshot);
    assert.deepEqual(readCollection('customers', []), [{ id: 'before' }]);
    assert.equal(getMigrationMarker('inventory-v1').status, 'completed');
  } finally {
    cleanup();
  }
});
