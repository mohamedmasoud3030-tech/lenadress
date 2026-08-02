import test from 'node:test';
import assert from 'node:assert/strict';
import { installStorage, uninstallStorage, todayISO, nowDateTimeLocal } from './helpers/storage.mjs';
import { readCollection, resetCountersForTesting, writeCollection } from '../src/engines/persistence/index.ts';
import { setCommandFailurePoint } from '../src/engines/workflows/index.ts';
import { addCustomer } from '../src/features/customers/customer.service.ts';
import { addDress } from '../src/features/dresses/dress.service.ts';
import { addAccessory } from '../src/features/accessories/accessory.service.ts';
import { createReservationCommand } from '../src/features/workflows/reservationCommands.ts';
import { recordPaymentCommand } from '../src/features/workflows/paymentCommands.ts';
import { completeDeliveryCommand, completeReturnCommand } from '../src/features/workflows/deliveryReturnCommands.ts';
import { attachAccessoryCommand } from '../src/features/workflows/accessoryCommands.ts';
import { quickSaleCommand, recordSaleReturnCommand } from '../src/features/workflows/salesCommands.ts';
import { postExpenseCommand } from '../src/features/workflows/expenseCommands.ts';
import { cancelReservationCommand } from '../src/features/workflows/reservationCommands.ts';
import { getReservations } from '../src/features/reservations/reservation.service.ts';
import {
  buildInventoryPerformanceReport,
  getDefaultPerformanceFilters,
  getInventoryPerformanceDetail,
  overlapDays,
} from '../src/features/reports/inventoryPerformance.service.ts';
import { getFinanceTotals } from '../src/features/finance/finance.service.ts';
import { DEFAULT_APP_PREFERENCES, saveAppPreferences } from '../src/features/preferences/preferences.service.ts';
import { addDaysISO } from '../src/shared/utils/date.ts';

function cleanup() {
  setCommandFailurePoint(null);
  resetCountersForTesting();
  uninstallStorage();
}

const today = todayISO();

const dressInput = {
  name: 'فستان زفاف',
  description: '',
  itemType: 'dress',
  category: 'زفاف',
  color: 'أبيض',
  size: 'M',
  purchasePrice: 300,
  rentalPrice: 100,
  salePrice: 500,
  depositAmount: 50,
  status: 'available',
  isForRent: true,
  isForSale: true,
  images: [],
  barcode: '',
};

/** A wide window so every seeded movement lands inside the reporting period. */
function filters(overrides = {}) {
  return {
    ...getDefaultPerformanceFilters(),
    from: addDaysISO(today, -30),
    to: addDaysISO(today, 30),
    idleThresholdDays: 60,
    ...overrides,
  };
}

function seedBase() {
  saveAppPreferences({ ...DEFAULT_APP_PREFERENCES, preparationDaysBeforePickup: 0, cleaningDaysAfterReturn: 0 });
  const customer = addCustomer({ name: 'مريم', phone: '90000010', status: 'normal' });
  return { customer };
}

function rowFor(report, code) {
  return report.rows.find((row) => row.code === code);
}

/**
 * Moves stored reservations onto the given day offsets.
 * The service refuses a pickup in the past, so historical scenarios are created
 * forward and then back-dated in storage, exactly like real aged data.
 */
function backdateReservations(offsets) {
  const stored = readCollection('reservations', []);
  const ordered = [...stored].sort((left, right) => left.pickupDate.localeCompare(right.pickupDate));
  const byId = new Map(ordered.map((reservation, index) => [
    reservation.id,
    offsets[index] ?? null,
  ]));

  writeCollection('reservations', stored.map((reservation) => {
    const offset = byId.get(reservation.id);
    if (!offset) return reservation;
    return { ...reservation, pickupDate: addDaysISO(today, offset[0]), returnDate: addDaysISO(today, offset[1]) };
  }));
}

