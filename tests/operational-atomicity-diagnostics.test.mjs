import test from 'node:test';
import assert from 'node:assert/strict';
import { installStorage, uninstallStorage, futureDate } from './helpers/storage.mjs';
import {
  getCollectionKey,
  readCollection,
  resetCountersForTesting,
} from '../src/engines/persistence/index.ts';
import { getAuditLog } from '../src/features/audit/audit.service.ts';
import { addCustomer, getCustomers } from '../src/features/customers/customer.service.ts';
import {
  addDress,
  getDressByCode,
  getDresses,
} from '../src/features/dresses/dress.service.ts';
import {
  DEFAULT_APP_PREFERENCES,
  saveAppPreferences,
} from '../src/features/preferences/preferences.service.ts';
import {
  getStocktakeSessions,
} from '../src/features/stocktake/stocktake.service.ts';
import {
  getWaitlistEntries,
} from '../src/features/waitlist/waitlist.service.ts';
import {
  addCustomerCommand,
  addWaitlistEntryCommand,
  archiveDressCommand,
  resetApplicationDataCommand,
  startStocktakeSessionCommand,
} from '../src/features/workflows/administrationCommands.ts';
import { setCommandFailurePoint } from '../src/engines/workflows/index.ts';

const itemInput = {
  name: 'قطعة ذرّية',
  description: '',
  itemType: 'dress',
  category: 'سهرة',
  color: 'أسود',
  size: 'M',
  purchasePrice: 100,
  rentalPrice: 40,
  salePrice: 0,
  depositAmount: 20,
  status: 'available',
  isForRent: true,
  isForSale: false,
  images: [],
  barcode: '',
};

function cleanup() {
  setCommandFailurePoint(null);
  resetCountersForTesting();
  uninstallStorage();
}

function failNextAuditWrite() {
  const storage = globalThis.window.localStorage;
  const original = storage.setItem;
  let failed = false;
  storage.setItem = function failAudit(key, value) {
    if (!failed && key === getCollectionKey('audit-log')) {
      failed = true;
      throw new Error('forced audit failure');
    }
    return original.call(this, key, value);
  };
  return () => {
    storage.setItem = original;
  };
}

test('customer creation rolls back when its audit write fails', () => {
  installStorage();
  const restore = failNextAuditWrite();
  try {
    assert.throws(
      () => addCustomerCommand({
        name: 'عميلة ذرّية',
        phone: '92220001',
        status: 'normal',
        idempotencyKey: 'diagnosis-customer-atomicity',
      }),
      /تعذر حفظ البيانات محلياً/,
    );
  } finally {
    restore();
  }
  try {
    assert.equal(getCustomers().length, 0);
  } finally {
    cleanup();
  }
});

test('inventory archiving rolls back when its audit write fails', () => {
  installStorage();
  try {
    const item = addDress(itemInput);
    const restore = failNextAuditWrite();
    try {
      assert.throws(
        () => archiveDressCommand(item.code, 'diagnosis-inventory-atomicity'),
        /تعذر حفظ البيانات محلياً/,
      );
    } finally {
      restore();
    }
    assert.equal(getDressByCode(item.code)?.status, 'available');
    assert.equal(getDressByCode(item.code)?.archivedAt, undefined);
  } finally {
    cleanup();
  }
});

test('waitlist creation rolls back when its audit write fails', () => {
  installStorage();
  try {
    const customer = addCustomer({ name: 'عميلة انتظار', phone: '92220002', status: 'normal' });
    const item = addDress(itemInput);
    const restore = failNextAuditWrite();
    try {
      assert.throws(
        () => addWaitlistEntryCommand({
          customerId: customer.id,
          inventoryItemId: item.id,
          pickupDate: futureDate(2),
          returnDate: futureDate(4),
          idempotencyKey: 'diagnosis-waitlist-atomicity',
        }),
        /تعذر حفظ البيانات محلياً/,
      );
    } finally {
      restore();
    }
    assert.equal(getWaitlistEntries().length, 0);
  } finally {
    cleanup();
  }
});

test('stocktake opening rolls back when its audit write fails', () => {
  installStorage();
  const restore = failNextAuditWrite();
  try {
    assert.throws(
      () => startStocktakeSessionCommand('جرد ذرّي', 'diagnosis-stocktake-atomicity'),
      /تعذر حفظ البيانات محلياً/,
    );
  } finally {
    restore();
  }
  try {
    assert.equal(getStocktakeSessions().length, 0);
  } finally {
    cleanup();
  }
});

test('inventory creation always leaves an audit record', () => {
  installStorage();
  try {
    const item = addDress(itemInput);
    assert.equal(getDresses().length, 1);
    assert.ok(getAuditLog().some((entry) => (
      entry.entityType === 'dress'
      && entry.entityId === item.id
      && entry.action === 'create'
    )));
  } finally {
    cleanup();
  }
});

test('operational preference changes always leave an audit record', () => {
  installStorage();
  try {
    saveAppPreferences({
      ...DEFAULT_APP_PREFERENCES,
      preparationDaysBeforePickup: 2,
    });
    assert.ok(getAuditLog().some((entry) => (
      entry.entityType === 'preferences'
      && entry.action === 'update'
    )));
    assert.equal(readCollection('preferences', []).length, 1);
  } finally {
    cleanup();
  }
});

test('a failed reset restores every pre-existing record', () => {
  installStorage();
  try {
    const customer = addCustomer({ name: 'قبل التصفير', phone: '92220003', status: 'normal' });
    const item = addDress(itemInput);
    setCommandFailurePoint('database.reset:after-write');

    assert.throws(
      () => resetApplicationDataCommand('diagnosis-reset-atomicity'),
      /forced failure/,
    );
    assert.equal(getCustomers()[0]?.id, customer.id);
    assert.equal(getDresses()[0]?.id, item.id);
    assert.equal(readCollection('command-log', []).length, 0);
  } finally {
    cleanup();
  }
});
