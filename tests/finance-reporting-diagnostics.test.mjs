import test from 'node:test';
import assert from 'node:assert/strict';
import {
  installStorage,
  uninstallStorage,
  futureDate,
  nowDateTimeLocal,
  todayISO,
} from './helpers/storage.mjs';
import { resetCountersForTesting } from '../src/engines/persistence/index.ts';
import { addCustomer } from '../src/features/customers/customer.service.ts';
import { addDress, getDressByCode } from '../src/features/dresses/dress.service.ts';
import { getFinanceTotals, getItemFinance } from '../src/features/finance/finance.service.ts';
import { getPayments } from '../src/features/payments/payment.service.ts';
import {
  buildInventoryPerformanceReport,
  getDefaultPerformanceFilters,
} from '../src/features/reports/inventoryPerformance.service.ts';
import { createReservationCommand } from '../src/features/workflows/reservationCommands.ts';
import { recordPaymentCommand } from '../src/features/workflows/paymentCommands.ts';
import {
  completeDeliveryCommand,
  completeReturnCommand,
} from '../src/features/workflows/deliveryReturnCommands.ts';
import {
  deliverContractLineCommand,
  returnContractLineCommand,
} from '../src/features/workflows/reservationCommands.ts';

const baseItem = {
  name: 'قطعة مالية',
  description: '',
  itemType: 'dress',
  category: 'سهرة',
  color: 'أسود',
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

function cleanup() {
  resetCountersForTesting();
  uninstallStorage();
}

function seedCustomer() {
  return addCustomer({
    name: 'عميلة الحسابات',
    phone: '91112222',
    status: 'normal',
  });
}

test('a completed return clears the deposit liability and recognises its fee once', () => {
  installStorage();
  try {
    const customer = seedCustomer();
    const item = addDress(baseItem);
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: item.id,
      pickupDate: todayISO(),
      returnDate: futureDate(1),
      depositAmount: 50,
      idempotencyKey: 'diagnosis-finance-reservation',
    });
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: todayISO(),
      type: 'rental_payment',
      method: 'cash',
      amount: 40,
      idempotencyKey: 'diagnosis-finance-rental',
    });
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: todayISO(),
      type: 'security_deposit_collection',
      method: 'cash',
      amount: 50,
      idempotencyKey: 'diagnosis-finance-deposit',
    });
    completeDeliveryCommand({
      reservationNumber: reservation.reservationNumber,
      deliveryDateTime: nowDateTimeLocal(),
      idempotencyKey: 'diagnosis-finance-delivery',
    });
    completeReturnCommand({
      reservationNumber: reservation.reservationNumber,
      returnDateTime: nowDateTimeLocal(),
      lateFee: 10,
      damageFee: 0,
      refundMethod: 'cash',
      nextItemStatus: 'inspection',
      idempotencyKey: 'diagnosis-finance-return',
    });

    const totals = getFinanceTotals();
    assert.equal(totals.depositLiabilityCollected, 0);
    assert.equal(totals.depositRetained, 10);
    assert.equal(totals.feesCollected, 10);
    assert.equal(totals.recognisedIncome, 50, 'rental 40 + late fee 10, without counting the same retained cash twice');
  } finally {
    cleanup();
  }
});

test('multi-item rental income is allocated once across the actual contract lines', () => {
  installStorage();
  try {
    const customer = seedCustomer();
    const first = addDress({ ...baseItem, name: 'قطعة 30', rentalPrice: 30, depositAmount: 0 });
    const second = addDress({ ...baseItem, name: 'قطعة 70', rentalPrice: 70, depositAmount: 0 });
    const reservation = createReservationCommand({
      customerId: customer.id,
      pickupDate: todayISO(),
      returnDate: futureDate(2),
      depositAmount: 0,
      lines: [
        { dressId: first.id, rentalPrice: 30, depositAmount: 0 },
        { dressId: second.id, rentalPrice: 70, depositAmount: 0 },
      ],
      idempotencyKey: 'diagnosis-allocation-reservation',
    });
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: todayISO(),
      type: 'rental_payment',
      method: 'cash',
      amount: 100,
      idempotencyKey: 'diagnosis-allocation-payment',
    });

    const firstFinance = getItemFinance(first.code);
    const secondFinance = getItemFinance(second.code);
    assert.equal(firstFinance.rentalRevenue, 30);
    assert.equal(secondFinance.rentalRevenue, 70);
    assert.equal(firstFinance.rentalRevenue + secondFinance.rentalRevenue, getFinanceTotals().rentalRevenue);
  } finally {
    cleanup();
  }
});

test('performance reporting counts and values every line in a multi-item contract', () => {
  installStorage();
  try {
    const customer = seedCustomer();
    const first = addDress({ ...baseItem, name: 'قطعة التقرير 30', rentalPrice: 30, depositAmount: 0 });
    const second = addDress({ ...baseItem, name: 'قطعة التقرير 70', rentalPrice: 70, depositAmount: 0 });
    const reservation = createReservationCommand({
      customerId: customer.id,
      pickupDate: todayISO(),
      returnDate: futureDate(2),
      depositAmount: 0,
      lines: [
        { dressId: first.id, rentalPrice: 30, depositAmount: 0 },
        { dressId: second.id, rentalPrice: 70, depositAmount: 0 },
      ],
      idempotencyKey: 'diagnosis-performance-reservation',
    });
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: todayISO(),
      type: 'rental_payment',
      method: 'cash',
      amount: 100,
      idempotencyKey: 'diagnosis-performance-payment',
    });

    const defaults = getDefaultPerformanceFilters();
    const report = buildInventoryPerformanceReport({
      ...defaults,
      from: todayISO(),
      to: futureDate(2),
    });
    const firstRow = report.rows.find((row) => row.code === first.code);
    const secondRow = report.rows.find((row) => row.code === second.code);

    assert.equal(firstRow?.rentalCount, 1);
    assert.equal(secondRow?.rentalCount, 1);
    assert.equal(firstRow?.rentalRevenue, 30);
    assert.equal(secondRow?.rentalRevenue, 70);
    assert.equal(report.totals.totalRevenue, 100);
  } finally {
    cleanup();
  }
});