test('an item with no usage reports zero everywhere and counts as idle', () => {
  installStorage();
  try {
    seedBase();
    const dress = addDress(dressInput);

    const report = buildInventoryPerformanceReport(filters({ idleThresholdDays: 30 }));
    const row = rowFor(report, dress.code);

    assert.equal(row.rentalCount, 0);
    assert.equal(row.totalRevenue, 0);
    assert.equal(row.netResult, 0);
    assert.equal(row.occupiedDays, 0);
    assert.equal(row.utilisationRate, 0);
    assert.equal(row.lastUsedDate, null);
    assert.equal(row.idleDays, null);
    assert.equal(row.isIdle, true, 'a never-used item inside a long window is idle');
    assert.equal(row.averageTransactionValue, 0);
    assert.equal(report.totals.idleItemCount, 1);
  } finally {
    cleanup();
  }
});

test('a single paid rental produces revenue, occupancy and a utilisation rate', () => {
  installStorage();
  try {
    const { customer } = seedBase();
    const dress = addDress(dressInput);
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: addDaysISO(today, 2),
      depositAmount: 50,
      idempotencyKey: 'r1',
    });
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'rental_payment',
      method: 'cash',
      amount: 100,
      idempotencyKey: 'p1',
    });

    const activeFilters = filters();
    const report = buildInventoryPerformanceReport(activeFilters);
    const row = rowFor(report, dress.code);

    assert.equal(row.rentalCount, 1);
    assert.equal(row.rentalRevenue, 100);
    assert.equal(row.totalRevenue, 100);
    assert.equal(row.occupiedDays, 3, 'both endpoints of the booked period are occupied');
    assert.equal(row.availableDays, 61);
    assert.equal(row.utilisationRate, 3 / 61);
    assert.equal(row.averageRentalDays, 3);
    assert.equal(row.averageTransactionValue, 100);
    assert.equal(row.lastUsedDate, today);
    assert.equal(row.idleDays, 30);
  } finally {
    cleanup();
  }
});

test('several rentals accumulate count, revenue and occupied days', () => {
  installStorage();
  try {
    const { customer } = seedBase();
    const dress = addDress(dressInput);

    // Bookings are created forward (the service refuses a past pickup) and then
    // back-dated in storage so the report sees a realistic mixed history.
    [[2, 4], [8, 10], [14, 16]].forEach(([start, end], index) => {
      const reservation = createReservationCommand({
        customerId: customer.id,
        dressId: dress.id,
        pickupDate: addDaysISO(today, start),
        returnDate: addDaysISO(today, end),
        depositAmount: 0,
        idempotencyKey: `multi-${index}`,
      });
      recordPaymentCommand({
        reservationNumber: reservation.reservationNumber,
        paymentDate: today,
        type: 'rental_payment',
        method: 'cash',
        amount: 100,
        idempotencyKey: `multi-pay-${index}`,
      });
    });
    backdateReservations([[-20, -18], [-10, -8], [2, 4]]);

    const report = buildInventoryPerformanceReport(filters());
    const row = rowFor(report, dress.code);

    assert.equal(row.rentalCount, 3);
    assert.equal(row.rentalRevenue, 300);
    assert.equal(row.occupiedDays, 9);
    assert.equal(row.averageRentalDays, 3);
    assert.equal(row.turnoverRate, 3 / 61);
  } finally {
    cleanup();
  }
});

test('a cancelled reservation contributes no revenue and no occupancy', () => {
  installStorage();
  try {
    const { customer } = seedBase();
    const dress = addDress(dressInput);
    createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: addDaysISO(today, 5),
      returnDate: addDaysISO(today, 8),
      depositAmount: 0,
      idempotencyKey: 'cancel-me',
    });
    cancelReservationCommand(getReservations()[0].id);

    const report = buildInventoryPerformanceReport(filters());
    const row = rowFor(report, dress.code);

    assert.equal(row.rentalCount, 0);
    assert.equal(row.occupiedDays, 0);
    assert.equal(row.totalRevenue, 0);
  } finally {
    cleanup();
  }
});

test('an unpaid booking occupies the item but earns nothing', () => {
  installStorage();
  try {
    const { customer } = seedBase();
    const dress = addDress(dressInput);
    createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: addDaysISO(today, 1),
      depositAmount: 0,
      idempotencyKey: 'unpaid',
    });

    const report = buildInventoryPerformanceReport(filters());
    const row = rowFor(report, dress.code);

    assert.equal(row.rentalCount, 1);
    assert.equal(row.occupiedDays, 2);
    assert.equal(row.rentalRevenue, 0, 'a booking that was never paid is not income');
  } finally {
    cleanup();
  }
});

