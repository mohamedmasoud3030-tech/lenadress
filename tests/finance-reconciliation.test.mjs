import test from 'node:test';
import assert from 'node:assert/strict';
import { setCommandFailurePoint } from '../src/engines/workflows/index.ts';
import { createReservationCommand } from '../src/features/workflows/reservationCommands.ts';
import { recordPaymentCommand } from '../src/features/workflows/paymentCommands.ts';
import { completeDeliveryCommand, completeReturnCommand } from '../src/features/workflows/deliveryReturnCommands.ts';
import { quickSaleCommand, recordSaleReturnCommand } from '../src/features/workflows/salesCommands.ts';
import { postExpenseCommand } from '../src/features/workflows/expenseCommands.ts';
import { getFinanceTotals, getItemFinance, getOutstandingRentalBalances } from '../src/features/finance/finance.service.ts';
import { getFinancialSummary, getDressPerformance, calculateDayClose } from '../src/features/reports/report.service.ts';
import { addCustomer } from '../src/features/customers/customer.service.ts';
import { addDress } from '../src/features/dresses/dress.service.ts';
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

const today = getTodayISO();

function futureDate(days) {
  return addDaysISO(today, days);
}

const rentalItem = {
  name: 'فستان إيجار',
  description: '',
  itemType: 'dress',
  category: 'سهرة',
  color: 'أحمر',
  size: 'M',
  purchasePrice: 100,
  rentalPrice: 40,
  salePrice: 0,
  depositAmount: 50,
  status: 'available',
  isForRent: true,
  isForSale: false,
  images: [],
  barcode: '',
};

const saleItem = { ...rentalItem, name: 'فستان بيع', isForRent: false, isForSale: true, salePrice: 200 };

test('a collected refundable deposit is a liability, never revenue', () => {
  installStorage();
  try {
    const customer = addCustomer({ name: 'مريم', phone: '90000001', status: 'normal' });
    const dress = addDress(rentalItem);
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: futureDate(2),
      depositAmount: 50,
      idempotencyKey: 'r1',
    });
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'deposit',
      method: 'cash',
      amount: 50,
      idempotencyKey: 'p-dep',
    });

    const totals = getFinanceTotals();
    assert.equal(totals.grossCollected, 50, 'the deposit is cash in');
    assert.equal(totals.depositLiabilityCollected, 50, 'and it is owed back to the customer');
    assert.equal(totals.rentalRevenue, 0, 'a deposit is never rental revenue');
    assert.equal(totals.recognisedIncome, 0, 'nothing is recognised as income yet');
  } finally {
    cleanup();
  }
});

test('a retained deposit becomes income while the refunded part clears the liability', () => {
  installStorage();
  try {
    const customer = addCustomer({ name: 'مريم', phone: '90000001', status: 'normal' });
    const dress = addDress(rentalItem);
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: futureDate(1),
      depositAmount: 50,
      idempotencyKey: 'r2',
    });
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'rental',
      method: 'cash',
      amount: 40,
      idempotencyKey: 'p-rent',
    });
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'deposit',
      method: 'cash',
      amount: 50,
      idempotencyKey: 'p-dep2',
    });
    completeDeliveryCommand({
      paymentOverrideReason: 'تجاوز سداد مخصص لسيناريو الاختبار',
      reservationNumber: reservation.reservationNumber,
      deliveryDateTime: new Date().toISOString(),
      idempotencyKey: 'd1',
    });
    completeReturnCommand({
      reservationNumber: reservation.reservationNumber,
      returnDateTime: new Date().toISOString(),
      lateFee: 10,
      damageFee: 0,
      refundMethod: 'cash',
      nextItemStatus: 'inspection',
      idempotencyKey: 'rt1',
    });

    const totals = getFinanceTotals();
    assert.equal(totals.rentalRevenue, 40);
    assert.equal(totals.depositRetained, 10, 'the retained part covers the late fee');
    assert.equal(totals.depositLiabilityCollected, 0, 'the refund and retention settle the whole deposit liability');
    // Recognised income = rental + assessed fee. The retained amount funds that
    // fee and must not be counted a second time.
    assert.equal(totals.recognisedIncome, 50);
    assert.ok(totals.recognisedIncome < totals.grossCollected, 'collected cash is not profit');
  } finally {
    cleanup();
  }
});

test('item profitability ignores the listed price of an unfulfilled booking', () => {
  installStorage();
  try {
    const customer = addCustomer({ name: 'سارة', phone: '90000002', status: 'normal' });
    const dress = addDress(rentalItem);
    createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: futureDate(5),
      returnDate: futureDate(7),
      depositAmount: 50,
      idempotencyKey: 'r3',
    });

    // Nothing has been collected: the item earned nothing, despite the 40 listed price.
    assert.equal(getItemFinance(dress.code).rentalRevenue, 0);
    const performance = getDressPerformance().find((row) => row.code === dress.code);
    assert.equal(performance.rentalRevenue, 0);
    assert.equal(performance.totalRevenue, 0);
  } finally {
    cleanup();
  }
});

