import test from 'node:test';
import assert from 'node:assert/strict';
import { installStorage, uninstallStorage, futureDate, nowDateTimeLocal } from './helpers/storage.mjs';
import {
  REGISTERED_COLLECTIONS,
  exportDatabaseBackup,
  importDatabaseBackup,
  getMigrationMarker,
  markMigrationSuccess,
  readCollection,
  resetCountersForTesting,
  resetDatabase,
  resetMigrationMarkers,
  writeCollection,
} from '../src/engines/persistence/index.ts';
import { addCustomer } from '../src/features/customers/customer.service.ts';
import { addDress } from '../src/features/dresses/dress.service.ts';
import { createReservationCommand } from '../src/features/workflows/reservationCommands.ts';
import { completeDeliveryCommand, completeReturnCommand } from '../src/features/workflows/deliveryReturnCommands.ts';
import { attachAccessoryCommand } from '../src/features/workflows/accessoryCommands.ts';
import { addAccessory, getAccessories, getAccessoryByBarcode } from '../src/features/accessories/accessory.service.ts';
import { getAccessoriesForReservation } from '../src/features/accessories/reservationAccessory.service.ts';
import { DEFAULT_APP_PREFERENCES, getAppPreferences, saveAppPreferences } from '../src/features/preferences/preferences.service.ts';

function cleanup() {
  resetCountersForTesting();
  resetMigrationMarkers();
  uninstallStorage();
}

const dressInput = {
  name: 'فستان زفاف',
  description: '',
  itemType: 'dress',
  category: 'زفاف',
  color: 'أبيض',
  size: 'M',
  purchasePrice: 300,
  rentalPrice: 80,
  salePrice: 600,
  depositAmount: 50,
  status: 'available',
  isForRent: true,
  isForSale: true,
  images: [],
  barcode: '',
};

/** Builds a complete accessory story: catalogue, link, delivery, return and charge. */
function seedFullScenario() {
  saveAppPreferences({
    ...DEFAULT_APP_PREFERENCES,
    preparationDaysBeforePickup: 2,
    cleaningDaysAfterReturn: 3,
    defaultPickupTime: '09:30',
    defaultReturnTime: '21:15',
  });
  const customer = addCustomer({ name: 'سارة', phone: '90000003', status: 'normal' });
  const dress = addDress(dressInput);
  const reservation = createReservationCommand({
    customerId: customer.id,
    dressId: dress.id,
    pickupDate: futureDate(0),
    returnDate: futureDate(1),
    depositAmount: 50,
    idempotencyKey: 'rsv-backup',
  });
  const veil = addAccessory({ name: 'طرحة', category: 'veil', rentalPrice: 5, depositAmount: 10, notes: 'دانتيل' });
  const crown = addAccessory({ name: 'تاج', category: 'crown', rentalPrice: 8 });

  attachAccessoryCommand({ reservationNumber: reservation.reservationNumber, accessoryId: veil.id });
  attachAccessoryCommand({ reservationNumber: reservation.reservationNumber, accessoryId: crown.id });
  completeDeliveryCommand({
    reservationNumber: reservation.reservationNumber,
    deliveryDateTime: nowDateTimeLocal(),
    deliveredAccessoryIds: [veil.id, crown.id],
    idempotencyKey: 'deliver-backup',
  });
  completeReturnCommand({
    reservationNumber: reservation.reservationNumber,
    returnDateTime: nowDateTimeLocal(),
    lateFee: 0,
    damageFee: 0,
    refundMethod: 'cash',
    nextItemStatus: 'inspection',
    accessoryReturns: [{ accessoryId: veil.id, condition: 'damaged', chargeAmount: 9 }],
    idempotencyKey: 'return-backup',
  });

  return { reservation, veil, crown };
}

test('the accessory collections are registered so they can never be silently dropped', () => {
  assert.ok(REGISTERED_COLLECTIONS.includes('accessories'));
  assert.ok(REGISTERED_COLLECTIONS.includes('reservation-accessories'));
});

test('a full export/import round trip preserves accessories, links, handover state and charges', () => {
  installStorage();
  try {
    const { reservation, veil } = seedFullScenario();

    const before = exportDatabaseBackup();
    assert.equal(before.collections.accessories.length, 2);
    assert.equal(before.collections['reservation-accessories'].length, 2);

    resetDatabase();
    assert.equal(getAccessories().length, 0);

    importDatabaseBackup(before);

    const accessories = getAccessories();
    assert.equal(accessories.length, 2);
    const links = getAccessoriesForReservation(reservation.reservationNumber);
    assert.equal(links.length, 2);

    const veilLink = links.find((link) => link.accessoryId === veil.id);
    assert.ok(veilLink.deliveredAt, 'the delivery state must survive the restore');
    assert.ok(veilLink.returnedAt, 'the return state must survive the restore');
    assert.equal(veilLink.returnCondition, 'damaged');
    assert.equal(veilLink.chargeAmount, 9);

    // The damage charge lives in the shared expense ledger and comes back with it.
    assert.equal(readCollection('expenses', []).filter((expense) => expense.amount === 9).length, 1);
  } finally {
    cleanup();
  }
});

test('restoring does not duplicate accessories or break their codes and barcodes', () => {
  installStorage();
  try {
    seedFullScenario();
    const before = exportDatabaseBackup();
    const codesBefore = getAccessories().map((accessory) => accessory.code).sort();

    // Import twice: a repeated restore must replace, never append.
    importDatabaseBackup(before);
    importDatabaseBackup(before);

    const accessories = getAccessories();
    assert.equal(accessories.length, 2);
    assert.deepEqual(accessories.map((accessory) => accessory.code).sort(), codesBefore);
    accessories.forEach((accessory) => {
      assert.equal(accessory.barcode, accessory.code);
      assert.equal(getAccessoryByBarcode(accessory.barcode)?.id, accessory.id);
    });
    assert.equal(readCollection('reservation-accessories', []).length, 2);
  } finally {
    cleanup();
  }
});

