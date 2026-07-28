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
import { completeDeliveryCommand } from '../src/features/workflows/deliveryReturnCommands.ts';
import { attachAccessoryCommand } from '../src/features/workflows/accessoryCommands.ts';
import { postExpenseCommand } from '../src/features/workflows/expenseCommands.ts';
import { getDashboardSnapshot, isShowroomEmpty } from '../src/features/dashboard/dashboard.service.ts';
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

function seed() {
  saveAppPreferences({
    ...DEFAULT_APP_PREFERENCES,
    preparationDaysBeforePickup: 0,
    cleaningDaysAfterReturn: 0,
    defaultPickupTime: '10:00',
    defaultReturnTime: '20:00',
  });
  const customer = addCustomer({ name: 'مريم', phone: '90000030', status: 'normal' });
  return { customer };
}

test('an untouched showroom is reported as empty so onboarding is shown', () => {
  installStorage();
  try {
    assert.equal(isShowroomEmpty(), true);

    addDress(dressInput);
    assert.equal(isShowroomEmpty(), false, 'a single item means the showroom has started');
  } finally {
    cleanup();
  }
});

test("today's pickups and returns are listed separately and ordered by time", () => {
  installStorage();
  try {
    const { customer } = seed();
    const first = addDress(dressInput);
    const second = addDress({ ...dressInput, name: 'فستان ثانٍ' });
    const third = addDress({ ...dressInput, name: 'فستان ثالث' });

    // Two pickups today, deliberately created out of chronological order.
    createReservationCommand({
      customerId: customer.id, dressId: first.id, pickupDate: today, pickupTime: '17:00',
      returnDate: addDaysISO(today, 2), depositAmount: 0, idempotencyKey: 'p-late',
    });
    createReservationCommand({
      customerId: customer.id, dressId: second.id, pickupDate: today, pickupTime: '09:00',
      returnDate: addDaysISO(today, 2), depositAmount: 0, idempotencyKey: 'p-early',
    });
    // A delivered booking due back today. The service refuses a same-day period,
    // so it is created forward and then aged in storage, like real data would be.
    const returning = createReservationCommand({
      customerId: customer.id, dressId: third.id, pickupDate: today, returnTime: '19:30',
      returnDate: addDaysISO(today, 1), depositAmount: 0, idempotencyKey: 'r-today',
    });
    completeDeliveryCommand({
      reservationNumber: returning.reservationNumber,
      deliveryDateTime: nowDateTimeLocal(),
      idempotencyKey: 'r-today-deliver',
    });
    writeCollection('reservations', readCollection('reservations', []).map((item) => (
      item.reservationNumber === returning.reservationNumber
        ? { ...item, pickupDate: addDaysISO(today, -1), returnDate: today }
        : item
    )));

    const snapshot = getDashboardSnapshot();

    assert.deepEqual(snapshot.pickupsToday.map((task) => task.time), ['09:00', '17:00'], 'pickups are ordered by time');
    assert.equal(snapshot.returnsToday.length, 1);
    assert.equal(snapshot.returnsToday[0].time, '19:30');
    assert.equal(snapshot.reservations.today, 3);
    // A booking that has already been delivered is no longer waiting for pickup.
    assert.equal(snapshot.pickupsToday.some((task) => task.reservation.reservationNumber === returning.reservationNumber), false);
  } finally {
    cleanup();
  }
});

test('a booking with no explicit time falls back to the configured default', () => {
  installStorage();
  try {
    const { customer } = seed();
    const dress = addDress(dressInput);
    createReservationCommand({
      customerId: customer.id, dressId: dress.id, pickupDate: today,
      returnDate: addDaysISO(today, 1), depositAmount: 0, idempotencyKey: 'default-time',
    });

    assert.equal(getDashboardSnapshot().pickupsToday[0].time, '10:00');
  } finally {
    cleanup();
  }
});