test('an overdue rental is counted as late', () => {
  installStorage();
  try {
    const { customer } = seedBase();
    const dress = addDress(dressInput);
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: addDaysISO(today, 3),
      depositAmount: 0,
      idempotencyKey: 'late-1',
    });
    // Push the booking into the past so the overdue projection fires.
    writeCollection('reservations', readCollection('reservations', []).map((item) => (
      item.reservationNumber === reservation.reservationNumber
        ? { ...item, pickupDate: addDaysISO(today, -8), returnDate: addDaysISO(today, -5) }
        : item
    )));

    const report = buildInventoryPerformanceReport(filters());
    const row = rowFor(report, dress.code);

    assert.equal(row.lateCount, 1);
    assert.ok(report.chronicallyLateItems.some((item) => item.code === dress.code));
  } finally {
    cleanup();
  }
});

test('a discount is taken from the recorded price snapshot, not guessed later', () => {
  installStorage();
  try {
    const { customer } = seedBase();
    const dress = addDress(dressInput);
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: addDaysISO(today, 1),
      depositAmount: 0,
      rentalPrice: 80,
      idempotencyKey: 'discounted',
    });
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'rental_payment',
      method: 'cash',
      amount: 80,
      idempotencyKey: 'discount-pay',
    });

    const report = buildInventoryPerformanceReport(filters());
    const row = rowFor(report, dress.code);

    assert.equal(row.discounts, 20);
    assert.equal(row.rentalRevenue, 80, 'the discount is never counted as revenue');
    assert.equal(row.netResult, 80);
  } finally {
    cleanup();
  }
});

test('a completed sale is revenue exactly once, and a sale return reverses it', () => {
  installStorage();
  try {
    seedBase();
    const dress = addDress(dressInput);
    const invoice = quickSaleCommand({
      saleDate: today,
      customerName: 'هدى',
      paymentMethod: 'cash',
      dressCode: dress.code,
      amount: 450,
      idempotencyKey: 'sale-1',
    });

    let report = buildInventoryPerformanceReport(filters());
    let row = rowFor(report, dress.code);
    assert.equal(row.saleCount, 1);
    assert.equal(row.saleRevenue, 450);
    assert.equal(row.discounts, 50, 'the gap to the catalogue sale price is a discount');
    // The sale ledger is the only source: the payment ledger holds no duplicate.
    assert.equal(readCollection('payments', []).length, 0);

    recordSaleReturnCommand({
      invoiceNumber: invoice.invoiceNumber,
      dressCode: dress.code,
      returnDate: today,
      idempotencyKey: 'sale-return-1',
    });

    report = buildInventoryPerformanceReport(filters());
    row = rowFor(report, dress.code);
    assert.equal(row.saleReturnCount, 1);
    assert.equal(row.saleRevenue, 0, 'a returned sale nets out to zero revenue');
  } finally {
    cleanup();
  }
});

test('maintenance cost reduces the net result and marks a cost-heavy item', () => {
  installStorage();
  try {
    const { customer } = seedBase();
    const dress = addDress(dressInput);
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: addDaysISO(today, 1),
      depositAmount: 0,
      idempotencyKey: 'cost-1',
    });
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'rental_payment',
      method: 'cash',
      amount: 100,
      idempotencyKey: 'cost-pay',
    });
    postExpenseCommand({
      expenseDate: today,
      title: 'تنظيف',
      category: 'laundry',
      amount: 40,
      paymentMethod: 'cash',
      relatedDressCode: dress.code,
      idempotencyKey: 'exp-1',
    });
    postExpenseCommand({
      expenseDate: today,
      title: 'تعديل',
      category: 'maintenance',
      amount: 25,
      paymentMethod: 'cash',
      relatedDressCode: dress.code,
      idempotencyKey: 'exp-2',
    });

    const report = buildInventoryPerformanceReport(filters());
    const row = rowFor(report, dress.code);

    assert.equal(row.serviceCost, 65);
    assert.equal(row.totalCost, 65);
    assert.equal(row.netResult, 35);
    assert.equal(row.costToRevenueRatio, 0.65);
    assert.ok(report.serviceHeavyItems.some((item) => item.code === dress.code));
  } finally {
    cleanup();
  }
});

