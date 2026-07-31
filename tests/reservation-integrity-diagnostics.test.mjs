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
import { addDress, getDresses } from '../src/features/dresses/dress.service.ts';
import {
  createReservationCommand,
  deliverContractLineCommand,
  removeContractLineCommand,
  returnContractLineCommand,
  updateContractLineCommand,
} from '../src/features/workflows/reservationCommands.ts';
import { recordPaymentCommand } from '../src/features/workflows/paymentCommands.ts';
import {
  completeDeliveryCommand,
  completeReturnCommand,
} from '../src/features/workflows/deliveryReturnCommands.ts';
import { getReservations } from '../src/features/reservations/reservation.service.ts';
import {
  DEFAULT_APP_PREFERENCES,
  saveAppPreferences,
} from '../src/features/preferences/preferences.service.ts';

const dressInput = {
  name: 'فستان تشخيص',
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

function cleanup() {
  resetCountersForTesting();
  uninstallStorage();
}

function seedTwoLineReservation() {
  saveAppPreferences({
    ...DEFAULT_APP_PREFERENCES,
    preparationDaysBeforePickup: 0,
    cleaningDaysAfterReturn: 0,
  });
  const customer = addCustomer({
    name: 'عميلة التشخيص',
    phone: '90000123',
    status: 'normal',
  });
  const first = addDress({ ...dressInput, name: 'الفستان الأول' });
  const second = addDress({
    ...dressInput,
    name: 'الفستان الثاني',
    rentalPrice: 35,
  });
  const reservation = createReservationCommand({
    customerId: customer.id,
    pickupDate: futureDate(2),
    returnDate: futureDate(4),
    depositAmount: 0,
    lines: [
      { dressId: first.id, rentalPrice: 40, depositAmount: 20 },
      { dressId: second.id, rentalPrice: 35, depositAmount: 15 },
    ],
    idempotencyKey: 'diagnosis-create',
  });
  return { customer, first, second, reservation };
}

function payReservationInFull(reservationNumber) {
  recordPaymentCommand({
    reservationNumber,
    paymentDate: todayISO(),
    type: 'rental',
    method: 'cash',
    amount: 75,
    idempotencyKey: 'diagnosis-rental-payment',
  });
  recordPaymentCommand({
    reservationNumber,
    paymentDate: todayISO(),
    type: 'deposit',
    method: 'cash',
    amount: 35,
    idempotencyKey: 'diagnosis-deposit-payment',
  });
}

test('partial delivery cannot bypass the full-payment gate', () => {
  installStorage();
  try {
    const { reservation } = seedTwoLineReservation();
    assert.throws(
      () => deliverContractLineCommand({
        reservationNumber: reservation.reservationNumber,
        lineId: reservation.lines[0].id,
        deliveryDateTime: nowDateTimeLocal(),
        idempotencyKey: 'diagnosis-unpaid-line-delivery',
      }),
      /سداد الرصيد المتبقي/,
    );
    assert.equal(getReservations()[0].lines[0].deliveryStatus, 'pending_delivery');
  } finally {
    cleanup();
  }
});

test('a per-line physical return cannot skip inspection or service', () => {
  installStorage();
  try {
    const { first, reservation } = seedTwoLineReservation();
    payReservationInFull(reservation.reservationNumber);
    deliverContractLineCommand({
      reservationNumber: reservation.reservationNumber,
      lineId: reservation.lines[0].id,
      deliveryDateTime: nowDateTimeLocal(),
      idempotencyKey: 'diagnosis-paid-line-delivery',
    });

    assert.throws(
      () => returnContractLineCommand({
        reservationNumber: reservation.reservationNumber,
        lineId: reservation.lines[0].id,
        returnDateTime: nowDateTimeLocal(),
        lateFee: 0,
        damageFee: 0,
        nextItemStatus: 'available',
        idempotencyKey: 'diagnosis-unsafe-line-return',
      }),
      /الفحص|الغسيل|الصيانة|التالف/,
    );
    assert.equal(getDresses().find((dress) => dress.id === first.id)?.status, 'rented');
  } finally {
    cleanup();
  }
});

test('a late returned line closes once and cannot assess the fee twice', () => {
  installStorage();
  try {
    const { reservation } = seedTwoLineReservation();
    payReservationInFull(reservation.reservationNumber);
    const lineId = reservation.lines[0].id;
    deliverContractLineCommand({
      reservationNumber: reservation.reservationNumber,
      lineId,
      deliveryDateTime: nowDateTimeLocal(),
      idempotencyKey: 'diagnosis-late-line-delivery',
    });

    const returned = returnContractLineCommand({
      reservationNumber: reservation.reservationNumber,
      lineId,
      returnDateTime: nowDateTimeLocal(),
      lateFee: 10,
      damageFee: 0,
      nextItemStatus: 'inspection',
      idempotencyKey: 'diagnosis-late-line-return',
    });
    assert.equal(returned.lines[0].deliveryStatus, 'returned');
    assert.equal(returned.assessedFeesAmount, 10);

    assert.throws(
      () => returnContractLineCommand({
        reservationNumber: reservation.reservationNumber,
        lineId,
        returnDateTime: nowDateTimeLocal(),
        lateFee: 10,
        damageFee: 0,
        nextItemStatus: 'inspection',
        idempotencyKey: 'diagnosis-late-line-return-replay',
      }),
      /تم استرجاع.*بالفعل/,
    );
    assert.equal(getReservations()[0].assessedFeesAmount, 10);
  } finally {
    cleanup();
  }
});

test('whole-contract settlement refunds the deposits of every line', () => {
  installStorage();
  try {
    const { reservation } = seedTwoLineReservation();
    payReservationInFull(reservation.reservationNumber);
    completeDeliveryCommand({
      reservationNumber: reservation.reservationNumber,
      deliveryDateTime: nowDateTimeLocal(),
      idempotencyKey: 'diagnosis-whole-delivery',
    });
    const result = completeReturnCommand({
      reservationNumber: reservation.reservationNumber,
      returnDateTime: nowDateTimeLocal(),
      lateFee: 0,
      damageFee: 0,
      refundMethod: 'cash',
      nextItemStatus: 'inspection',
      idempotencyKey: 'diagnosis-whole-return',
    });

    assert.equal(result.depositRefundAmount, 35);
    const stored = getReservations()[0];
    assert.equal(stored.settledDepositAmount, 35);
    assert.equal(stored.refundedAmount, 35);
    assert.equal(stored.remainingAmount, 0);
  } finally {
    cleanup();
  }
});

test('contract value cannot be changed underneath posted money', () => {
  installStorage();
  try {
    const { reservation } = seedTwoLineReservation();
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: todayISO(),
      type: 'rental',
      method: 'cash',
      amount: 40,
      idempotencyKey: 'diagnosis-partial-payment',
    });

    assert.throws(
      () => removeContractLineCommand({
        reservationNumber: reservation.reservationNumber,
        lineId: reservation.lines[1].id,
        idempotencyKey: 'diagnosis-remove-paid-line',
      }),
      /حركة مالية|مبالغ محصلة/,
    );
    assert.throws(
      () => updateContractLineCommand({
        reservationNumber: reservation.reservationNumber,
        lineId: reservation.lines[0].id,
        rentalPrice: 10,
        idempotencyKey: 'diagnosis-reprice-paid-line',
      }),
      /حركة مالية|مبالغ محصلة/,
    );
    assert.equal(getReservations()[0].totalAmount, 110);
  } finally {
    cleanup();
  }
});

test('contract-line edits reject impossible dates and invalid money', () => {
  installStorage();
  try {
    const { reservation } = seedTwoLineReservation();
    const lineId = reservation.lines[0].id;

    assert.throws(
      () => updateContractLineCommand({
        reservationNumber: reservation.reservationNumber,
        lineId,
        pickupDate: futureDate(5),
        returnDate: futureDate(3),
        idempotencyKey: 'diagnosis-invalid-line-dates',
      }),
      /تاريخ الإرجاع يجب أن يكون بعد تاريخ الاستلام/,
    );
    assert.throws(
      () => updateContractLineCommand({
        reservationNumber: reservation.reservationNumber,
        lineId,
        rentalPrice: -1,
        idempotencyKey: 'diagnosis-negative-line-price',
      }),
      /قيمة الإيجار المتفق عليها غير صالحة/,
    );
  } finally {
    cleanup();
  }
});
