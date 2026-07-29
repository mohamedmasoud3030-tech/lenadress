import test from 'node:test';
import assert from 'node:assert/strict';
import { installStorage, uninstallStorage, todayISO, nowDateTimeLocal } from './helpers/storage.mjs';
import { readCollection, resetCountersForTesting, writeCollection, REGISTERED_COLLECTIONS } from '../src/engines/persistence/index.ts';
import { setCommandFailurePoint } from '../src/engines/workflows/index.ts';
import { addCustomer } from '../src/features/customers/customer.service.ts';
import { addDress } from '../src/features/dresses/dress.service.ts';
import { addAccessory } from '../src/features/accessories/accessory.service.ts';
import { createReservationCommand } from '../src/features/workflows/reservationCommands.ts';
import { attachAccessoryCommand } from '../src/features/workflows/accessoryCommands.ts';
import { completeDeliveryCommand } from '../src/features/workflows/deliveryReturnCommands.ts';
import { recordPaymentCommand } from '../src/features/workflows/paymentCommands.ts';
import {
  dismissReminder,
  getReminders,
  isReminderHandledToday,
  summarizeReminders,
} from '../src/features/reminders/reminder.service.ts';
import {
  buildWhatsAppLink,
  MessagingError,
  toWhatsAppNumber,
} from '../src/platform/messaging/whatsapp.ts';
import { DEFAULT_APP_PREFERENCES, saveAppPreferences } from '../src/features/preferences/preferences.service.ts';
import { addDaysISO } from '../src/shared/utils/date.ts';

function cleanup() {
  setCommandFailurePoint(null);
  resetCountersForTesting();
  uninstallStorage();
}

const today = todayISO();
const tomorrow = addDaysISO(today, 1);

const dressInput = {
  name: 'فستان زفاف',
  description: '',
  itemType: 'dress',
  category: 'زفاف',
  color: 'أبيض',
  size: 'M',
  purchasePrice: 0,
  rentalPrice: 100,
  salePrice: 500,
  depositAmount: 0,
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
  return { customer: addCustomer({ name: 'مريم', phone: '90000060', status: 'normal' }) };
}

/** Moves a stored booking onto specific dates, for histories the service refuses to create. */
function reschedule(reservationNumber, pickupOffset, returnOffset) {
  writeCollection('reservations', readCollection('reservations', []).map((item) => (
    item.reservationNumber === reservationNumber
      ? { ...item, pickupDate: addDaysISO(today, pickupOffset), returnDate: addDaysISO(today, returnOffset) }
      : item
  )));
}

test('the dismissal collection is registered so it survives a backup', () => {
  assert.ok(REGISTERED_COLLECTIONS.includes('reminder-dismissals'));
});

test('a local Omani number is given its country code, an international one is left alone', () => {
  // wa.me would otherwise reject a bare 8-digit number or route it elsewhere.
  assert.equal(toWhatsAppNumber('90000060'), '96890000060');
  assert.equal(toWhatsAppNumber('9000 0060'), '96890000060');
  assert.equal(toWhatsAppNumber('+968 9000 0060'), '96890000060');
  assert.equal(toWhatsAppNumber('00968 90000060'), '96890000060');
  assert.equal(toWhatsAppNumber('971501234567'), '971501234567');
  assert.throws(() => toWhatsAppNumber('لا يوجد'), MessagingError);
});

test('the WhatsApp link carries the message safely encoded', () => {
  const link = buildWhatsAppLink('90000060', 'مرحباً مريم\nرقم الحجز: RSV-1 & 2');

  assert.ok(link.startsWith('https://wa.me/96890000060?text='));
  // Newlines and ampersands must not break out of the query parameter.
  assert.ok(link.includes('%0A'));
  assert.ok(link.includes('%26'));
  assert.equal(link.includes('\n'), false);
});

