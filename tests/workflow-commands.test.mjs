import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runCommand,
  setCommandFailurePoint,
  isCommandAlreadyExecuted,
  getCommandLog,
  DuplicateCommandError,
} from '../src/engines/workflows/index.ts';
import { createReservationCommand } from '../src/features/workflows/reservationCommands.ts';
import { recordPaymentCommand } from '../src/features/workflows/paymentCommands.ts';
import { completeDeliveryCommand, completeReturnCommand } from '../src/features/workflows/deliveryReturnCommands.ts';
import { readCollection, writeCollection, getCollectionKey } from '../src/engines/persistence/index.ts';
import { addCustomer } from '../src/features/customers/customer.service.ts';
import { addDress } from '../src/features/dresses/dress.service.ts';
import { getDresses } from '../src/features/dresses/dress.service.ts';
import { getReservations } from '../src/features/reservations/reservation.service.ts';
import { getPayments } from '../src/features/payments/payment.service.ts';
import { addDaysISO, getTodayISO } from '../src/shared/utils/date.ts';

function installStorage() {
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
      clear() {
        store.clear();
      },
    },
  };
  return store;
}

function cleanup() {
  setCommandFailurePoint(null);
  delete globalThis.window;
}

function futureDate(days) {
  return addDaysISO(getTodayISO(), days);
}

const dressInput = {
  name: 'فستان سهرة',
  description: '',
  itemType: 'dress',
  category: 'سهرة',
  color: 'أزرق',
  size: 'M',
  purchasePrice: 100,
  rentalPrice: 40,
  salePrice: 200,
  depositAmount: 50,
  status: 'available',
  isForRent: true,
  isForSale: true,
  images: [],
  barcode: '',
};

function seedScenario() {
  const customer = addCustomer({ name: 'مريم', phone: '90000001', status: 'normal' });
  const dress = addDress(dressInput);
  return { customer, dress };
}

test('runCommand rolls back every write when the command fails', () => {
  installStorage();
  try {
    writeCollection('customers', [{ id: 'cus-1', name: 'قبل' }]);
    assert.throws(
      () => runCommand({ name: 'test.command', idempotencyKey: 'k1' }, () => {
        writeCollection('customers', [{ id: 'cus-1', name: 'قبل' }, { id: 'cus-2', name: 'بعد' }]);
        throw new Error('boom');
      }),
      /boom/,
    );
    assert.deepEqual(readCollection('customers', []), [{ id: 'cus-1', name: 'قبل' }]);
    // The command log must not record a rolled back command.
    assert.equal(isCommandAlreadyExecuted('test.command', 'k1'), false);
  } finally {
    cleanup();
  }
});

test('runCommand blocks a duplicate submit with the same idempotency key', () => {
  installStorage();
  try {
    runCommand({ name: 'test.command', idempotencyKey: 'same' }, () => writeCollection('customers', [{ id: 'a' }]));
    assert.throws(
      () => runCommand({ name: 'test.command', idempotencyKey: 'same' }, () => writeCollection('customers', [{ id: 'a' }, { id: 'b' }])),
      DuplicateCommandError,
    );
    assert.equal(readCollection('customers', []).length, 1);
    assert.equal(getCommandLog().length, 1);
  } finally {
    cleanup();
  }
});

test('reservation command writes reservation and audit atomically', () => {
  installStorage();
  try {
    const { customer, dress } = seedScenario();
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: futureDate(3),
      returnDate: futureDate(5),
      depositAmount: 50,
      idempotencyKey: 'rsv-1',
    });

    assert.equal(reservation.customerId, customer.id);
    assert.equal(reservation.inventoryItemId, dress.id);
    assert.equal(getReservations().length, 1);
    assert.ok(readCollection('audit-log', []).length + readCollection('audit', []).length > 0);
  } finally {
    cleanup();
  }
});

test('forced failure after the reservation write leaves no reservation and no audit', () => {
  installStorage();
  try {
    const { customer, dress } = seedScenario();
    const auditBefore = readCollection('audit-log', []).length + readCollection('audit', []).length;

    setCommandFailurePoint('reservation.create:after-write');
    assert.throws(
      () => createReservationCommand({
        customerId: customer.id,
        dressId: dress.id,
        pickupDate: futureDate(3),
        returnDate: futureDate(5),
        depositAmount: 50,
        idempotencyKey: 'rsv-fail',
      }),
      /forced failure/,
    );

    assert.equal(getReservations().length, 0);
    assert.equal(readCollection('audit-log', []).length + readCollection('audit', []).length, auditBefore);
    // The failed command can be retried with the same key.
    assert.equal(isCommandAlreadyExecuted('reservation.create', 'rsv-fail'), false);
  } finally {
    cleanup();
  }
});

test('a duplicate reservation submit does not create a second reservation', () => {
  installStorage();
  try {
    const { customer, dress } = seedScenario();
    const input = {
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: futureDate(3),
      returnDate: futureDate(5),
      depositAmount: 50,
      idempotencyKey: 'double-click',
    };
    createReservationCommand(input);
    assert.throws(() => createReservationCommand(input), DuplicateCommandError);
    assert.equal(getReservations().length, 1);
  } finally {
    cleanup();
  }
});

