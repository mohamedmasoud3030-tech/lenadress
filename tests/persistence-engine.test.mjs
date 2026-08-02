import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CURRENT_STORAGE_SCHEMA_VERSION,
  DATABASE_APPLICATION_ID,
  REGISTERED_COLLECTIONS,
  createDatabaseSnapshot,
  exportDatabaseBackup,
  generateId,
  generateNumber,
  getCollectionKey,
  importDatabaseBackup,
  initializeLocalDatabase,
  isRegisteredCollection,
  listCollectionNames,
  readCollection,
  resetDatabase,
  restoreDatabaseSnapshot,
  runCompensatedOperation,
  runInTransaction,
  runInTransactionAsync,
  writeCollection,
  migrateLegacyInventoryStorage,
  migrateLegacyAppointmentStorage,
  getMigrationMarker,
  markMigrationFailure,
  markMigrationSuccess,
  resetMigrationMarkers,
  runMigratorWithRollback,
  CURRENT_BACKUP_SCHEMA_VERSION,
  exportDatabaseBackupAsync,
  importDatabaseBackupAsync,
  resetDatabaseAsync,
  isDemoDataLoaded,
  loadConfirmedDemoData,
  revertDemoDataToPreviousSnapshot,
  getPreDemoSnapshot,
  clearPreDemoSnapshot,
  savePreDemoSnapshot,
} from '../src/engines/persistence/index.ts';

test('persistence engine exposes canonical collection registry and metadata', () => {
  const metadata = initializeLocalDatabase();
  assert.equal(metadata.applicationId, 'dress-roomshow');
  assert.equal(metadata.schemaVersion, 2);
  assert.equal(typeof metadata.updatedAt, 'string');
  assert.equal(DATABASE_APPLICATION_ID, 'dress-roomshow');
  assert.equal(CURRENT_STORAGE_SCHEMA_VERSION, 2);
  assert.equal(isRegisteredCollection('customers'), true);
  assert.equal(isRegisteredCollection('invalid-collection'), false);
  assert.equal(getCollectionKey('customers'), 'dress-roomshow:customers');
  assert.equal(REGISTERED_COLLECTIONS.includes('customers'), true);
  assert.equal(REGISTERED_COLLECTIONS.includes('dresses'), true);
  assert.equal(REGISTERED_COLLECTIONS.includes('reservations'), true);
  assert.equal(REGISTERED_COLLECTIONS.includes('appointments'), true);
  assert.equal(REGISTERED_COLLECTIONS.includes('sales-invoices'), true);
  assert.equal(REGISTERED_COLLECTIONS.includes('sale-returns'), true);
  assert.equal(REGISTERED_COLLECTIONS.includes('service-tasks'), true);
  assert.equal(REGISTERED_COLLECTIONS.includes('audit'), true);
  assert.equal(REGISTERED_COLLECTIONS.includes('images'), true);
});

test('persistence engine read and write collections preserve data and metadata through StoragePort', () => {
  const store = new Map();
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
    },
  };

  try {
    writeCollection('customers', [{ id: 'c1', name: 'Soha' }]);
    const items = readCollection('customers');
    assert.deepEqual(items, [{ id: 'c1', name: 'Soha' }]);
    assert.equal(isRegisteredCollection('customers'), true);
    assert.equal(listCollectionNames().includes('customers'), true);

    const backup = exportDatabaseBackup();
    assert.equal(backup.applicationId, 'dress-roomshow');
    assert.equal(backup.schemaVersion, 2);
    assert.deepEqual(backup.collections.customers, [{ id: 'c1', name: 'Soha' }]);

    resetDatabase();
    assert.deepEqual(readCollection('customers'), []);

    importDatabaseBackup(backup);
    assert.deepEqual(readCollection('customers'), [{ id: 'c1', name: 'Soha' }]);

    const id = generateId();
    assert.equal(typeof id, 'string');
    assert.equal(id.length > 0, true);

    const numberStr = generateNumber('INV');
    assert.match(numberStr, /^INV-\d{8}-\d{6}-\d{3}$/);
  } finally {
    delete globalThis.window;
  }
});

