import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isCommandAlreadyExecuted,
  setCommandFailurePoint,
} from '../src/engines/workflows/index.ts';
import {
  readCollection,
  resetCountersForTesting,
} from '../src/engines/persistence/index.ts';
import { addCustomer } from '../src/features/customers/customer.service.ts';
import { addDress, getDresses } from '../src/features/dresses/dress.service.ts';
import {
  getSaleInvoices,
  getSaleReturns,
} from '../src/features/dresses/salesLedger.service.ts';
import { getSales } from '../src/features/dresses/sale.service.ts';
import { getReservations } from '../src/features/reservations/reservation.service.ts';
import { createReservationCommand } from '../src/features/workflows/reservationCommands.ts';
import { completeDeliveryCommand } from '../src/features/workflows/deliveryReturnCommands.ts';
import {
  quickSaleCommand,
  recordSaleReturnCommand,
} from '../src/features/workflows/salesCommands.ts';
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
  resetCountersForTesting();
  delete globalThis.window;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function futureDate(days) {
  return addDaysISO(getTodayISO(), days);
}

const rentableDressInput = {
  name: 'فستان تسليم اختباري',
  description: '',
  itemType: 'dress',
  category: 'سهرة',
  color: 'كحلي',
  size: 'M',
  purchasePrice: 100,
  rentalPrice: 40,
  salePrice: 180,
  depositAmount: 50,
  status: 'available',
  isForRent: true,
  isForSale: false,
  images: [],
  barcode: '',
};

const saleableDressInput = {
  ...rentableDressInput,
  name: 'فستان مرتجع بيع اختباري',
  rentalPrice: 0,
  isForRent: false,
  isForSale: true,
};

function auditSnapshot() {
  return {
    auditLog: clone(readCollection('audit-log', [])),
    audit: clone(readCollection('audit', [])),
  };
}

test('forced failure after delivery writes restores item, reservation, delivery record, audit and retryability', () => {
  installStorage();
  try {
    const customer = addCustomer({ name: 'مريم', phone: '90000001', status: 'normal' });
    const dress = addDress(rentableDressInput);
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: getTodayISO(),
      returnDate: futureDate(2),
      depositAmount: 50,
      idempotencyKey: 'phase-2-07-reservation',
    });

    const reservationBefore = clone(getReservations());
    const dressesBefore = clone(getDresses());
    const deliveryBefore = clone(readCollection('delivery-return', []));
    const auditBefore = auditSnapshot();

    setCommandFailurePoint('delivery.complete:after-write');
    assert.throws(
      () => completeDeliveryCommand({
        paymentOverrideReason: 'تجاوز سداد مخصص لسيناريو الاختبار',
        reservationNumber: reservation.reservationNumber,
        deliveryDateTime: new Date().toISOString(),
        idempotencyKey: 'phase-2-07-delivery-fail',
      }),
      /forced failure/,
    );

    assert.deepEqual(getReservations(), reservationBefore);
    assert.deepEqual(getDresses(), dressesBefore);
    assert.deepEqual(readCollection('delivery-return', []), deliveryBefore);
    assert.deepEqual(auditSnapshot(), auditBefore);
    assert.equal(isCommandAlreadyExecuted('delivery.complete', 'phase-2-07-delivery-fail'), false);
  } finally {
    cleanup();
  }
});

test('forced failure after sale-return writes restores sold state, invoice, ledgers, audit and retryability', () => {
  installStorage();
  try {
    const dress = addDress(saleableDressInput);
    const today = getTodayISO();
    const invoice = quickSaleCommand({
      saleDate: today,
      customerName: 'مريم',
      paymentMethod: 'cash',
      dressCode: dress.code,
      amount: 180,
      idempotencyKey: 'phase-2-07-sale',
    });

    const invoicesBefore = clone(getSaleInvoices());
    const salesBefore = clone(getSales());
    const dressesBefore = clone(getDresses());
    const auditBefore = auditSnapshot();

    setCommandFailurePoint('sale.return-line:after-write');
    assert.throws(
      () => recordSaleReturnCommand({
        invoiceNumber: invoice.invoiceNumber,
        dressCode: dress.code,
        returnDate: today,
        idempotencyKey: 'phase-2-07-sale-return-fail',
      }),
      /forced failure/,
    );

    assert.deepEqual(getSaleReturns(), []);
    assert.deepEqual(getSaleInvoices(), invoicesBefore);
    assert.deepEqual(getSales(), salesBefore);
    assert.deepEqual(getDresses(), dressesBefore);
    assert.deepEqual(auditSnapshot(), auditBefore);
    assert.equal(getDresses().find((item) => item.code === dress.code)?.status, 'sold');
    assert.equal(isCommandAlreadyExecuted('sale.return-line', 'phase-2-07-sale-return-fail'), false);
  } finally {
    cleanup();
  }
});
