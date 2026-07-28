import test from 'node:test';
import assert from 'node:assert/strict';
import { installStorage, uninstallStorage, futureDate, nowDateTimeLocal } from './helpers/storage.mjs';
import {
  readCollection,
  resetCountersForTesting,
  writeCollection,
} from '../src/engines/persistence/index.ts';
import { setCommandFailurePoint, DuplicateCommandError } from '../src/engines/workflows/index.ts';
import { addCustomer } from '../src/features/customers/customer.service.ts';
import { addDress, getDresses } from '../src/features/dresses/dress.service.ts';
import { createReservationCommand } from '../src/features/workflows/reservationCommands.ts';
import { completeDeliveryCommand, completeReturnCommand } from '../src/features/workflows/deliveryReturnCommands.ts';
import {
  addAccessoryCommand,
  attachAccessoryCommand,
  detachAccessoryCommand,
  retireAccessoryCommand,
} from '../src/features/workflows/accessoryCommands.ts';
import {
  addAccessory,
  getAccessories,
  getAccessoryByBarcode,
  getAccessoryById,
  filterAccessories,
  summarizeAccessories,
} from '../src/features/accessories/accessory.service.ts';
import {
  getAccessoriesForReservation,
  getOutstandingAccessories,
  recordAccessoryReturn,
} from '../src/features/accessories/reservationAccessory.service.ts';
import { getReservations } from '../src/features/reservations/reservation.service.ts';
import { getExpenses } from '../src/features/expenses/expense.service.ts';
import { cancelReservationCommand } from '../src/features/workflows/reservationCommands.ts';
import { buildAccessoryLabelHtml } from '../src/features/accessories/printAccessoryLabel.ts';
import { deriveBarcodeFromCode, normalizeBarcodeValue } from '../src/shared/utils/barcode.ts';
import { DEFAULT_APP_PREFERENCES, saveAppPreferences } from '../src/features/preferences/preferences.service.ts';