test('item profitability includes item-linked expenses and nets sale returns', () => {
  installStorage();
  try {
    const dress = addDress(saleItem);
    quickSaleCommand({
      saleDate: today,
      customerName: 'هند',
      paymentMethod: 'cash',
      dressCode: dress.code,
      amount: 200,
      idempotencyKey: 's1',
    });
    postExpenseCommand({
      expenseDate: today,
      title: 'غسيل',
      category: 'laundry',
      amount: 15,
      paymentMethod: 'cash',
      relatedDressCode: dress.code,
      idempotencyKey: 'e1',
    });

    let finance = getItemFinance(dress.code);
    assert.equal(finance.saleRevenue, 200);
    assert.equal(finance.expenses, 15);

    recordSaleReturnCommand({
      invoiceNumber: 'placeholder',
      dressCode: dress.code,
      returnDate: today,
      idempotencyKey: 'sr-invalid',
    });
    assert.fail('a return against a missing invoice must be rejected');
  } catch (error) {
    assert.match(String(error.message ?? error), /بند الفاتورة/);
  } finally {
    cleanup();
  }
});

test('a sale return reduces sale revenue everywhere at once', () => {
  installStorage();
  try {
    const dress = addDress(saleItem);
    const invoice = quickSaleCommand({
      saleDate: today,
      customerName: 'هند',
      paymentMethod: 'cash',
      dressCode: dress.code,
      amount: 200,
      idempotencyKey: 's2',
    });
    recordSaleReturnCommand({
      invoiceNumber: invoice.invoiceNumber,
      dressCode: dress.code,
      returnDate: today,
      idempotencyKey: 'sr1',
    });

    assert.equal(getFinanceTotals().saleRevenue, 0);
    assert.equal(getItemFinance(dress.code).saleRevenue, 0);
    assert.equal(getDressPerformance().find((row) => row.code === dress.code).salesRevenue, 0);
  } finally {
    cleanup();
  }
});

test('reports, the finance layer and the daily close read the same movements', () => {
  installStorage();
  try {
    const customer = addCustomer({ name: 'مريم', phone: '90000001', status: 'normal' });
    const rental = addDress(rentalItem);
    const sold = addDress(saleItem);

    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: rental.id,
      pickupDate: today,
      returnDate: futureDate(2),
      depositAmount: 50,
      idempotencyKey: 'r4',
    });
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'rental',
      method: 'cash',
      amount: 40,
      idempotencyKey: 'p1',
    });
    quickSaleCommand({
      saleDate: today,
      customerName: 'هند',
      paymentMethod: 'cash',
      dressCode: sold.code,
      amount: 200,
      idempotencyKey: 's3',
    });
    postExpenseCommand({
      expenseDate: today,
      title: 'إيجار المحل',
      category: 'rent',
      amount: 30,
      paymentMethod: 'cash',
      idempotencyKey: 'e2',
    });

    const totals = getFinanceTotals();
    const summary = getFinancialSummary();

    // The report summary is a projection of the finance layer, not its own maths.
    assert.equal(summary.totalCollected, totals.grossCollected);
    assert.equal(summary.rentalCollected, totals.rentalRevenue);
    assert.equal(summary.salesCollected, totals.saleRevenue);
    assert.equal(summary.totalExpenses, totals.expenses);
    assert.equal(summary.netAmount, totals.netCashMovement);
    assert.equal(summary.depositLiabilityCollected, totals.depositLiabilityCollected);

    // The daily close counts the same cash movements for the same date.
    const closing = calculateDayClose({ businessDate: today, openingCash: 0, actualCash: 0 });
    assert.equal(closing.breakdown.cash.collections, 240, 'rental 40 + sale 200 collected in cash');
    assert.equal(closing.breakdown.cash.expenses, 30);
    assert.equal(closing.expectedCash, 210);
  } finally {
    cleanup();
  }
});

test('outstanding rental balances match the reservation ledger', () => {
  installStorage();
  try {
    const customer = addCustomer({ name: 'مريم', phone: '90000001', status: 'normal' });
    const dress = addDress(rentalItem);
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: futureDate(2),
      depositAmount: 50,
      idempotencyKey: 'r5',
    });
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'rental',
      method: 'cash',
      amount: 40,
      idempotencyKey: 'p2',
    });

    const outstanding = getOutstandingRentalBalances();
    assert.equal(outstanding.length, 1);
    assert.equal(outstanding[0].remainingAmount, 50, 'the unpaid deposit is still outstanding');
  } finally {
    cleanup();
  }
});