test("a pickup due tomorrow raises a reminder with its time and accessories", () => {
  installStorage();
  try {
    const { customer } = seed();
    const dress = addDress(dressInput);
    const veil = addAccessory({ name: 'طرحة دانتيل', category: 'veil' });

    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: tomorrow,
      pickupTime: '11:30',
      returnDate: addDaysISO(today, 3),
      depositAmount: 0,
      idempotencyKey: 'pickup-tomorrow',
    });
    attachAccessoryCommand({ reservationNumber: reservation.reservationNumber, accessoryId: veil.id });

    const reminder = getReminders().find((item) => item.kind === 'pickup_tomorrow');
    assert.ok(reminder);
    assert.equal(reminder.customerName, 'مريم');
    assert.match(reminder.message, /11:30 ص/, 'the customer needs the time, not just the date');
    assert.match(reminder.message, /طرحة دانتيل/, 'she must know what to expect to receive');
    assert.match(reminder.message, new RegExp(reservation.reservationNumber));
  } finally {
    cleanup();
  }
});

test('a return due tomorrow only reminds once the item is actually out', () => {
  installStorage();
  try {
    const { customer } = seed();
    const dress = addDress(dressInput);
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: tomorrow,
      depositAmount: 0,
      idempotencyKey: 'return-tomorrow',
    });

    // Still not delivered: reminding her to return it would be wrong.
    assert.equal(getReminders().some((item) => item.kind === 'return_tomorrow'), false);

    completeDeliveryCommand({
      reservationNumber: reservation.reservationNumber,
      deliveryDateTime: nowDateTimeLocal(),
      idempotencyKey: 'deliver-it',
    });

    const reminder = getReminders().find((item) => item.kind === 'return_tomorrow');
    assert.ok(reminder);
    assert.equal(reminder.urgency, 'warning');
    assert.match(reminder.message, /8:00 م/);
  } finally {
    cleanup();
  }
});

test('an overdue item is critical and stays until it comes back', () => {
  installStorage();
  try {
    const { customer } = seed();
    const dress = addDress(dressInput);
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: addDaysISO(today, 2),
      depositAmount: 0,
      idempotencyKey: 'late-one',
    });
    completeDeliveryCommand({
      reservationNumber: reservation.reservationNumber,
      deliveryDateTime: nowDateTimeLocal(),
      idempotencyKey: 'late-deliver',
    });
    reschedule(reservation.reservationNumber, -6, -3);

    const reminder = getReminders().find((item) => item.kind === 'overdue_return');
    assert.ok(reminder);
    assert.equal(reminder.urgency, 'critical');
    assert.match(reminder.message, /رسوم التأخير/);
  } finally {
    cleanup();
  }
});

test('money owed is urgent once the rental has ended, informational before', () => {
  installStorage();
  try {
    const { customer } = seed();
    const future = addDress(dressInput);
    const past = addDress({ ...dressInput, name: 'فستان منتهٍ' });

    createReservationCommand({
      customerId: customer.id,
      dressId: future.id,
      pickupDate: addDaysISO(today, 10),
      returnDate: addDaysISO(today, 12),
      depositAmount: 0,
      idempotencyKey: 'owed-future',
    });
    const ended = createReservationCommand({
      customerId: customer.id,
      dressId: past.id,
      pickupDate: addDaysISO(today, 1),
      returnDate: addDaysISO(today, 2),
      depositAmount: 0,
      idempotencyKey: 'owed-past',
    });
    reschedule(ended.reservationNumber, -5, -3);

    const balances = getReminders().filter((item) => item.kind === 'outstanding_balance');
    assert.equal(balances.length, 2);

    const overdueMoney = balances.find((item) => item.reservation.reservationNumber === ended.reservationNumber);
    assert.equal(overdueMoney.urgency, 'critical', 'money owed on a finished rental is urgent');
    assert.equal(overdueMoney.amount, 100);
    // Critical entries sort first, so the operator chases the right one.
    assert.equal(getReminders()[0].urgency, 'critical');
  } finally {
    cleanup();
  }
});

test('a fully paid, on-time booking raises no reminder at all', () => {
  installStorage();
  try {
    const { customer } = seed();
    const dress = addDress(dressInput);
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: addDaysISO(today, 10),
      returnDate: addDaysISO(today, 12),
      depositAmount: 0,
      idempotencyKey: 'quiet',
    });
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'rental',
      method: 'cash',
      amount: 100,
      idempotencyKey: 'quiet-pay',
    });

    assert.deepEqual(getReminders(), [], 'no news is no reminder');
  } finally {
    cleanup();
  }
});