function cleanup() {
  setCommandFailurePoint(null);
  resetCountersForTesting();
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

function seedRental() {
  saveAppPreferences({ ...DEFAULT_APP_PREFERENCES, preparationDaysBeforePickup: 0, cleaningDaysAfterReturn: 0 });
  const customer = addCustomer({ name: 'سارة', phone: '90000002', status: 'normal' });
  const dress = addDress(dressInput);
  const reservation = createReservationCommand({
    customerId: customer.id,
    dressId: dress.id,
    pickupDate: futureDate(0),
    returnDate: futureDate(2),
    depositAmount: 50,
    idempotencyKey: 'rsv-acc',
  });
  const veil = addAccessory({ name: 'طرحة طويلة', category: 'veil', rentalPrice: 5, depositAmount: 10 });
  const crown = addAccessory({ name: 'تاج لؤلؤ', category: 'crown', rentalPrice: 8 });
  return { customer, dress, reservation, veil, crown };
}

test('an accessory gets a monotonic stock code and a barcode derived from it', () => {
  installStorage();
  try {
    const first = addAccessory({ name: 'طرحة', category: 'veil' });
    const second = addAccessory({ name: 'حزام', category: 'belt' });

    assert.equal(first.barcode, deriveBarcodeFromCode(first.code));
    assert.equal(second.barcode, deriveBarcodeFromCode(second.code));
    assert.notEqual(first.code, second.code);
    assert.match(first.code, /^ACC-\d{3}$/);
  } finally {
    cleanup();
  }
});

test('retired accessory codes are never handed out again', () => {
  installStorage();
  try {
    const first = addAccessory({ name: 'قفازات', category: 'gloves' });
    retireAccessoryCommand(first.id);
    const second = addAccessory({ name: 'قفازات بديلة', category: 'gloves' });

    assert.notEqual(second.code, first.code);
    assert.equal(getAccessoryById(first.id).status, 'retired');
  } finally {
    cleanup();
  }
});

test('an accessory is found by barcode and by stock code, with normalisation', () => {
  installStorage();
  try {
    const accessory = addAccessory({ name: 'حقيبة سهرة', category: 'bag' });

    assert.equal(getAccessoryByBarcode(accessory.barcode)?.id, accessory.id);
    assert.equal(getAccessoryByBarcode(accessory.code)?.id, accessory.id);
    assert.equal(getAccessoryByBarcode(` ${accessory.code.toLowerCase()} `)?.id, accessory.id);
    assert.equal(getAccessoryByBarcode('ACC-999'), undefined);
    assert.equal(normalizeBarcodeValue(' acc-001 '), 'ACC-001');
  } finally {
    cleanup();
  }
});

test('the accessory label escapes every printed value', () => {
  installStorage();
  try {
    const html = buildAccessoryLabelHtml({
      accessory: { code: 'ACC-001', name: '<script>alert(1)</script>', barcode: 'ACC-001', category: 'veil' },
      svgMarkup: '<svg></svg>',
    });

    assert.ok(html.includes('&lt;script&gt;'));
    assert.equal(html.includes('<script>alert(1)</script>'), false);
    assert.ok(html.includes('ACC-001'));
  } finally {
    cleanup();
  }
});

test('accessory filters and summary describe the working set', () => {
  installStorage();
  try {
    const veil = addAccessory({ name: 'طرحة قصيرة', category: 'veil' });
    addAccessory({ name: 'تاج', category: 'crown', status: 'damaged' });

    const accessories = getAccessories();
    assert.equal(filterAccessories(accessories, { search: veil.code, category: 'all', status: 'all' }).length, 1);
    assert.equal(filterAccessories(accessories, { search: '', category: 'crown', status: 'all' }).length, 1);
    assert.equal(filterAccessories(accessories, { search: '', category: 'all', status: 'damaged' }).length, 1);

    const summary = summarizeAccessories(accessories);
    assert.equal(summary.total, 2);
    assert.equal(summary.available, 1);
    assert.equal(summary.unavailable, 1);
  } finally {
    cleanup();
  }
});

test('a dress and its accessories are delivered inside one command', () => {
  installStorage();
  try {
    const { reservation, veil, crown } = seedRental();
    attachAccessoryCommand({ reservationNumber: reservation.reservationNumber, accessoryId: veil.id });
    attachAccessoryCommand({ reservationNumber: reservation.reservationNumber, accessoryId: crown.id });

    completeDeliveryCommand({
      reservationNumber: reservation.reservationNumber,
      deliveryDateTime: nowDateTimeLocal(),
      deliveredAccessoryIds: [veil.id, crown.id],
      idempotencyKey: 'deliver-1',
    });

    const links = getAccessoriesForReservation(reservation.reservationNumber);
    assert.equal(links.length, 2);
    assert.ok(links.every((link) => link.deliveredAt));
    assert.equal(getAccessoryById(veil.id).status, 'delivered');
    assert.equal(getDresses().find((item) => item.code === reservation.dressCode).status, 'rented');
  } finally {
    cleanup();
  }
});

test('only the accessories actually handed over are recorded as delivered', () => {
  installStorage();
  try {
    const { reservation, veil, crown } = seedRental();
    attachAccessoryCommand({ reservationNumber: reservation.reservationNumber, accessoryId: veil.id });
    attachAccessoryCommand({ reservationNumber: reservation.reservationNumber, accessoryId: crown.id });

    completeDeliveryCommand({
      reservationNumber: reservation.reservationNumber,
      deliveryDateTime: nowDateTimeLocal(),
      deliveredAccessoryIds: [veil.id],
      idempotencyKey: 'deliver-partial',
    });

    const links = getAccessoriesForReservation(reservation.reservationNumber);
    assert.ok(links.find((link) => link.accessoryId === veil.id).deliveredAt);
    assert.equal(links.find((link) => link.accessoryId === crown.id).deliveredAt, undefined);
    assert.equal(getAccessoryById(crown.id).status, 'reserved');
  } finally {
    cleanup();
  }
});

test('a partial accessory return leaves the rest outstanding', () => {
  installStorage();
  try {
    const { reservation, veil, crown } = seedRental();
    attachAccessoryCommand({ reservationNumber: reservation.reservationNumber, accessoryId: veil.id });
    attachAccessoryCommand({ reservationNumber: reservation.reservationNumber, accessoryId: crown.id });
    completeDeliveryCommand({
      reservationNumber: reservation.reservationNumber,
      deliveryDateTime: nowDateTimeLocal(),
      deliveredAccessoryIds: [veil.id, crown.id],
      idempotencyKey: 'deliver-2',
    });

    completeReturnCommand({
      reservationNumber: reservation.reservationNumber,
      returnDateTime: nowDateTimeLocal(),
      lateFee: 0,
      damageFee: 0,
      refundMethod: 'cash',
      nextItemStatus: 'inspection',
      accessoryReturns: [{ accessoryId: veil.id, condition: 'intact' }],
      idempotencyKey: 'return-partial',
    });

    const outstanding = getOutstandingAccessories(reservation.reservationNumber);
    assert.equal(outstanding.length, 1);
    assert.equal(outstanding[0].accessoryId, crown.id);
    assert.equal(getAccessoryById(veil.id).status, 'service');
    assert.equal(getAccessoryById(crown.id).status, 'delivered');
  } finally {
    cleanup();
  }
});

test('a lost accessory is marked lost and its cost posts through the existing finance path', () => {
  installStorage();
  try {
    const { reservation, veil } = seedRental();
    attachAccessoryCommand({ reservationNumber: reservation.reservationNumber, accessoryId: veil.id });
    completeDeliveryCommand({
      reservationNumber: reservation.reservationNumber,
      deliveryDateTime: nowDateTimeLocal(),
      deliveredAccessoryIds: [veil.id],
      idempotencyKey: 'deliver-lost',
    });

    const expensesBefore = getExpenses().length;
    completeReturnCommand({
      reservationNumber: reservation.reservationNumber,
      returnDateTime: nowDateTimeLocal(),
      lateFee: 0,
      damageFee: 0,
      refundMethod: 'cash',
      nextItemStatus: 'inspection',
      accessoryReturns: [{ accessoryId: veil.id, condition: 'lost', chargeAmount: 12 }],
      idempotencyKey: 'return-lost',
    });

    assert.equal(getAccessoryById(veil.id).status, 'lost');
    const expenses = getExpenses();
    assert.equal(expenses.length, expensesBefore + 1);
    assert.equal(expenses[0].amount, 12);
    // The charge lands in the existing expense ledger, not a parallel one.
    assert.equal(readCollection('accessory-charges', []).length, 0);

    const link = getAccessoriesForReservation(reservation.reservationNumber)[0];
    assert.equal(link.returnCondition, 'lost');
    assert.equal(link.chargeAmount, 12);
  } finally {
    cleanup();
  }
});

test('a damaged accessory is marked damaged and charged', () => {
  installStorage();
  try {
    const { reservation, crown } = seedRental();
    attachAccessoryCommand({ reservationNumber: reservation.reservationNumber, accessoryId: crown.id });
    completeDeliveryCommand({
      reservationNumber: reservation.reservationNumber,
      deliveryDateTime: nowDateTimeLocal(),
      deliveredAccessoryIds: [crown.id],
      idempotencyKey: 'deliver-damaged',
    });

    completeReturnCommand({
      reservationNumber: reservation.reservationNumber,
      returnDateTime: nowDateTimeLocal(),
      lateFee: 0,
      damageFee: 0,
      refundMethod: 'cash',
      nextItemStatus: 'inspection',
      accessoryReturns: [{ accessoryId: crown.id, condition: 'damaged', chargeAmount: 7.5 }],
      idempotencyKey: 'return-damaged',
    });

    assert.equal(getAccessoryById(crown.id).status, 'damaged');
    assert.equal(getExpenses()[0].amount, 7.5);
  } finally {
    cleanup();
  }
});

test('a forced failure during delivery rolls back the accessory handover completely', () => {
  installStorage();
  try {
    const { reservation, veil } = seedRental();
    attachAccessoryCommand({ reservationNumber: reservation.reservationNumber, accessoryId: veil.id });
    const statusBefore = getAccessoryById(veil.id).status;

    setCommandFailurePoint('delivery.complete:after-write');
    assert.throws(
      () => completeDeliveryCommand({
        reservationNumber: reservation.reservationNumber,
        deliveryDateTime: nowDateTimeLocal(),
        deliveredAccessoryIds: [veil.id],
        idempotencyKey: 'deliver-fail',
      }),
      /forced failure/,
    );

    assert.equal(getAccessoryById(veil.id).status, statusBefore);
    assert.equal(getAccessoriesForReservation(reservation.reservationNumber)[0].deliveredAt, undefined);
    assert.equal(getReservations().find((item) => item.reservationNumber === reservation.reservationNumber).status, 'confirmed');
    assert.equal(readCollection('delivery-return', []).length, 0);
  } finally {
    cleanup();
  }
});

test('a forced failure during return rolls back conditions, charges and money', () => {
  installStorage();
  try {
    const { reservation, veil } = seedRental();
    attachAccessoryCommand({ reservationNumber: reservation.reservationNumber, accessoryId: veil.id });
    completeDeliveryCommand({
      reservationNumber: reservation.reservationNumber,
      deliveryDateTime: nowDateTimeLocal(),
      deliveredAccessoryIds: [veil.id],
      idempotencyKey: 'deliver-rollback',
    });
    const expensesBefore = getExpenses().length;
    const paymentsBefore = readCollection('payments', []).length;

    setCommandFailurePoint('return.complete:after-write');
    assert.throws(
      () => completeReturnCommand({
        reservationNumber: reservation.reservationNumber,
        returnDateTime: nowDateTimeLocal(),
        lateFee: 0,
        damageFee: 0,
        refundMethod: 'cash',
        nextItemStatus: 'inspection',
        accessoryReturns: [{ accessoryId: veil.id, condition: 'damaged', chargeAmount: 20 }],
        idempotencyKey: 'return-fail',
      }),
      /forced failure/,
    );

    const link = getAccessoriesForReservation(reservation.reservationNumber)[0];
    assert.equal(link.returnedAt, undefined);
    assert.equal(link.chargeAmount, undefined);
    assert.equal(getAccessoryById(veil.id).status, 'delivered');
    assert.equal(getExpenses().length, expensesBefore, 'no damage charge may survive a failed return');
    assert.equal(readCollection('payments', []).length, paymentsBefore);
  } finally {
    cleanup();
  }
});

test('repeating the same delivery command does not deliver the accessory twice', () => {
  installStorage();
  try {
    const { reservation, veil } = seedRental();
    attachAccessoryCommand({ reservationNumber: reservation.reservationNumber, accessoryId: veil.id });
    const input = {
      reservationNumber: reservation.reservationNumber,
      deliveryDateTime: nowDateTimeLocal(),
      deliveredAccessoryIds: [veil.id],
      idempotencyKey: 'deliver-once',
    };

    completeDeliveryCommand(input);
    assert.throws(() => completeDeliveryCommand(input), DuplicateCommandError);

    assert.equal(getAccessoriesForReservation(reservation.reservationNumber).length, 1);
    assert.equal(readCollection('delivery-return', []).length, 1);
  } finally {
    cleanup();
  }
});

test('an already-returned accessory can never be closed or charged twice', () => {
  installStorage();
  try {
    const { reservation, veil, crown } = seedRental();
    attachAccessoryCommand({ reservationNumber: reservation.reservationNumber, accessoryId: veil.id });
    attachAccessoryCommand({ reservationNumber: reservation.reservationNumber, accessoryId: crown.id });
    completeDeliveryCommand({
      reservationNumber: reservation.reservationNumber,
      deliveryDateTime: nowDateTimeLocal(),
      deliveredAccessoryIds: [veil.id, crown.id],
      idempotencyKey: 'deliver-idem',
    });
    // Partial return: the veil is closed, the crown stays out.
    completeReturnCommand({
      reservationNumber: reservation.reservationNumber,
      returnDateTime: nowDateTimeLocal(),
      lateFee: 0,
      damageFee: 0,
      refundMethod: 'cash',
      nextItemStatus: 'inspection',
      accessoryReturns: [{ accessoryId: veil.id, condition: 'damaged', chargeAmount: 5 }],
      idempotencyKey: 'return-idem-1',
    });

    // The reservation guard stops a second return command outright...
    assert.throws(
      () => completeReturnCommand({
        reservationNumber: reservation.reservationNumber,
        returnDateTime: nowDateTimeLocal(),
        lateFee: 0,
        damageFee: 0,
        refundMethod: 'cash',
        nextItemStatus: 'inspection',
        accessoryReturns: [{ accessoryId: veil.id, condition: 'damaged', chargeAmount: 5 }],
        idempotencyKey: 'return-idem-2',
      }),
      /غير مؤهل للاسترجاع/,
    );

    // ...and the accessory rule itself refuses a repeated close, so no future
    // caller can charge the same damage twice.
    assert.throws(
      () => recordAccessoryReturn({
        reservationNumber: reservation.reservationNumber,
        entries: [{ accessoryId: veil.id, condition: 'damaged', chargeAmount: 5 }],
        returnedAt: nowDateTimeLocal(),
      }),
      /تم تسجيل استرجاع الملحق/,
    );

    assert.equal(getExpenses().filter((expense) => expense.amount === 5).length, 1);
  } finally {
    cleanup();
  }
});

test('a duplicate accessory create submit does not create two accessories', () => {
  installStorage();
  try {
    const input = { name: 'حزام لؤلؤ', category: 'belt', idempotencyKey: 'acc-once' };
    addAccessoryCommand(input);
    assert.throws(() => addAccessoryCommand(input), DuplicateCommandError);
    assert.equal(getAccessories().length, 1);
  } finally {
    cleanup();
  }
});

test('detaching an undelivered accessory frees it, a delivered one is protected', () => {
  installStorage();
  try {
    const { reservation, veil, crown } = seedRental();
    attachAccessoryCommand({ reservationNumber: reservation.reservationNumber, accessoryId: veil.id });
    attachAccessoryCommand({ reservationNumber: reservation.reservationNumber, accessoryId: crown.id });
    completeDeliveryCommand({
      reservationNumber: reservation.reservationNumber,
      deliveryDateTime: nowDateTimeLocal(),
      deliveredAccessoryIds: [crown.id],
      idempotencyKey: 'deliver-detach',
    });

    detachAccessoryCommand(reservation.reservationNumber, veil.id);
    assert.equal(getAccessoryById(veil.id).status, 'available');

    assert.throws(
      () => detachAccessoryCommand(reservation.reservationNumber, crown.id),
      /لا يمكن إزالة ملحق مسلَّم/,
    );
  } finally {
    cleanup();
  }
});

test('cancelling a reservation releases its undelivered accessories', async () => {
  installStorage();
  try {
    const { reservation, veil } = seedRental();
    attachAccessoryCommand({ reservationNumber: reservation.reservationNumber, accessoryId: veil.id });
    assert.equal(getAccessoryById(veil.id).status, 'reserved');

    writeCollection('reservations', getReservations().map((item) => (
      item.reservationNumber === reservation.reservationNumber ? { ...item, status: 'pending', paidAmount: 0 } : item
    )));
    cancelReservationCommand(getReservations()[0].id);

    assert.equal(getAccessoryById(veil.id).status, 'available');
  } finally {
    cleanup();
  }
});