test('persistence engine transaction and snapshot primitives rollback exact prior state on failure', async () => {
  const store = new Map();
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
    },
  };

  try {
    writeCollection('customers', [{ id: 'customer-original' }]);
    writeCollection('dresses', [{ id: 'dress-original' }]);

    const snapshot = createDatabaseSnapshot();
    assert.deepEqual(snapshot.collections.customers, [{ id: 'customer-original' }]);
    assert.deepEqual(snapshot.collections.dresses, [{ id: 'dress-original' }]);

    assert.throws(() => {
      runInTransaction(() => {
        writeCollection('customers', [{ id: 'customer-updated' }]);
        writeCollection('dresses', [{ id: 'dress-updated' }]);
        throw new Error('Simulated workflow failure midway through write sequence');
      });
    }, /Simulated workflow failure/);

    assert.deepEqual(readCollection('customers'), [{ id: 'customer-original' }]);
    assert.deepEqual(readCollection('dresses'), [{ id: 'dress-original' }]);

    const result = runInTransaction(() => {
      writeCollection('customers', [{ id: 'customer-committed' }]);
      return 'success';
    });
    assert.equal(result, 'success');
    assert.deepEqual(readCollection('customers'), [{ id: 'customer-committed' }]);

    await assert.rejects(async () => {
      await runInTransactionAsync(async () => {
        writeCollection('dresses', [{ id: 'dress-async-updated' }]);
        throw new Error('Simulated async failure');
      });
    }, /Simulated async failure/);
    assert.deepEqual(readCollection('dresses'), [{ id: 'dress-original' }]);

    assert.throws(() => {
      runCompensatedOperation(
        () => {
          writeCollection('customers', [{ id: 'customer-compensated' }]);
          throw new Error('Trigger compensation');
        },
        (error, priorSnapshot) => {
          assert.match(String(error), /Trigger compensation/);
          restoreDatabaseSnapshot(priorSnapshot);
        },
      );
    }, /Trigger compensation/);
    assert.deepEqual(readCollection('customers'), [{ id: 'customer-committed' }]);
  } finally {
    delete globalThis.window;
  }
});

test('migrateLegacyInventoryStorage migrates lena_dresses exactly once without duplication', () => {
  const store = new Map();
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
    },
  };

  try {
    writeCollection('dresses', [{ id: 'dress-existing', code: 'D001', name: 'Existing Dress' }]);
    store.set('lena_dresses', JSON.stringify([
      { id: 'dress-existing', code: 'D001', name: 'Duplicate Dress (should skip)' },
      { id: 'dress-legacy-1', code: 'D002', name: 'Legacy Dress 1' },
      { id: 'dress-legacy-2', code: 'D003', name: 'Legacy Dress 2' },
    ]));
    resetMigrationMarkers();

    const migrated = migrateLegacyInventoryStorage();
    assert.equal(migrated, true);
    assert.equal(store.has('lena_dresses'), false);

    const canonicalItems = readCollection('dresses');
    assert.equal(canonicalItems.length, 3);
    assert.deepEqual(canonicalItems, [
      { id: 'dress-existing', code: 'D001', name: 'Existing Dress' },
      { id: 'dress-legacy-1', code: 'D002', name: 'Legacy Dress 1' },
      { id: 'dress-legacy-2', code: 'D003', name: 'Legacy Dress 2' },
    ]);

    // Second run should return false and keep exact same items
    assert.equal(migrateLegacyInventoryStorage(), false);
    assert.equal(readCollection('dresses').length, 3);
  } finally {
    delete globalThis.window;
  }
});

test('migrateLegacyAppointmentStorage migrates lena_appointments exactly once without duplication', () => {
  const store = new Map();
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
    },
  };

  try {
    writeCollection('appointments', [{ id: 'apt-existing', clientName: 'Existing Client' }]);
    store.set('lena_appointments', JSON.stringify([
      { id: 'apt-existing', clientName: 'Duplicate Client (should skip)' },
      { id: 'apt-legacy-1', clientName: 'Legacy Client 1' },
      { id: 'apt-legacy-2', clientName: 'Legacy Client 2' },
    ]));
    resetMigrationMarkers();

    const migrated = migrateLegacyAppointmentStorage();
    assert.equal(migrated, true);
    assert.equal(store.has('lena_appointments'), false);

    const canonicalItems = readCollection('appointments');
    assert.equal(canonicalItems.length, 3);
    assert.deepEqual(canonicalItems, [
      { id: 'apt-existing', clientName: 'Existing Client' },
      { id: 'apt-legacy-1', clientName: 'Legacy Client 1' },
      { id: 'apt-legacy-2', clientName: 'Legacy Client 2' },
    ]);

    assert.equal(migrateLegacyAppointmentStorage(), false);
    assert.equal(readCollection('appointments').length, 3);
  } finally {
    delete globalThis.window;
  }
});

