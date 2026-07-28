import test from 'node:test';
import assert from 'node:assert/strict';
import { installStorage, uninstallStorage, futureDate } from './helpers/storage.mjs';
import { resetCountersForTesting, writeCollection } from '../src/engines/persistence/index.ts';
import { addCustomer } from '../src/features/customers/customer.service.ts';
import { addDress } from '../src/features/dresses/dress.service.ts';
import {
  cancelReservation,
  createReservation,
  getReservations,
  getReservationTimes,
  hasReservationOverlap,
  rescheduleReservation,
} from '../src/features/reservations/reservation.service.ts';
import {
  expandPeriodWithBuffers,
  findItemConflicts,
  isActiveReservation,
  periodsOverlap,
} from '../src/features/reservations/reservationConflicts.ts';
import { addAccessory } from '../src/features/accessories/accessory.service.ts';
import { attachAccessoryToReservation } from '../src/features/accessories/reservationAccessory.service.ts';
import { DEFAULT_APP_PREFERENCES, saveAppPreferences } from '../src/features/preferences/preferences.service.ts';

function cleanup() {
  resetCountersForTesting();
  uninstallStorage();
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

function seed() {
  // Zero buffers keep the base scenarios about the booked period itself.
  saveAppPreferences({ ...DEFAULT_APP_PREFERENCES, preparationDaysBeforePickup: 0, cleaningDaysAfterReturn: 0 });
  const customer = addCustomer({ name: 'مريم', phone: '90000001', status: 'normal' });
  const dress = addDress(dressInput);
  const other = addDress({ ...dressInput, name: 'فستان ثانٍ' });
  return { customer, dress, other };
}

test('a reservation is created when nothing else occupies the period', () => {
  installStorage();
  try {
    const { customer, dress } = seed();
    const reservation = createReservation({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: futureDate(3),
      returnDate: futureDate(5),
      depositAmount: 50,
    });

    assert.equal(reservation.status, 'confirmed');
    assert.equal(reservation.inventoryItemId, dress.id);
    assert.equal(getReservations().length, 1);
  } finally {
    cleanup();
  }
});

test('the same dress cannot be booked into an overlapping active period', () => {
  installStorage();
  try {
    const { customer, dress } = seed();
    createReservation({ customerId: customer.id, dressId: dress.id, pickupDate: futureDate(3), returnDate: futureDate(6), depositAmount: 50 });

    assert.throws(
      () => createReservation({ customerId: customer.id, dressId: dress.id, pickupDate: futureDate(5), returnDate: futureDate(8), depositAmount: 50 }),
      /محجوز ضمن الحجز/,
    );
    assert.equal(getReservations().length, 1);
  } finally {
    cleanup();
  }
});

test('preparation and cleaning windows widen the blocked period', () => {
  installStorage();
  try {
    const { customer, dress } = seed();
    saveAppPreferences({ ...DEFAULT_APP_PREFERENCES, preparationDaysBeforePickup: 2, cleaningDaysAfterReturn: 3 });
    createReservation({ customerId: customer.id, dressId: dress.id, pickupDate: futureDate(10), returnDate: futureDate(12), depositAmount: 50 });

    // Two days after the return is still inside the 3-day cleaning window.
    assert.throws(
      () => createReservation({ customerId: customer.id, dressId: dress.id, pickupDate: futureDate(14), returnDate: futureDate(16), depositAmount: 50 }),
      /محجوز ضمن الحجز/,
    );
    // One day beyond the cleaning window is accepted.
    const later = createReservation({ customerId: customer.id, dressId: dress.id, pickupDate: futureDate(16), returnDate: futureDate(18), depositAmount: 50 });
    assert.ok(later.reservationNumber);
  } finally {
    cleanup();
  }
});

test('buffer expansion and overlap are pure, inspectable rules', () => {
  installStorage();
  try {
    saveAppPreferences({ ...DEFAULT_APP_PREFERENCES, preparationDaysBeforePickup: 1, cleaningDaysAfterReturn: 2 });
    const expanded = expandPeriodWithBuffers(
      { pickupDate: '2026-03-10', returnDate: '2026-03-12' },
      { preparationDaysBeforePickup: 1, cleaningDaysAfterReturn: 2 },
    );
    assert.deepEqual(expanded, { pickupDate: '2026-03-09', returnDate: '2026-03-14' });
    assert.equal(periodsOverlap(expanded, { pickupDate: '2026-03-14', returnDate: '2026-03-15' }), true);
    assert.equal(periodsOverlap(expanded, { pickupDate: '2026-03-15', returnDate: '2026-03-16' }), false);
  } finally {
    cleanup();
  }
});

test('a cancelled reservation releases the item immediately', () => {
  installStorage();
  try {
    const { customer, dress } = seed();
    const reservation = createReservation({ customerId: customer.id, dressId: dress.id, pickupDate: futureDate(3), returnDate: futureDate(6), depositAmount: 50 });

    cancelReservation(reservation.id);
    assert.equal(getReservations().find((item) => item.id === reservation.id).status, 'cancelled');

    const replacement = createReservation({ customerId: customer.id, dressId: dress.id, pickupDate: futureDate(4), returnDate: futureDate(7), depositAmount: 50 });
    assert.ok(replacement.reservationNumber);
  } finally {
    cleanup();
  }
});

test('a completed (returned) reservation does not block a new booking', () => {
  installStorage();
  try {
    const { customer, dress } = seed();
    const reservation = createReservation({ customerId: customer.id, dressId: dress.id, pickupDate: futureDate(3), returnDate: futureDate(6), depositAmount: 50 });
    writeCollection('reservations', getReservations().map((item) => (item.id === reservation.id ? { ...item, status: 'returned' } : item)));

    assert.equal(isActiveReservation({ status: 'returned' }), false);
    const replacement = createReservation({ customerId: customer.id, dressId: dress.id, pickupDate: futureDate(4), returnDate: futureDate(7), depositAmount: 50 });
    assert.ok(replacement.reservationNumber);
  } finally {
    cleanup();
  }
});

test('rescheduling into an occupied period is rejected and leaves the reservation untouched', () => {
  installStorage();
  try {
    const { customer, dress } = seed();
    const first = createReservation({ customerId: customer.id, dressId: dress.id, pickupDate: futureDate(3), returnDate: futureDate(5), depositAmount: 50 });
    const second = createReservation({ customerId: customer.id, dressId: dress.id, pickupDate: futureDate(10), returnDate: futureDate(12), depositAmount: 50 });

    assert.throws(
      () => rescheduleReservation({ reservationNumber: second.reservationNumber, pickupDate: futureDate(4), returnDate: futureDate(6) }),
      /محجوز ضمن الحجز/,
    );

    const stored = getReservations().find((item) => item.reservationNumber === second.reservationNumber);
    assert.equal(stored.pickupDate, futureDate(10));
    assert.equal(stored.returnDate, futureDate(12));
    assert.equal(first.reservationNumber !== second.reservationNumber, true);
  } finally {
    cleanup();
  }
});

test('a reservation can be moved inside its own period without self-conflict', () => {
  installStorage();
  try {
    const { customer, dress } = seed();
    const reservation = createReservation({ customerId: customer.id, dressId: dress.id, pickupDate: futureDate(3), returnDate: futureDate(5), depositAmount: 50 });

    const moved = rescheduleReservation({
      reservationNumber: reservation.reservationNumber,
      pickupDate: futureDate(4),
      pickupTime: '11:30',
      returnDate: futureDate(6),
      returnTime: '19:00',
    });

    assert.equal(moved.pickupDate, futureDate(4));
    assert.equal(moved.pickupTime, '11:30');
    assert.equal(moved.returnTime, '19:00');
  } finally {
    cleanup();
  }
});

test('extending the rental is rejected when it runs into another booking', () => {
  installStorage();
  try {
    const { customer, dress } = seed();
    const first = createReservation({ customerId: customer.id, dressId: dress.id, pickupDate: futureDate(3), returnDate: futureDate(5), depositAmount: 50 });
    createReservation({ customerId: customer.id, dressId: dress.id, pickupDate: futureDate(7), returnDate: futureDate(9), depositAmount: 50 });

    assert.throws(
      () => rescheduleReservation({ reservationNumber: first.reservationNumber, pickupDate: futureDate(3), returnDate: futureDate(8) }),
      /محجوز ضمن الحجز/,
    );
  } finally {
    cleanup();
  }
});

test('changing the dress re-checks the conflict rule against the new item', () => {
  installStorage();
  try {
    const { customer, dress, other } = seed();
    createReservation({ customerId: customer.id, dressId: other.id, pickupDate: futureDate(3), returnDate: futureDate(6), depositAmount: 50 });
    const moveable = createReservation({ customerId: customer.id, dressId: dress.id, pickupDate: futureDate(4), returnDate: futureDate(5), depositAmount: 50 });

    assert.throws(
      () => rescheduleReservation({ reservationNumber: moveable.reservationNumber, pickupDate: futureDate(4), returnDate: futureDate(5), dressId: other.id }),
      /محجوز ضمن الحجز/,
    );

    const stored = getReservations().find((item) => item.reservationNumber === moveable.reservationNumber);
    assert.equal(stored.dressCode, dress.code);
  } finally {
    cleanup();
  }
});

test('an accessory cannot be attached to two overlapping active reservations', () => {
  installStorage();
  try {
    const { customer, dress, other } = seed();
    const accessory = addAccessory({ name: 'طرحة دانتيل', category: 'veil' });
    const first = createReservation({ customerId: customer.id, dressId: dress.id, pickupDate: futureDate(3), returnDate: futureDate(6), depositAmount: 50 });
    const second = createReservation({ customerId: customer.id, dressId: other.id, pickupDate: futureDate(5), returnDate: futureDate(8), depositAmount: 50 });

    attachAccessoryToReservation({ reservationNumber: first.reservationNumber, accessoryId: accessory.id });
    assert.throws(
      () => attachAccessoryToReservation({ reservationNumber: second.reservationNumber, accessoryId: accessory.id }),
      /الملحق محجوز ضمن الحجز/,
    );
  } finally {
    cleanup();
  }
});

test('rescheduling a reservation re-checks its attached accessories', () => {
  installStorage();
  try {
    const { customer, dress, other } = seed();
    const accessory = addAccessory({ name: 'تاج كريستال', category: 'crown' });
    const first = createReservation({ customerId: customer.id, dressId: dress.id, pickupDate: futureDate(3), returnDate: futureDate(5), depositAmount: 50 });
    const second = createReservation({ customerId: customer.id, dressId: other.id, pickupDate: futureDate(10), returnDate: futureDate(12), depositAmount: 50 });

    attachAccessoryToReservation({ reservationNumber: first.reservationNumber, accessoryId: accessory.id });
    attachAccessoryToReservation({ reservationNumber: second.reservationNumber, accessoryId: accessory.id });

    // Moving the second booking onto the first one's period collides on the accessory,
    // even though the dresses themselves are different.
    assert.throws(
      () => rescheduleReservation({ reservationNumber: second.reservationNumber, pickupDate: futureDate(4), returnDate: futureDate(6) }),
      /الملحق محجوز ضمن الحجز/,
    );
  } finally {
    cleanup();
  }
});

test('reservation times fall back to the configured defaults', () => {
  installStorage();
  try {
    const { customer, dress } = seed();
    saveAppPreferences({ ...DEFAULT_APP_PREFERENCES, defaultPickupTime: '09:30', defaultReturnTime: '21:15' });
    const withoutTimes = createReservation({ customerId: customer.id, dressId: dress.id, pickupDate: futureDate(3), returnDate: futureDate(5), depositAmount: 50 });

    assert.deepEqual(getReservationTimes(withoutTimes), { pickupTime: '09:30', returnTime: '21:15' });

    const withTimes = { ...withoutTimes, pickupTime: '13:00', returnTime: '17:45' };
    assert.deepEqual(getReservationTimes(withTimes), { pickupTime: '13:00', returnTime: '17:45' });
  } finally {
    cleanup();
  }
});

test('an invalid time is rejected at the service layer, not only in the form', () => {
  installStorage();
  try {
    const { customer, dress } = seed();
    assert.throws(
      () => createReservation({ customerId: customer.id, dressId: dress.id, pickupDate: futureDate(3), pickupTime: '25:99', returnDate: futureDate(5), depositAmount: 50 }),
      /وقت الاستلام غير صالح/,
    );
    assert.equal(getReservations().length, 0);
  } finally {
    cleanup();
  }
});

test('hasReservationOverlap and findItemConflicts agree on the same rule', () => {
  installStorage();
  try {
    const { customer, dress } = seed();
    createReservation({ customerId: customer.id, dressId: dress.id, pickupDate: futureDate(3), returnDate: futureDate(6), depositAmount: 50 });
    const reservations = getReservations();
    const check = { inventoryItemId: dress.id, dressCode: dress.code, pickupDate: futureDate(5), returnDate: futureDate(7) };

    assert.equal(hasReservationOverlap(check, reservations), true);
    assert.equal(findItemConflicts(check, reservations).length, 1);
  } finally {
    cleanup();
  }
});