test('a cancelled booking never chases the customer', () => {
  installStorage();
  try {
    const { customer } = seed();
    const dress = addDress(dressInput);
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: tomorrow,
      returnDate: addDaysISO(today, 3),
      depositAmount: 0,
      idempotencyKey: 'cancel-me',
    });
    writeCollection('reservations', readCollection('reservations', []).map((item) => (
      item.reservationNumber === reservation.reservationNumber ? { ...item, status: 'cancelled' } : item
    )));

    assert.deepEqual(getReminders(), []);
  } finally {
    cleanup();
  }
});

test('following up hides the reminder for today and is recorded', () => {
  installStorage();
  try {
    const { customer } = seed();
    const dress = addDress(dressInput);
    createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: tomorrow,
      returnDate: addDaysISO(today, 3),
      depositAmount: 0,
      idempotencyKey: 'dismiss-me',
    });

    const reminder = getReminders().find((item) => item.kind === 'pickup_tomorrow');
    dismissReminder(reminder.id, 'whatsapp');

    assert.equal(isReminderHandledToday(reminder.id), true);
    assert.equal(getReminders().some((item) => item.id === reminder.id), false);
    // It is hidden, not deleted: the operator can review what was sent.
    assert.equal(getReminders(true).some((item) => item.id === reminder.id), true);
    assert.equal(readCollection('reminder-dismissals', [])[0].channel, 'whatsapp');
  } finally {
    cleanup();
  }
});

test('following up twice on the same day does not duplicate the record', () => {
  installStorage();
  try {
    const { customer } = seed();
    const dress = addDress(dressInput);
    createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: tomorrow,
      returnDate: addDaysISO(today, 3),
      depositAmount: 0,
      idempotencyKey: 'dismiss-twice',
    });
    const reminder = getReminders()[0];

    dismissReminder(reminder.id, 'whatsapp');
    dismissReminder(reminder.id, 'manual');

    assert.equal(readCollection('reminder-dismissals', []).length, 1);
  } finally {
    cleanup();
  }
});

test("yesterday's follow-up does not silence a still-overdue item today", () => {
  installStorage();
  try {
    const { customer } = seed();
    const dress = addDress(dressInput);
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: addDaysISO(today, 2),
      depositAmount: 0,
      idempotencyKey: 'still-late',
    });
    completeDeliveryCommand({
      reservationNumber: reservation.reservationNumber,
      deliveryDateTime: nowDateTimeLocal(),
      idempotencyKey: 'still-late-deliver',
    });
    reschedule(reservation.reservationNumber, -6, -3);

    const reminder = getReminders().find((item) => item.kind === 'overdue_return');
    // A dismissal recorded against yesterday must not carry over.
    writeCollection('reminder-dismissals', [{
      id: 'old',
      reminderId: reminder.id,
      dismissedAt: new Date().toISOString(),
      businessDate: addDaysISO(today, -1),
      channel: 'whatsapp',
    }]);

    assert.equal(isReminderHandledToday(reminder.id), false);
    assert.equal(getReminders().some((item) => item.id === reminder.id), true, 'an item still out is chased again');
  } finally {
    cleanup();
  }
});

test('the summary counts each follow-up type for the dashboard', () => {
  installStorage();
  try {
    const { customer } = seed();
    const pickup = addDress(dressInput);
    const late = addDress({ ...dressInput, name: 'متأخر' });

    createReservationCommand({
      customerId: customer.id,
      dressId: pickup.id,
      pickupDate: tomorrow,
      returnDate: addDaysISO(today, 3),
      depositAmount: 0,
      idempotencyKey: 'sum-pickup',
    });
    const overdue = createReservationCommand({
      customerId: customer.id,
      dressId: late.id,
      pickupDate: today,
      returnDate: addDaysISO(today, 2),
      depositAmount: 0,
      idempotencyKey: 'sum-late',
    });
    completeDeliveryCommand({
      reservationNumber: overdue.reservationNumber,
      deliveryDateTime: nowDateTimeLocal(),
      idempotencyKey: 'sum-late-deliver',
    });
    reschedule(overdue.reservationNumber, -6, -3);

    const summary = summarizeReminders(getReminders());
    assert.equal(summary.pickupTomorrow, 1);
    assert.equal(summary.overdue, 1);
    assert.equal(summary.unpaid, 2, 'neither booking has been paid');
    assert.ok(summary.critical >= 1);
  } finally {
    cleanup();
  }
});