test('uncollected money is totalled, counted and ordered for collection', () => {
  installStorage();
  try {
    const { customer } = seed();
    const first = addDress(dressInput);
    const second = addDress({ ...dressInput, name: 'فستان ثانٍ', rentalPrice: 40 });

    const big = createReservationCommand({
      customerId: customer.id, dressId: first.id, pickupDate: addDaysISO(today, 3),
      returnDate: addDaysISO(today, 5), depositAmount: 0, idempotencyKey: 'owe-big',
    });
    const small = createReservationCommand({
      customerId: customer.id, dressId: second.id, pickupDate: addDaysISO(today, 3),
      returnDate: addDaysISO(today, 5), depositAmount: 0, idempotencyKey: 'owe-small',
    });

    const snapshot = getDashboardSnapshot();
    assert.equal(snapshot.money.outstandingCount, 2);
    assert.equal(snapshot.money.outstandingTotal, 140);
    // Largest first when neither is overdue: that is the collection order.
    assert.equal(snapshot.outstandingBalances[0].reservationNumber, big.reservationNumber);
    assert.equal(snapshot.outstandingBalances[1].reservationNumber, small.reservationNumber);
    assert.equal(snapshot.outstandingBalances.every((row) => row.isOverdue === false), true);
  } finally {
    cleanup();
  }
});

test('money owed on a finished rental is flagged overdue and sorted first', () => {
  installStorage();
  try {
    const { customer } = seed();
    const past = addDress(dressInput);
    const future = addDress({ ...dressInput, name: 'فستان قادم', rentalPrice: 500 });

    const overdue = createReservationCommand({
      customerId: customer.id, dressId: past.id, pickupDate: addDaysISO(today, 1),
      returnDate: addDaysISO(today, 2), depositAmount: 0, idempotencyKey: 'owe-past',
    });
    createReservationCommand({
      customerId: customer.id, dressId: future.id, pickupDate: addDaysISO(today, 10),
      returnDate: addDaysISO(today, 12), depositAmount: 0, idempotencyKey: 'owe-future',
    });

    // Age the first booking so its rental period has ended with money still owed.
    writeCollection('reservations', readCollection('reservations', []).map((item) => (
      item.reservationNumber === overdue.reservationNumber
        ? { ...item, pickupDate: addDaysISO(today, -6), returnDate: addDaysISO(today, -4) }
        : item
    )));

    const snapshot = getDashboardSnapshot();
    assert.equal(snapshot.outstandingBalances[0].reservationNumber, overdue.reservationNumber, 'overdue money is collected first');
    assert.equal(snapshot.outstandingBalances[0].isOverdue, true);
    assert.equal(snapshot.money.outstandingOverdueTotal, 100);
    // The larger, not-yet-due balance is still counted in the total.
    assert.equal(snapshot.money.outstandingTotal, 600);
  } finally {
    cleanup();
  }
});

test('a fully paid booking disappears from the uncollected list', () => {
  installStorage();
  try {
    const { customer } = seed();
    const dress = addDress(dressInput);
    const reservation = createReservationCommand({
      customerId: customer.id, dressId: dress.id, pickupDate: addDaysISO(today, 2),
      returnDate: addDaysISO(today, 4), depositAmount: 0, idempotencyKey: 'paid',
    });

    assert.equal(getDashboardSnapshot().money.outstandingCount, 1);

    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today, type: 'rental', method: 'cash', amount: 100,
      idempotencyKey: 'paid-pay',
    });

    const snapshot = getDashboardSnapshot();
    assert.equal(snapshot.money.outstandingCount, 0);
    assert.equal(snapshot.money.outstandingTotal, 0);
    assert.equal(snapshot.money.collectedToday, 100);
  } finally {
    cleanup();
  }
});

test("today's cash movement matches the finance layer, not a screen total", () => {
  installStorage();
  try {
    const { customer } = seed();
    const dress = addDress(dressInput);
    const reservation = createReservationCommand({
      customerId: customer.id, dressId: dress.id, pickupDate: addDaysISO(today, 1),
      returnDate: addDaysISO(today, 3), depositAmount: 0, idempotencyKey: 'cash-1',
    });
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today, type: 'rental', method: 'cash', amount: 100,
      idempotencyKey: 'cash-pay',
    });
    postExpenseCommand({
      expenseDate: today, title: 'تنظيف', category: 'laundry', amount: 30,
      paymentMethod: 'cash', relatedDressCode: dress.code, idempotencyKey: 'cash-exp',
    });

    const { money } = getDashboardSnapshot();
    assert.equal(money.collectedToday, 100);
    assert.equal(money.expensesToday, 30);
    assert.equal(money.netToday, 70);
  } finally {
    cleanup();
  }
});