test('forced failure after the payment write restores the ledger and the reservation balance', () => {
  installStorage();
  try {
    const { customer, dress } = seedScenario();
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: futureDate(2),
      returnDate: futureDate(4),
      depositAmount: 50,
      idempotencyKey: 'rsv-pay',
    });
    const balanceBefore = getReservations()[0].remainingAmount;

    setCommandFailurePoint('payment.record:after-write');
    assert.throws(
      () => recordPaymentCommand({
        reservationNumber: reservation.reservationNumber,
        paymentDate: getTodayISO(),
        type: 'rental_payment',
        method: 'cash',
        amount: 40,
        idempotencyKey: 'pay-fail',
      }),
      /forced failure/,
    );

    assert.equal(getPayments().length, 0, 'no money movement may survive a failed payment');
    assert.equal(getReservations()[0].remainingAmount, balanceBefore, 'the reservation balance must be untouched');
  } finally {
    cleanup();
  }
});

test('a duplicate payment submit does not collect the money twice', () => {
  installStorage();
  try {
    const { customer, dress } = seedScenario();
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: futureDate(2),
      returnDate: futureDate(4),
      depositAmount: 50,
      idempotencyKey: 'rsv-dbl-pay',
    });
    const input = {
      reservationNumber: reservation.reservationNumber,
      paymentDate: getTodayISO(),
      type: 'rental_payment',
      method: 'cash',
      amount: 40,
      idempotencyKey: 'pay-once',
    };

    recordPaymentCommand(input);
    assert.throws(() => recordPaymentCommand(input), DuplicateCommandError);
    assert.equal(getPayments().length, 1);
    assert.equal(getPayments()[0].amount, 40);
  } finally {
    cleanup();
  }
});

test('a returned item never becomes available directly', () => {
  installStorage();
  try {
    assert.throws(
      () => completeReturnCommand({
        reservationNumber: 'RSV-X',
        returnDateTime: new Date().toISOString(),
        lateFee: 0,
        damageFee: 0,
        refundMethod: 'cash',
        nextItemStatus: 'available',
      }),
      /الفحص/,
    );
  } finally {
    cleanup();
  }
});

test('delivery and return keep the item, reservation, ledger and audit consistent', () => {
  const store = installStorage();
  try {
    const { customer, dress } = seedScenario();
    const today = getTodayISO();
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: futureDate(2),
      depositAmount: 50,
      idempotencyKey: 'rsv-flow',
    });
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'security_deposit_collection',
      method: 'cash',
      amount: 50,
      idempotencyKey: 'pay-flow',
    });

    completeDeliveryCommand({
      paymentOverrideReason: 'تجاوز سداد مخصص لسيناريو الاختبار',
      reservationNumber: reservation.reservationNumber,
      deliveryDateTime: new Date().toISOString(),
      idempotencyKey: 'del-flow',
    });
    assert.equal(getDresses().find((item) => item.code === dress.code).status, 'rented');
    assert.equal(getReservations()[0].status, 'delivered');

    completeReturnCommand({
      reservationNumber: reservation.reservationNumber,
      returnDateTime: new Date().toISOString(),
      lateFee: 0,
      damageFee: 0,
      refundMethod: 'cash',
      nextItemStatus: 'inspection',
      idempotencyKey: 'ret-flow',
    });

    assert.equal(getDresses().find((item) => item.code === dress.code).status, 'inspection');
    assert.equal(getReservations()[0].status, 'returned');
    assert.ok(store.has(getCollectionKey('payments')));
  } finally {
    cleanup();
  }
});

test('forced failure during return keeps the item rented and the settlement unposted', () => {
  installStorage();
  try {
    const { customer, dress } = seedScenario();
    const today = getTodayISO();
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: futureDate(2),
      depositAmount: 50,
      idempotencyKey: 'rsv-rollback',
    });
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'security_deposit_collection',
      method: 'cash',
      amount: 50,
      idempotencyKey: 'pay-rollback',
    });
    completeDeliveryCommand({
      paymentOverrideReason: 'تجاوز سداد مخصص لسيناريو الاختبار',
      reservationNumber: reservation.reservationNumber,
      deliveryDateTime: new Date().toISOString(),
      idempotencyKey: 'del-rollback',
    });

    const paymentsBefore = getPayments().length;

    setCommandFailurePoint('return.complete:after-write');
    assert.throws(
      () => completeReturnCommand({
        reservationNumber: reservation.reservationNumber,
        returnDateTime: new Date().toISOString(),
        lateFee: 10,
        damageFee: 0,
        refundMethod: 'cash',
        nextItemStatus: 'inspection',
        idempotencyKey: 'ret-rollback',
      }),
      /forced failure/,
    );

    assert.equal(getPayments().length, paymentsBefore, 'no settlement movement may survive rollback');
    assert.equal(getDresses().find((item) => item.code === dress.code).status, 'rented');
    assert.equal(getReservations()[0].status, 'delivered');
  } finally {
    cleanup();
  }
});