test('a partial accessory return and a lost accessory land on the accessory row', () => {
  installStorage();
  try {
    const { customer } = seedBase();
    const dress = addDress(dressInput);
    const veil = addAccessory({ name: 'طرحة', category: 'veil', rentalPrice: 15 });
    const crown = addAccessory({ name: 'تاج', category: 'crown', rentalPrice: 10 });
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: addDaysISO(today, 1),
      depositAmount: 0,
      idempotencyKey: 'acc-perf',
    });
    attachAccessoryCommand({ reservationNumber: reservation.reservationNumber, accessoryId: veil.id });
    attachAccessoryCommand({ reservationNumber: reservation.reservationNumber, accessoryId: crown.id });
    completeDeliveryCommand({
      paymentOverrideReason: 'تجاوز سداد مخصص لسيناريو الاختبار',
      reservationNumber: reservation.reservationNumber,
      deliveryDateTime: nowDateTimeLocal(),
      deliveredAccessoryIds: [veil.id, crown.id],
      idempotencyKey: 'acc-perf-deliver',
    });
    // Partial return: only the veil comes back, and it is lost.
    completeReturnCommand({
      reservationNumber: reservation.reservationNumber,
      returnDateTime: nowDateTimeLocal(),
      lateFee: 0,
      damageFee: 0,
      refundMethod: 'cash',
      nextItemStatus: 'inspection',
      accessoryReturns: [{ accessoryId: veil.id, condition: 'lost', chargeAmount: 30 }],
      idempotencyKey: 'acc-perf-return',
    });

    const report = buildInventoryPerformanceReport(filters());
    const veilRow = rowFor(report, veil.code);
    const crownRow = rowFor(report, crown.code);

    assert.equal(veilRow.kind, 'accessory');
    assert.equal(veilRow.rentalRevenue, 15, 'a delivered accessory earns its agreed rental price');
    assert.equal(veilRow.lossCount, 1);
    assert.equal(veilRow.damageCost, 30, 'the loss charge is attributed to the accessory');
    assert.equal(veilRow.netResult, -15);
    assert.equal(crownRow.rentalRevenue, 10);
    assert.equal(crownRow.lossCount, 0, 'an accessory still out has no recorded condition yet');
  } finally {
    cleanup();
  }
});

test('utilisation clips a booking that starts before the reporting window', () => {
  installStorage();
  try {
    assert.equal(overlapDays({ pickupDate: '2026-03-01', returnDate: '2026-03-10' }, '2026-03-05', '2026-03-31'), 6);
    assert.equal(overlapDays({ pickupDate: '2026-02-01', returnDate: '2026-02-10' }, '2026-03-01', '2026-03-31'), 0);
    assert.equal(overlapDays({ pickupDate: '2026-03-10', returnDate: '2026-03-10' }, '2026-03-01', '2026-03-31'), 1);
  } finally {
    cleanup();
  }
});

test('a narrower date range excludes movements outside it', () => {
  installStorage();
  try {
    const { customer } = seedBase();
    const dress = addDress(dressInput);
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: addDaysISO(today, 20),
      returnDate: addDaysISO(today, 22),
      depositAmount: 0,
      idempotencyKey: 'range-1',
    });
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'rental_payment',
      method: 'cash',
      amount: 100,
      idempotencyKey: 'range-pay',
    });

    const inside = buildInventoryPerformanceReport(filters());
    assert.equal(rowFor(inside, dress.code).rentalCount, 1);

    const outside = buildInventoryPerformanceReport(filters({ from: addDaysISO(today, -30), to: addDaysISO(today, -1) }));
    const row = rowFor(outside, dress.code);
    assert.equal(row.rentalCount, 0);
    assert.equal(row.rentalRevenue, 0, 'a payment outside the window is not counted');
  } finally {
    cleanup();
  }
});