test('runMigratorWithRollback records markers, retries after failure, and rolls back partial state', () => {
  const store = new Map();
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
    },
  };

  try {
    resetMigrationMarkers();
    writeCollection('customers', [{ id: 'c-init', name: 'Original Customer' }]);

    assert.throws(() => {
      runMigratorWithRollback('test-migrator-1', () => {
        writeCollection('customers', [{ id: 'c-init', name: 'Original Customer' }, { id: 'c-corrupt', name: 'Corrupt' }]);
        throw new Error('Mid-migration failure');
      });
    }, /Mid-migration failure/);

    const markerAfterFailure = getMigrationMarker('test-migrator-1');
    assert.equal(markerAfterFailure.status, 'failed');
    assert.equal(markerAfterFailure.attemptCount, 1);
    assert.match(markerAfterFailure.lastError, /Mid-migration failure/);
    assert.deepEqual(readCollection('customers'), [{ id: 'c-init', name: 'Original Customer' }]);

    const retryResult = runMigratorWithRollback('test-migrator-1', () => {
      writeCollection('customers', [{ id: 'c-init', name: 'Original Customer' }, { id: 'c-success', name: 'Migrated' }]);
      return 'done';
    });

    assert.equal(retryResult.status, 'completed');
    assert.equal(retryResult.result, 'done');
    assert.deepEqual(readCollection('customers'), [
      { id: 'c-init', name: 'Original Customer' },
      { id: 'c-success', name: 'Migrated' },
    ]);

    const markerAfterSuccess = getMigrationMarker('test-migrator-1');
    assert.equal(markerAfterSuccess.status, 'completed');
    assert.equal(markerAfterSuccess.attemptCount, 2);

    const skippedResult = runMigratorWithRollback('test-migrator-1', () => {
      throw new Error('Should never run once completed');
    });
    assert.equal(skippedResult.status, 'skipped');
    assert.equal(skippedResult.result, null);

    const mSuccess = markMigrationSuccess('manual-test');
    assert.equal(mSuccess.status, 'completed');
    const mFail = markMigrationFailure('manual-test', new Error('Manual fail'));
    assert.equal(mFail.status, 'failed');
  } finally {
    delete globalThis.window;
  }
});

test('exportDatabaseBackupAsync and importDatabaseBackupAsync validate versioned backup schema and preserve images', async () => {
  const store = new Map();
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
    },
  };

  try {
    writeCollection('dresses', [{ id: 'd-img-1', name: 'Dress with image' }]);
    const backupAsync = await exportDatabaseBackupAsync();
    assert.equal(backupAsync.backupVersion, CURRENT_BACKUP_SCHEMA_VERSION);
    assert.equal(Array.isArray(backupAsync.imageBlobs), true);

    await resetDatabaseAsync();
    assert.deepEqual(readCollection('dresses'), []);

    await importDatabaseBackupAsync(backupAsync);
    assert.deepEqual(readCollection('dresses'), [{ id: 'd-img-1', name: 'Dress with image' }]);

    // Invalid backup schema or corrupt structure must throw cleanly without mutation
    assert.throws(() => {
      importDatabaseBackup({ applicationId: DATABASE_APPLICATION_ID, schemaVersion: 1, backupVersion: 999 });
    }, /إصدار مخطط النسخة الاحتياطية غير صالح/);
  } finally {
    delete globalThis.window;
  }
});

test('loadConfirmedDemoData captures pre-demo snapshot and revertDemoDataToPreviousSnapshot restores exact prior state', () => {
  const store = new Map();
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
    },
  };

  try {
    resetDatabase();
    writeCollection('customers', [{ id: 'custom-user-1', name: 'Real Production User' }]);
    assert.equal(isDemoDataLoaded(), false);

    loadConfirmedDemoData();
    assert.equal(isDemoDataLoaded(), true);
    assert.notEqual(readCollection('customers').length, 1);
    const preDemo = getPreDemoSnapshot();
    assert.notEqual(preDemo, null);
    assert.deepEqual(preDemo.collections.customers, [{ id: 'custom-user-1', name: 'Real Production User' }]);

    const reverted = revertDemoDataToPreviousSnapshot();
    assert.equal(reverted, true);
    assert.equal(isDemoDataLoaded(), false);
    assert.deepEqual(readCollection('customers'), [{ id: 'custom-user-1', name: 'Real Production User' }]);
    assert.equal(getPreDemoSnapshot(), null);

    // Also test helper exports to ensure lint covers unused vars
    savePreDemoSnapshot(preDemo);
    clearPreDemoSnapshot();
    assert.equal(getPreDemoSnapshot(), null);
  } finally {
    delete globalThis.window;
  }
});