test('a successful delivery increments each item rental count exactly once', () => {
  installStorage();
  try {
    const customer = seedCustomer();
    const first = addDress({ ...baseItem, name: 'قطعة العداد 1', rentalPrice: 30, depositAmount: 0 });
    const second = addDress({ ...baseItem, name: 'قطعة العداد 2', rentalPrice: 70, depositAmount: 0 });
    const reservation = createReservationCommand({
      customerId: customer.id,
      pickupDate: todayISO(),
      returnDate: futureDate(2),
      depositAmount: 0,
      lines: [
        { dressId: first.id, rentalPrice: 30, depositAmount: 0 },
        { dressId: second.id, rentalPrice: 70, depositAmount: 0 },
      ],
      idempotencyKey: 'diagnosis-count-reservation',
    });
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: todayISO(),
      type: 'rental_payment',
      method: 'cash',
      amount: 100,
      idempotencyKey: 'diagnosis-count-payment',
    });
    const input = {
      reservationNumber: reservation.reservationNumber,
      deliveryDateTime: nowDateTimeLocal(),
      idempotencyKey: 'diagnosis-count-delivery',
    };
    completeDeliveryCommand(input);
    assert.throws(() => completeDeliveryCommand(input), /تم تنفيذ هذه العملية بالفعل/);

    assert.equal(getDressByCode(first.code)?.timesRented, 1);
    assert.equal(getDressByCode(second.code)?.timesRented, 1);
  } finally {
    cleanup();
  }
});

test('returning every line separately settles and refunds the contract deposit once', () => {
  installStorage();
  try {
    const customer = seedCustomer();
    const first = addDress({ ...baseItem, name: 'قطعة جزئية 1', rentalPrice: 30, depositAmount: 20 });
    const second = addDress({ ...baseItem, name: 'قطعة جزئية 2', rentalPrice: 70, depositAmount: 15 });
    const reservation = createReservationCommand({
      customerId: customer.id,
      pickupDate: todayISO(),
      returnDate: futureDate(2),
      depositAmount: 0,
      lines: [
        { dressId: first.id, rentalPrice: 30, depositAmount: 20 },
        { dressId: second.id, rentalPrice: 70, depositAmount: 15 },
      ],
      idempotencyKey: 'diagnosis-partial-reservation',
    });
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: todayISO(),
      type: 'rental_payment',
      method: 'cash',
      amount: 100,
      idempotencyKey: 'diagnosis-partial-rental',
    });
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: todayISO(),
      type: 'security_deposit_collection',
      method: 'cash',
      amount: 35,
      idempotencyKey: 'diagnosis-partial-deposit',
    });

    for (const line of reservation.lines) {
      deliverContractLineCommand({
        reservationNumber: reservation.reservationNumber,
        lineId: line.id,
        deliveryDateTime: nowDateTimeLocal(),
        idempotencyKey: `diagnosis-partial-delivery-${line.id}`,
      });
    }
    for (const line of reservation.lines) {
      returnContractLineCommand({
        reservationNumber: reservation.reservationNumber,
        lineId: line.id,
        returnDateTime: nowDateTimeLocal(),
        lateFee: 0,
        damageFee: 0,
        refundMethod: 'cash',
        nextItemStatus: 'inspection',
        idempotencyKey: `diagnosis-partial-return-${line.id}`,
      });
    }

    const refunds = getPayments().filter((payment) => (
      payment.reservationNumber === reservation.reservationNumber
      && payment.direction === 'refund'
      && payment.source === 'return'
    ));
    assert.equal(refunds.length, 1);
    assert.equal(refunds[0].amount, 35);
    assert.equal(getFinanceTotals().depositLiabilityCollected, 0);
  } finally {
    cleanup();
  }
});

test('uncollected excess return fees are not reported as realised income', () => {
  installStorage();
  try {
    const customer = seedCustomer();
    const item = addDress(baseItem);
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: item.id,
      pickupDate: todayISO(),
      returnDate: futureDate(1),
      depositAmount: 50,
      idempotencyKey: 'diagnosis-excess-fee-reservation',
    });
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: todayISO(),
      type: 'rental_payment',
      method: 'cash',
      amount: 40,
      idempotencyKey: 'diagnosis-excess-fee-rental',
    });
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: todayISO(),
      type: 'security_deposit_collection',
      method: 'cash',
      amount: 50,
      idempotencyKey: 'diagnosis-excess-fee-deposit',
    });
    completeDeliveryCommand({
      reservationNumber: reservation.reservationNumber,
      deliveryDateTime: nowDateTimeLocal(),
      idempotencyKey: 'diagnosis-excess-fee-delivery',
    });
    completeReturnCommand({
      reservationNumber: reservation.reservationNumber,
      returnDateTime: nowDateTimeLocal(),
      lateFee: 80,
      damageFee: 0,
      refundMethod: 'cash',
      nextItemStatus: 'inspection',
      idempotencyKey: 'diagnosis-excess-fee-return',
    });

    const totals = getFinanceTotals();
    assert.equal(totals.depositRetained, 50);
    assert.equal(totals.feesCollected, 50);
    assert.equal(totals.recognisedIncome, 90, 'rental 40 + retained cash 50; the unpaid 30 remains a receivable');
  } finally {
    cleanup();
  }
});