test('an invalid date range is rejected instead of producing nonsense', () => {
  installStorage();
  try {
    seedBase();
    assert.throws(
      () => buildInventoryPerformanceReport(filters({ from: addDaysISO(today, 5), to: today })),
      /تاريخ البداية/,
    );
  } finally {
    cleanup();
  }
});

test('top and low performers rank on net result and utilisation, not booking count', () => {
  installStorage();
  try {
    const { customer } = seedBase();
    const cheap = addDress({ ...dressInput, name: 'فستان رخيص', rentalPrice: 10 });
    const premium = addDress({ ...dressInput, name: 'فستان فاخر', rentalPrice: 300 });

    // The cheap dress is booked three times but barely earns.
    [[2, 3], [6, 7], [10, 11]].forEach(([start, end], index) => {
      const reservation = createReservationCommand({
        customerId: customer.id,
        dressId: cheap.id,
        pickupDate: addDaysISO(today, start),
        returnDate: addDaysISO(today, end),
        depositAmount: 0,
        idempotencyKey: `cheap-${index}`,
      });
      recordPaymentCommand({
        reservationNumber: reservation.reservationNumber,
        paymentDate: today,
        type: 'rental_payment',
        method: 'cash',
        amount: 10,
        idempotencyKey: `cheap-pay-${index}`,
      });
    });

    // The premium dress is booked once and earns far more.
    const premiumReservation = createReservationCommand({
      customerId: customer.id,
      dressId: premium.id,
      pickupDate: addDaysISO(today, 20),
      returnDate: addDaysISO(today, 22),
      depositAmount: 0,
      idempotencyKey: 'premium-1',
    });
    recordPaymentCommand({
      reservationNumber: premiumReservation.reservationNumber,
      paymentDate: today,
      type: 'rental_payment',
      method: 'cash',
      amount: 300,
      idempotencyKey: 'premium-pay',
    });

    const report = buildInventoryPerformanceReport(filters());
    assert.equal(report.topPerformers[0].code, premium.code, 'value beats popularity');
    assert.equal(report.lowPerformers[0].code, cheap.code);
  } finally {
    cleanup();
  }
});

test('the report never invents revenue that the finance layer does not recognise', () => {
  installStorage();
  try {
    const { customer } = seedBase();
    const dress = addDress(dressInput);
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: addDaysISO(today, 1),
      depositAmount: 50,
      idempotencyKey: 'recon-1',
    });
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'rental_payment',
      method: 'cash',
      amount: 100,
      idempotencyKey: 'recon-rent',
    });
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'security_deposit_collection',
      method: 'cash',
      amount: 50,
      idempotencyKey: 'recon-dep',
    });
    quickSaleCommand({
      saleDate: today,
      customerName: 'هدى',
      paymentMethod: 'cash',
      dressCode: addDress({ ...dressInput, name: 'فستان للبيع' }).code,
      amount: 500,
      idempotencyKey: 'recon-sale',
    });

    const report = buildInventoryPerformanceReport(filters());
    const finance = getFinanceTotals({ from: filters().from, to: filters().to });

    // A refundable deposit is a liability and must not appear as item revenue.
    assert.equal(rowFor(report, dress.code).rentalRevenue, 100);
    assert.equal(report.totals.totalRevenue, finance.rentalRevenue + finance.saleRevenue);
  } finally {
    cleanup();
  }
});

test('the item detail view exposes bookings, revenue lines, costs and accessories', () => {
  installStorage();
  try {
    const { customer } = seedBase();
    const dress = addDress(dressInput);
    const veil = addAccessory({ name: 'طرحة', category: 'veil', rentalPrice: 5 });
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: addDaysISO(today, 2),
      depositAmount: 0,
      idempotencyKey: 'detail-1',
    });
    attachAccessoryCommand({ reservationNumber: reservation.reservationNumber, accessoryId: veil.id });
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'rental_payment',
      method: 'cash',
      amount: 100,
      idempotencyKey: 'detail-pay',
    });
    postExpenseCommand({
      expenseDate: today,
      title: 'تنظيف',
      category: 'laundry',
      amount: 20,
      paymentMethod: 'cash',
      relatedDressCode: dress.code,
      idempotencyKey: 'detail-exp',
    });

    const activeFilters = filters();
    const detail = getInventoryPerformanceDetail(dress.id, activeFilters);

    assert.ok(detail);
    assert.equal(detail.reservations.length, 1);
    assert.equal(detail.reservations[0].occupiedDays, 3);
    assert.equal(detail.revenues.filter((line) => line.kind === 'rental').length, 1);
    assert.equal(detail.costs.length, 1);
    assert.equal(detail.linkedAccessories[0].code, veil.code);
    assert.ok(detail.timeline.length > 0);

    assert.equal(getInventoryPerformanceDetail('missing-id', activeFilters), null);
  } finally {
    cleanup();
  }
});