test('an overdue return is surfaced as its own actionable list', () => {
  installStorage();
  try {
    const { customer } = seed();
    const dress = addDress(dressInput);
    const reservation = createReservationCommand({
      customerId: customer.id, dressId: dress.id, pickupDate: today,
      returnDate: addDaysISO(today, 1), depositAmount: 0, idempotencyKey: 'late-1',
    });
    completeDeliveryCommand({
      reservationNumber: reservation.reservationNumber,
      deliveryDateTime: nowDateTimeLocal(),
      idempotencyKey: 'late-deliver',
    });
    writeCollection('reservations', readCollection('reservations', []).map((item) => (
      item.reservationNumber === reservation.reservationNumber
        ? { ...item, pickupDate: addDaysISO(today, -5), returnDate: addDaysISO(today, -2) }
        : item
    )));

    const snapshot = getDashboardSnapshot();
    assert.equal(snapshot.reservations.overdue, 1);
    assert.equal(snapshot.overdueReturns.length, 1);
    assert.equal(snapshot.overdueReturns[0].reservation.status, 'overdue');
  } finally {
    cleanup();
  }
});

test('accessories attached to a booking are counted on its task row and while out', () => {
  installStorage();
  try {
    const { customer } = seed();
    const dress = addDress(dressInput);
    const veil = addAccessory({ name: 'طرحة', category: 'veil' });
    const crown = addAccessory({ name: 'تاج', category: 'crown' });
    const reservation = createReservationCommand({
      customerId: customer.id, dressId: dress.id, pickupDate: today,
      returnDate: addDaysISO(today, 2), depositAmount: 0, idempotencyKey: 'acc-dash',
    });
    attachAccessoryCommand({ reservationNumber: reservation.reservationNumber, accessoryId: veil.id });
    attachAccessoryCommand({ reservationNumber: reservation.reservationNumber, accessoryId: crown.id });

    let snapshot = getDashboardSnapshot();
    assert.equal(snapshot.pickupsToday[0].accessoryCount, 2, 'the counter must know what to prepare');
    assert.equal(snapshot.accessoriesOutCount, 0, 'nothing has left the showroom yet');

    completeDeliveryCommand({
      reservationNumber: reservation.reservationNumber,
      deliveryDateTime: nowDateTimeLocal(),
      deliveredAccessoryIds: [veil.id],
      idempotencyKey: 'acc-dash-deliver',
    });

    snapshot = getDashboardSnapshot();
    assert.equal(snapshot.accessoriesOutCount, 1, 'only the delivered accessory is out');
    assert.equal(snapshot.accessories.total, 2);
  } finally {
    cleanup();
  }
});

test('a cancelled booking leaves the board entirely', () => {
  installStorage();
  try {
    const { customer } = seed();
    const dress = addDress(dressInput);
    const reservation = createReservationCommand({
      customerId: customer.id, dressId: dress.id, pickupDate: today,
      returnDate: addDaysISO(today, 2), depositAmount: 0, idempotencyKey: 'cancel-dash',
    });

    assert.equal(getDashboardSnapshot().pickupsToday.length, 1);

    writeCollection('reservations', readCollection('reservations', []).map((item) => (
      item.reservationNumber === reservation.reservationNumber ? { ...item, status: 'cancelled' } : item
    )));

    const snapshot = getDashboardSnapshot();
    assert.equal(snapshot.pickupsToday.length, 0);
    assert.equal(snapshot.reservations.active, 0);
    assert.equal(snapshot.money.outstandingCount, 0, 'a cancelled booking is not money owed');
  } finally {
    cleanup();
  }
});

test('the coming week is previewed without counting today twice', () => {
  installStorage();
  try {
    const { customer } = seed();
    const soon = addDress(dressInput);
    const later = addDress({ ...dressInput, name: 'بعيد' });
    const todayDress = addDress({ ...dressInput, name: 'اليوم' });

    createReservationCommand({
      customerId: customer.id, dressId: todayDress.id, pickupDate: today,
      returnDate: addDaysISO(today, 1), depositAmount: 0, idempotencyKey: 'week-today',
    });
    createReservationCommand({
      customerId: customer.id, dressId: soon.id, pickupDate: addDaysISO(today, 4),
      returnDate: addDaysISO(today, 5), depositAmount: 0, idempotencyKey: 'week-soon',
    });
    createReservationCommand({
      customerId: customer.id, dressId: later.id, pickupDate: addDaysISO(today, 20),
      returnDate: addDaysISO(today, 21), depositAmount: 0, idempotencyKey: 'week-later',
    });

    const snapshot = getDashboardSnapshot();
    assert.equal(snapshot.reservations.upcomingWeek, 1, 'only the booking inside the next seven days counts');
  } finally {
    cleanup();
  }
});
