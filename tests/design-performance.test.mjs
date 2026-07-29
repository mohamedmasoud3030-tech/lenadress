import test from 'node:test';
import assert from 'node:assert/strict';
import { installStorage, uninstallStorage, todayISO } from './helpers/storage.mjs';
import { resetCountersForTesting } from '../src/engines/persistence/index.ts';
import { setCommandFailurePoint } from '../src/engines/workflows/index.ts';
import { addCustomer } from '../src/features/customers/customer.service.ts';
import { addDress } from '../src/features/dresses/dress.service.ts';
import { addDressDesign, addDesignVariants } from '../src/features/dresses/design.service.ts';
import { createReservationCommand } from '../src/features/workflows/reservationCommands.ts';
import { recordPaymentCommand } from '../src/features/workflows/paymentCommands.ts';
import { postExpenseCommand } from '../src/features/workflows/expenseCommands.ts';
import {
  buildInventoryPerformanceReport,
  getDefaultPerformanceFilters,
} from '../src/features/reports/inventoryPerformance.service.ts';
import { DEFAULT_APP_PREFERENCES, saveAppPreferences } from '../src/features/preferences/preferences.service.ts';
import { addDaysISO } from '../src/shared/utils/date.ts';

function cleanup() {
  setCommandFailurePoint(null);
  resetCountersForTesting();
  uninstallStorage();
}

const today = todayISO();

function filters(overrides = {}) {
  return {
    ...getDefaultPerformanceFilters(),
    from: addDaysISO(today, -30),
    to: addDaysISO(today, 30),
    ...overrides,
  };
}

function seed() {
  saveAppPreferences({ ...DEFAULT_APP_PREFERENCES, preparationDaysBeforePickup: 0, cleaningDaysAfterReturn: 0 });
  return { customer: addCustomer({ name: 'مريم', phone: '90000050', status: 'normal' }) };
}

function makeDesign(name = 'فستان زفاف') {
  return addDressDesign({
    name,
    category: 'زفاف',
    defaultRentalPrice: 100,
    defaultSalePrice: 500,
    defaultDepositAmount: 0,
  });
}

/** Books a piece and collects its rental money, so the revenue is realised. */
function bookAndPay(customerId, piece, startOffset, endOffset, amount, key) {
  const reservation = createReservationCommand({
    customerId,
    dressId: piece.id,
    pickupDate: addDaysISO(today, startOffset),
    returnDate: addDaysISO(today, endOffset),
    depositAmount: 0,
    idempotencyKey: `rsv-${key}`,
  });
  recordPaymentCommand({
    reservationNumber: reservation.reservationNumber,
    paymentDate: today,
    type: 'rental',
    method: 'cash',
    amount,
    idempotencyKey: `pay-${key}`,
  });
  return reservation;
}

test('a showroom with no designs reports no design rows', () => {
  installStorage();
  try {
    seed();
    addDress({
      name: 'قطعة مستقلة',
      description: '',
      itemType: 'dress',
      category: 'سهرة',
      color: 'أزرق',
      size: 'M',
      purchasePrice: 0,
      rentalPrice: 50,
      salePrice: 200,
      depositAmount: 0,
      status: 'available',
      isForRent: true,
      isForSale: true,
      images: [],
      barcode: '',
    });

    const report = buildInventoryPerformanceReport(filters());
    assert.deepEqual(report.designRows, [], 'designs are additive, never forced');
    assert.equal(report.rows.length, 1, 'the standalone piece is still reported');
  } finally {
    cleanup();
  }
});

test('a design totals the money of all its pieces', () => {
  installStorage();
  try {
    const { customer } = seed();
    const design = makeDesign();
    const pieces = addDesignVariants(design.id, [
      { size: 'S', color: 'أبيض' },
      { size: 'M', color: 'أبيض' },
    ]);

    bookAndPay(customer.id, pieces[0], 2, 4, 100, 'a');
    bookAndPay(customer.id, pieces[1], 6, 8, 100, 'b');

    const report = buildInventoryPerformanceReport(filters());
    assert.equal(report.designRows.length, 1);

    const designRow = report.designRows[0];
    assert.equal(designRow.code, design.code);
    assert.equal(designRow.pieceCount, 2);
    assert.equal(designRow.rentalCount, 2);
    assert.equal(designRow.totalRevenue, 200);

    // The roll-up must equal the sum of its own piece rows, never a recomputation.
    const pieceRows = report.rows.filter((row) => pieces.some((piece) => piece.id === row.id));
    assert.equal(designRow.totalRevenue, pieceRows.reduce((total, row) => total + row.totalRevenue, 0));
    assert.equal(designRow.netResult, pieceRows.reduce((total, row) => total + row.netResult, 0));
  } finally {
    cleanup();
  }
});