test('the accessory code counter stays monotonic after a restore', () => {
  installStorage();
  try {
    addAccessory({ name: 'أول', category: 'veil' });
    const second = addAccessory({ name: 'ثانٍ', category: 'crown' });
    const backup = exportDatabaseBackup();

    resetDatabase();
    importDatabaseBackup(backup);

    // The allocator reconciles against the restored codes before handing out a new one.
    const next = addAccessory({ name: 'ثالث', category: 'belt' });
    assert.notEqual(next.code, second.code);
    assert.ok(next.code > second.code, `${next.code} must follow ${second.code}`);
    assert.equal(new Set(getAccessories().map((accessory) => accessory.code)).size, 3);
  } finally {
    cleanup();
  }
});

test('preparation, cleaning and default-time settings survive backup and restore', () => {
  installStorage();
  try {
    saveAppPreferences({
      ...DEFAULT_APP_PREFERENCES,
      preparationDaysBeforePickup: 4,
      cleaningDaysAfterReturn: 6,
      defaultPickupTime: '08:45',
      defaultReturnTime: '22:30',
    });
    const backup = exportDatabaseBackup();

    resetDatabase();
    assert.equal(getAppPreferences().preparationDaysBeforePickup, DEFAULT_APP_PREFERENCES.preparationDaysBeforePickup);

    importDatabaseBackup(backup);
    const restored = getAppPreferences();
    assert.equal(restored.preparationDaysBeforePickup, 4);
    assert.equal(restored.cleaningDaysAfterReturn, 6);
    assert.equal(restored.defaultPickupTime, '08:45');
    assert.equal(restored.defaultReturnTime, '22:30');
  } finally {
    cleanup();
  }
});

test('a legacy preferences record inherits the old single buffer for both windows', () => {
  installStorage();
  try {
    // An installation created before the split only stores `reservationBufferDays`.
    writeCollection('preferences', [{ showroomName: 'LENA', reservationBufferDays: 3, dormantDressDays: 90 }]);

    const preferences = getAppPreferences();
    assert.equal(preferences.preparationDaysBeforePickup, 3);
    assert.equal(preferences.cleaningDaysAfterReturn, 3);
    assert.equal(preferences.defaultPickupTime, DEFAULT_APP_PREFERENCES.defaultPickupTime);
  } finally {
    cleanup();
  }
});

test('migration markers still travel with a backup that contains accessories', () => {
  installStorage();
  try {
    seedFullScenario();
    markMigrationSuccess('stable-references-v1');

    const backup = exportDatabaseBackup();
    assert.equal('migration-markers' in backup.collections, false, 'markers are an object, not a collection');
    assert.ok(backup.migrationMarkers);

    importDatabaseBackup(backup);
    assert.equal(getMigrationMarker('stable-references-v1').status, 'completed');
    // Restoring must not re-run a completed migration over already-migrated data.
    assert.equal(getMigrationMarker('stable-references-v1').attemptCount, 1);
  } finally {
    cleanup();
  }
});

test('price snapshots and accessory cost attribution survive a restore', () => {
  installStorage();
  try {
    const { reservation, veil } = seedFullScenario();

    const before = exportDatabaseBackup();
    const storedReservation = before.collections.reservations.find(
      (item) => item.reservationNumber === reservation.reservationNumber,
    );
    // The list-price snapshot is what makes a discount provable after the fact.
    assert.equal(typeof storedReservation.listRentalPrice, 'number');

    const accessoryExpense = before.collections.expenses.find((expense) => expense.amount === 9);
    assert.ok(accessoryExpense, 'the accessory damage charge must be in the expense ledger');
    assert.equal(accessoryExpense.relatedAccessoryCode, before.collections.accessories.find((item) => item.id === veil.id).code);

    resetDatabase();
    importDatabaseBackup(before);

    const restoredReservation = readCollection('reservations', []).find(
      (item) => item.reservationNumber === reservation.reservationNumber,
    );
    assert.equal(restoredReservation.listRentalPrice, storedReservation.listRentalPrice);
    assert.equal(restoredReservation.rentalPrice, storedReservation.rentalPrice);

    const restoredExpense = readCollection('expenses', []).find((expense) => expense.amount === 9);
    assert.equal(restoredExpense.relatedAccessoryCode, accessoryExpense.relatedAccessoryCode);
  } finally {
    cleanup();
  }
});

test('a rejected backup leaves the live accessory data untouched', () => {
  installStorage();
  try {
    seedFullScenario();
    const liveAccessories = readCollection('accessories', []);
    const liveLinks = readCollection('reservation-accessories', []);

    const invalidBackups = [
      { applicationId: 'other-app', schemaVersion: 1, exportedAt: 'x', collections: {} },
      { applicationId: 'dress-roomshow', schemaVersion: 1, exportedAt: 'x', collections: { accessories: 'nope' } },
    ];

    for (const invalid of invalidBackups) {
      assert.throws(() => importDatabaseBackup(invalid));
      assert.deepEqual(readCollection('accessories', []), liveAccessories);
      assert.deepEqual(readCollection('reservation-accessories', []), liveLinks);
    }
  } finally {
    cleanup();
  }
});
