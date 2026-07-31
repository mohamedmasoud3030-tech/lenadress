import test from 'node:test';
import assert from 'node:assert/strict';
import { installStorage, uninstallStorage, futureDate } from './helpers/storage.mjs';
import { resetCountersForTesting } from '../src/engines/persistence/index.ts';
import { getAuditLog } from '../src/features/audit/audit.service.ts';
import { addCustomer } from '../src/features/customers/customer.service.ts';
import { addDress, getDresses } from '../src/features/dresses/dress.service.ts';
import { getReservations } from '../src/features/reservations/reservation.service.ts';
import { createReservationCommand } from '../src/features/workflows/reservationCommands.ts';
import { recordPaymentCommand } from '../src/features/workflows/paymentCommands.ts';
import {
  completeDeliveryCommand,
  completeReturnCommand,
} from '../src/features/workflows/deliveryReturnCommands.ts';
import {
  DEFAULT_APP_PREFERENCES,
  saveAppPreferences,
} from '../src/features/preferences/preferences.service.ts';
import { getTodayISO } from '../src/shared/utils/date.ts';

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
  depositAmount: 20,
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

function seed() {
  saveAppPreferences({
    ...DEFAULT_APP_PREFERENCES,
    preparationDaysBeforePickup: 0,
    cleaningDaysAfterReturn: 0,
  });
  const customer = addCustomer({ name: 'مريم', phone: '90000001', status: 'normal' });
  const firstDress = addDress({ ...dressInput, name: 'فستان أزرق' });
  const secondDress = addDress({
    ...dressInput,
    name: 'فستان ذهبي',
    color: 'ذهبي',
    rentalPrice: 35,
    depositAmount: 15,
  });
  return { customer, firstDress, secondDress };
}

function handoverTime() {
  return new Date(Date.now() - 1_000).toISOString();
}

test('the UI fulfillment workflow refuses delivery until the full reservation balance is collected', () => {
  installStorage();
  try {
    const { customer, firstDress } = seed();
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: firstDress.id,
      pickupDate: getTodayISO(),
      returnDate: futureDate(2),
      depositAmount: firstDress.depositAmount,
      idempotencyKey: 'unpaid-reservation',
    });

    assert.throws(
      () => completeDeliveryCommand({
        reservationNumber: reservation.reservationNumber,
        deliveryDateTime: handoverTime(),
        idempotencyKey: 'unpaid-delivery',
      }),
      /سداد|الرصيد|المبلغ/,
    );

    assert.equal(getReservations()[0].status, 'confirmed');
    assert.equal(getDresses().find((dress) => dress.id === firstDress.id).status, 'available');
  } finally {
    cleanup();
  }
});

test('the UI delivery workflow hands over every item in a fully-paid multi-item contract', () => {
  installStorage();
  try {
    const { customer, firstDress, secondDress } = seed();
    const reservation = createReservationCommand({
      customerId: customer.id,
      pickupDate: getTodayISO(),
      returnDate: futureDate(2),
      depositAmount: 0,
      lines: [
        { dressId: firstDress.id, rentalPrice: 40, depositAmount: 20 },
        { dressId: secondDress.id, rentalPrice: 35, depositAmount: 15 },
      ],
      idempotencyKey: 'multi-reservation',
    });
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: getTodayISO(),
      type: 'rental',
      method: 'cash',
      amount: 75,
      idempotencyKey: 'multi-rental',
    });
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: getTodayISO(),
      type: 'deposit',
      method: 'cash',
      amount: 35,
      idempotencyKey: 'multi-deposit',
    });
    assert.equal(getReservations()[0].remainingAmount, 0);

    completeDeliveryCommand({
      reservationNumber: reservation.reservationNumber,
      deliveryDateTime: handoverTime(),
      idempotencyKey: 'multi-delivery',
    });

    assert.deepEqual(
      getReservations()[0].lines.map((line) => line.deliveryStatus),
      ['delivered', 'delivered'],
    );
    assert.deepEqual(
      getDresses()
        .filter((dress) => [firstDress.id, secondDress.id].includes(dress.id))
        .map((dress) => dress.status),
      ['rented', 'rented'],
    );
  } finally {
    cleanup();
  }
});

test('an exceptional unpaid handover records the operator reason in the audit trail', () => {
  installStorage();
  try {
    const { customer, firstDress } = seed();
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: firstDress.id,
      pickupDate: getTodayISO(),
      returnDate: futureDate(2),
      depositAmount: firstDress.depositAmount,
      idempotencyKey: 'override-reservation',
    });

    completeDeliveryCommand({
      reservationNumber: reservation.reservationNumber,
      deliveryDateTime: handoverTime(),
      paymentOverrideReason: 'موافقة المالكة على التحصيل عند الإرجاع',
      idempotencyKey: 'override-delivery',
    });

    const auditEntry = getAuditLog().find((entry) => entry.action === 'deliver');
    assert.equal(
      auditEntry?.nextValues?.paymentOverrideReason,
      'موافقة المالكة على التحصيل عند الإرجاع',
    );
  } finally {
    cleanup();
  }
});

test('the UI return workflow receives every item in a multi-item contract into inspection', () => {
  installStorage();
  try {
    const { customer, firstDress, secondDress } = seed();
    const reservation = createReservationCommand({
      customerId: customer.id,
      pickupDate: getTodayISO(),
      returnDate: futureDate(2),
      depositAmount: 0,
      lines: [
        { dressId: firstDress.id, rentalPrice: 40, depositAmount: 20 },
        { dressId: secondDress.id, rentalPrice: 35, depositAmount: 15 },
      ],
      idempotencyKey: 'return-reservation',
    });
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: getTodayISO(),
      type: 'rental',
      method: 'cash',
      amount: 75,
      idempotencyKey: 'return-rental',
    });
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: getTodayISO(),
      type: 'deposit',
      method: 'cash',
      amount: 35,
      idempotencyKey: 'return-deposit',
    });
    assert.equal(getReservations()[0].remainingAmount, 0);

    const deliveryTime = handoverTime();
    completeDeliveryCommand({
      reservationNumber: reservation.reservationNumber,
      deliveryDateTime: deliveryTime,
      idempotencyKey: 'return-delivery',
    });
    completeReturnCommand({
      reservationNumber: reservation.reservationNumber,
      returnDateTime: new Date().toISOString(),
      lateFee: 0,
      damageFee: 0,
      refundMethod: 'cash',
      nextItemStatus: 'inspection',
      idempotencyKey: 'return-complete',
    });

    assert.deepEqual(
      getReservations()[0].lines.map((line) => line.deliveryStatus),
      ['returned', 'returned'],
    );
    assert.deepEqual(
      getDresses()
        .filter((dress) => [firstDress.id, secondDress.id].includes(dress.id))
        .map((dress) => dress.status),
      ['inspection', 'inspection'],
    );
    assert.equal(getReservations()[0].remainingAmount, 0);
  } finally {
    cleanup();
  }
});