test('design utilisation is pooled, so one busy piece cannot hide idle ones', () => {
  installStorage();
  try {
    const { customer } = seed();
    const design = makeDesign();
    const pieces = addDesignVariants(design.id, [{ size: 'M', color: 'أبيض', quantity: 4 }]);

    // Only one of four pieces is ever booked.
    bookAndPay(customer.id, pieces[0], 2, 4, 100, 'busy');

    const report = buildInventoryPerformanceReport(filters());
    const designRow = report.designRows[0];

    assert.equal(designRow.pieceCount, 4);
    assert.equal(designRow.idlePieceCount, 3, 'three pieces earned nothing');
    // 3 occupied days out of 4 pieces x 61 days, not 3 out of 61.
    assert.equal(designRow.occupiedDays, 3);
    assert.equal(designRow.availableDays, 61 * 4);
    assert.ok(designRow.utilisationRate < 0.02, 'pooled utilisation exposes the idle stock');
    assert.equal(designRow.bestPieceCode, pieces[0].code);
    assert.equal(designRow.bestPieceRevenue, 100);
  } finally {
    cleanup();
  }
});

test('design costs and discounts roll up with the revenue', () => {
  installStorage();
  try {
    const { customer } = seed();
    const design = makeDesign();
    const [piece] = addDesignVariants(design.id, [{ size: 'M', color: 'أبيض' }]);

    // A discount is recorded against the catalogue price snapshot.
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: piece.id,
      pickupDate: addDaysISO(today, 2),
      returnDate: addDaysISO(today, 4),
      depositAmount: 0,
      rentalPrice: 80,
      idempotencyKey: 'discounted',
    });
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'rental',
      method: 'cash',
      amount: 80,
      idempotencyKey: 'discount-pay',
    });
    postExpenseCommand({
      expenseDate: today,
      title: 'تنظيف',
      category: 'laundry',
      amount: 25,
      paymentMethod: 'cash',
      relatedDressCode: piece.code,
      idempotencyKey: 'design-exp',
    });

    const designRow = buildInventoryPerformanceReport(filters()).designRows[0];
    assert.equal(designRow.totalRevenue, 80);
    assert.equal(designRow.discounts, 20);
    assert.equal(designRow.totalCost, 25);
    assert.equal(designRow.netResult, 55);
  } finally {
    cleanup();
  }
});

test('designs are ranked by net result, and an unearning design still appears', () => {
  installStorage();
  try {
    const { customer } = seed();
    // A higher catalogue price, so the collected amount is within the balance.
    const strong = addDressDesign({
      name: 'تصميم قوي',
      category: 'زفاف',
      defaultRentalPrice: 300,
      defaultSalePrice: 900,
      defaultDepositAmount: 0,
    });
    const weak = makeDesign('تصميم ضعيف');
    const [strongPiece] = addDesignVariants(strong.id, [{ size: 'M', color: 'أبيض' }]);
    addDesignVariants(weak.id, [{ size: 'M', color: 'أسود' }]);

    bookAndPay(customer.id, strongPiece, 2, 4, 300, 'strong');

    const report = buildInventoryPerformanceReport(filters());
    assert.equal(report.designRows.length, 2, 'a design with no income is still visible');
    assert.equal(report.designRows[0].code, strong.code, 'ranked by net result');
    assert.equal(report.designRows[1].netResult, 0);
    assert.equal(report.designRows[1].idlePieceCount, 1);
  } finally {
    cleanup();
  }
});

test('a design row disappears when its pieces are filtered out', () => {
  installStorage();
  try {
    seed();
    const design = makeDesign();
    addDesignVariants(design.id, [{ size: 'M', color: 'أبيض' }]);

    // Accessories only: no dress piece survives the filter.
    const report = buildInventoryPerformanceReport(filters({ kind: 'accessory' }));
    assert.deepEqual(report.designRows, []);
  } finally {
    cleanup();
  }
});