test('the timeline aggregates by the selected granularity', () => {
  installStorage();
  try {
    const { customer } = seedBase();
    const dress = addDress(dressInput);
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: addDaysISO(today, 1),
      depositAmount: 0,
      idempotencyKey: 'timeline-1',
    });
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'rental_payment',
      method: 'cash',
      amount: 100,
      idempotencyKey: 'timeline-pay',
    });

    const monthly = buildInventoryPerformanceReport(filters({ granularity: 'month' }));
    assert.match(monthly.timeline[0].period, /^\d{4}-\d{2}$/);

    const weekly = buildInventoryPerformanceReport(filters({ granularity: 'week' }));
    assert.match(weekly.timeline[0].period, /^\d{4}-W\d{2}$/);

    const yearly = buildInventoryPerformanceReport(filters({ granularity: 'year' }));
    assert.match(yearly.timeline[0].period, /^\d{4}$/);
    assert.equal(yearly.timeline.reduce((total, point) => total + point.revenue, 0), 100);
  } finally {
    cleanup();
  }
});

test('operation and kind filters narrow the reported rows', () => {
  installStorage();
  try {
    const { customer } = seedBase();
    const rented = addDress(dressInput);
    const sold = addDress({ ...dressInput, name: 'فستان مبيع' });
    addAccessory({ name: 'طرحة', category: 'veil', rentalPrice: 5 });

    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: rented.id,
      pickupDate: today,
      returnDate: addDaysISO(today, 1),
      depositAmount: 0,
      idempotencyKey: 'filter-rent',
    });
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'rental_payment',
      method: 'cash',
      amount: 100,
      idempotencyKey: 'filter-pay',
    });
    quickSaleCommand({
      saleDate: today,
      customerName: 'هدى',
      paymentMethod: 'cash',
      dressCode: sold.code,
      amount: 500,
      idempotencyKey: 'filter-sale',
    });

    const rentalOnly = buildInventoryPerformanceReport(filters({ operation: 'rental' }));
    assert.deepEqual(rentalOnly.rows.map((row) => row.code), [rented.code]);

    const saleOnly = buildInventoryPerformanceReport(filters({ operation: 'sale' }));
    assert.deepEqual(saleOnly.rows.map((row) => row.code), [sold.code]);

    const accessoriesOnly = buildInventoryPerformanceReport(filters({ kind: 'accessory' }));
    assert.ok(accessoriesOnly.rows.every((row) => row.kind === 'accessory'));

    const byCategory = buildInventoryPerformanceReport(filters({ category: 'زفاف' }));
    assert.ok(byCategory.rows.every((row) => row.kind === 'dress'));
  } finally {
    cleanup();
  }
});

test('sorting is stable and honours the chosen direction', () => {
  installStorage();
  try {
    const { customer } = seedBase();
    const first = addDress({ ...dressInput, name: 'أول' });
    const second = addDress({ ...dressInput, name: 'ثانٍ' });

    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: second.id,
      pickupDate: today,
      returnDate: addDaysISO(today, 1),
      depositAmount: 0,
      idempotencyKey: 'sort-1',
    });
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'rental_payment',
      method: 'cash',
      amount: 100,
      idempotencyKey: 'sort-pay',
    });

    const desc = buildInventoryPerformanceReport(filters({ sortBy: 'revenue', sortDirection: 'desc' }));
    assert.equal(desc.rows[0].code, second.code);

    const asc = buildInventoryPerformanceReport(filters({ sortBy: 'revenue', sortDirection: 'asc' }));
    assert.equal(asc.rows[0].code, first.code);
  } finally {
    cleanup();
  }
});
