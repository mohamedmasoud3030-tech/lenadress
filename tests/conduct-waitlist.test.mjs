import test from 'node:test';
import assert from 'node:assert/strict';
import { installStorage, uninstallStorage, todayISO, nowDateTimeLocal } from './helpers/storage.mjs';
import {
  REGISTERED_COLLECTIONS,
  readCollection,
  resetCountersForTesting,
  writeCollection,
} from '../src/engines/persistence/index.ts';
import { setCommandFailurePoint } from '../src/engines/workflows/index.ts';
import { addCustomer, getCustomers } from '../src/features/customers/customer.service.ts';
import { addDress } from '../src/features/dresses/dress.service.ts';
import { addDressDesign, addDesignVariants } from '../src/features/dresses/design.service.ts';
import { createReservationCommand } from '../src/features/workflows/reservationCommands.ts';
import { completeDeliveryCommand, completeReturnCommand } from '../src/features/workflows/deliveryReturnCommands.ts';
import { addConductNote, getCustomerConduct } from '../src/features/customers/customerConduct.service.ts';
import {
  addWaitlistEntry,
  closeWaitlistEntry,
  getWaitlistEntries,
  getWaitlistOpportunities,
  markWaitlistNotified,
} from '../src/features/waitlist/waitlist.service.ts';
import { getAuditLog } from '../src/features/audit/audit.service.ts';
import { getCurrentOperatorName, setCurrentOperatorName, addOperator, getActiveOperators } from '../src/features/operators/operator.service.ts';
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
  saveAppPreferences({ ...DEFAULT_APP_PREFERENCES, preparationDaysBeforePickup: 0, cleaningDaysAfterReturn: 0 });
  return { customer: addCustomer({ name: 'مريم', phone: '90000070', status: 'normal' }) };
}

function reschedule(reservationNumber, pickupOffset, returnOffset) {
  writeCollection('reservations', readCollection('reservations', []).map((item) => (
    item.reservationNumber === reservationNumber
      ? { ...item, pickupDate: addDaysISO(today, pickupOffset), returnDate: addDaysISO(today, returnOffset) }
      : item
  )));
}

function refreshed(customer) {
  return getCustomers().find((item) => item.id === customer.id);
}

test('the new collections are registered so they survive a backup', () => {
  for (const collection of ['operators', 'customer-conduct-notes', 'waitlist']) {
    assert.ok(REGISTERED_COLLECTIONS.includes(collection), `${collection} must be registered`);
  }
});

// --- Operator attribution -------------------------------------------------

test('every audited action records who performed it', () => {
  installStorage();
  try {
    const { customer } = seed();
    const dress = addDress(dressInput);

    setCurrentOperatorName('سارة');
    createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: addDaysISO(today, 2),
      returnDate: addDaysISO(today, 4),
      depositAmount: 0,
      idempotencyKey: 'attributed',
    });

    const entry = getAuditLog().find((item) => item.entityType === 'reservation');
    assert.equal(entry.performedBy, 'سارة', 'the log must answer who did this');
  } finally {
    cleanup();
  }
});

test('switching the operator changes attribution from that point on', () => {
  installStorage();
  try {
    const { customer } = seed();
    const first = addDress(dressInput);
    const second = addDress({ ...dressInput, name: 'فستان ثانٍ' });

    setCurrentOperatorName('سارة');
    createReservationCommand({
      customerId: customer.id, dressId: first.id,
      pickupDate: addDaysISO(today, 2), returnDate: addDaysISO(today, 4),
      depositAmount: 0, idempotencyKey: 'by-sara',
    });

    setCurrentOperatorName('هدى');
    createReservationCommand({
      customerId: customer.id, dressId: second.id,
      pickupDate: addDaysISO(today, 6), returnDate: addDaysISO(today, 8),
      depositAmount: 0, idempotencyKey: 'by-huda',
    });

    const authors = getAuditLog().filter((item) => item.entityType === 'reservation').map((item) => item.performedBy);
    assert.ok(authors.includes('سارة'));
    assert.ok(authors.includes('هدى'));
    // Earlier entries are never rewritten to the new operator.
    assert.equal(authors.filter((name) => name === 'سارة').length, 1);
  } finally {
    cleanup();
  }
});

test('an operator list can be managed and falls back to a default', () => {
  installStorage();
  try {
    assert.equal(getCurrentOperatorName(), 'المعرض', 'a fresh device attributes to the showroom');

    addOperator('سارة');
    assert.throws(() => addOperator('سارة'), /نفس الاسم/);
    assert.throws(() => addOperator('   '), /مطلوب/);
    assert.equal(getActiveOperators().length, 1);
  } finally {
    cleanup();
  }
});

// --- Customer conduct -----------------------------------------------------

test('a clean customer has no advisories and a high reliability score', () => {
  installStorage();
  try {
    const { customer } = seed();
    const conduct = getCustomerConduct(customer);

    assert.deepEqual(conduct.advisories, []);
    assert.equal(conduct.lateReturnCount, 0);
    assert.equal(conduct.damageCount, 0);
    assert.ok(conduct.reliabilityScore >= 90);
  } finally {
    cleanup();
  }
});

test('a late return is derived from the delivery record, not typed by hand', () => {
  installStorage();
  try {
    const { customer } = seed();
    const dress = addDress(dressInput);
    const reservation = createReservationCommand({
      customerId: customer.id, dressId: dress.id,
      pickupDate: today, returnDate: addDaysISO(today, 2),
      depositAmount: 0, idempotencyKey: 'late-rsv',
    });
    completeDeliveryCommand({
      reservationNumber: reservation.reservationNumber,
      deliveryDateTime: nowDateTimeLocal(),
      idempotencyKey: 'late-deliver',
    });
    completeReturnCommand({
      reservationNumber: reservation.reservationNumber,
      returnDateTime: nowDateTimeLocal(),
      lateFee: 15,
      damageFee: 0,
      refundMethod: 'cash',
      nextItemStatus: 'inspection',
      idempotencyKey: 'late-return',
    });

    const conduct = getCustomerConduct(refreshed(customer));
    assert.equal(conduct.lateReturnCount, 1);
    assert.equal(conduct.totalPenalties, 15);
    assert.ok(conduct.events.some((event) => event.kind === 'late_return' && event.derived));
  } finally {
    cleanup();
  }
});

test('a damage charge is severe and pushes the suggested status to warning', () => {
  installStorage();
  try {
    const { customer } = seed();
    const dress = addDress(dressInput);
    const reservation = createReservationCommand({
      customerId: customer.id, dressId: dress.id,
      pickupDate: today, returnDate: addDaysISO(today, 2),
      depositAmount: 0, idempotencyKey: 'dmg-rsv',
    });
    completeDeliveryCommand({
      reservationNumber: reservation.reservationNumber,
      deliveryDateTime: nowDateTimeLocal(),
      idempotencyKey: 'dmg-deliver',
    });
    completeReturnCommand({
      reservationNumber: reservation.reservationNumber,
      returnDateTime: nowDateTimeLocal(),
      lateFee: 0,
      damageFee: 40,
      refundMethod: 'cash',
      nextItemStatus: 'damaged',
      idempotencyKey: 'dmg-return',
    });

    const conduct = getCustomerConduct(refreshed(customer));
    assert.equal(conduct.damageCount, 1);
    assert.equal(conduct.suggestedStatus, 'warning');
    assert.ok(conduct.advisories.some((advisory) => advisory.includes('تلف')));
  } finally {
    cleanup();
  }
});

test('a booking whose pickup date passed uncollected counts as a no-show', () => {
  installStorage();
  try {
    const { customer } = seed();
    const dress = addDress(dressInput);
    const reservation = createReservationCommand({
      customerId: customer.id, dressId: dress.id,
      pickupDate: addDaysISO(today, 2), returnDate: addDaysISO(today, 4),
      depositAmount: 0, idempotencyKey: 'noshow',
    });
    // Never delivered, never cancelled, and the date has passed: nobody came.
    reschedule(reservation.reservationNumber, -5, -3);

    const conduct = getCustomerConduct(refreshed(customer));
    assert.equal(conduct.noShowCount, 1);
    assert.ok(conduct.advisories.some((advisory) => advisory.includes('لم تحضر')));
  } finally {
    cleanup();
  }
});

test('two no-shows suggest blocking the customer', () => {
  installStorage();
  try {
    const { customer } = seed();
    const first = addDress(dressInput);
    const second = addDress({ ...dressInput, name: 'ثانٍ' });

    ['a', 'b'].forEach((key, index) => {
      const dress = index === 0 ? first : second;
      const reservation = createReservationCommand({
        customerId: customer.id, dressId: dress.id,
        pickupDate: addDaysISO(today, 2 + index * 4), returnDate: addDaysISO(today, 3 + index * 4),
        depositAmount: 0, idempotencyKey: `noshow-${key}`,
      });
      reschedule(reservation.reservationNumber, -8 + index * 2, -7 + index * 2);
    });

    assert.equal(getCustomerConduct(refreshed(customer)).suggestedStatus, 'blocked');
  } finally {
    cleanup();
  }
});

test('a manual note records its author and appears as not derived', () => {
  installStorage();
  try {
    const { customer } = seed();
    setCurrentOperatorName('هدى');

    addConductNote({
      customerId: customer.id,
      kind: 'manual_note',
      severity: 'warning',
      note: 'تأخرت في الرد على الاتصالات.',
    });

    const conduct = getCustomerConduct(customer);
    const note = conduct.events.find((event) => !event.derived);
    assert.ok(note);
    assert.match(note.description, /هدى/, 'a judgement about a customer must not be anonymous');
    assert.throws(() => addConductNote({ customerId: customer.id, kind: 'manual_note', severity: 'warning', note: '  ' }), /مطلوب/);
  } finally {
    cleanup();
  }
});

// --- Waiting list ---------------------------------------------------------

function seedDesignWithOnePiece() {
  const design = addDressDesign({
    name: 'فستان مطلوب',
    category: 'زفاف',
    defaultRentalPrice: 100,
    defaultSalePrice: 400,
    defaultDepositAmount: 0,
  });
  const [piece] = addDesignVariants(design.id, [{ size: 'M', color: 'أبيض' }]);
  return { design, piece };
}

test('a waitlist entry is rejected for an invalid or past period', () => {
  installStorage();
  try {
    const { customer } = seed();
    const { design } = seedDesignWithOnePiece();

    assert.throws(() => addWaitlistEntry({
      customerId: customer.id, designId: design.id,
      pickupDate: addDaysISO(today, 5), returnDate: addDaysISO(today, 3),
    }), /بعد تاريخ الاستلام/);

    assert.throws(() => addWaitlistEntry({
      customerId: customer.id, designId: design.id,
      pickupDate: addDaysISO(today, -9), returnDate: addDaysISO(today, -8),
    }), /انتهت بالفعل/);

    assert.throws(() => addWaitlistEntry({
      customerId: customer.id,
      pickupDate: addDaysISO(today, 3), returnDate: addDaysISO(today, 5),
    }), /تصميماً أو قطعة/);

    assert.equal(getWaitlistEntries().length, 0);
  } finally {
    cleanup();
  }
});

test('the same customer cannot be queued twice for the same want and period', () => {
  installStorage();
  try {
    const { customer } = seed();
    const { design } = seedDesignWithOnePiece();
    const request = {
      customerId: customer.id, designId: design.id,
      pickupDate: addDaysISO(today, 3), returnDate: addDaysISO(today, 5),
    };

    addWaitlistEntry(request);
    assert.throws(() => addWaitlistEntry(request), /مسجّلة بالفعل/);
    assert.equal(getWaitlistEntries().length, 1);
  } finally {
    cleanup();
  }
});

test('a want is not an opportunity while the piece is still booked', () => {
  installStorage();
  try {
    const { customer } = seed();
    const other = addCustomer({ name: 'سارة', phone: '90000071', status: 'normal' });
    const { design, piece } = seedDesignWithOnePiece();

    const period = { pickupDate: addDaysISO(today, 3), returnDate: addDaysISO(today, 5) };
    createReservationCommand({
      customerId: other.id, dressId: piece.id,
      pickupDate: period.pickupDate, returnDate: period.returnDate,
      depositAmount: 0, idempotencyKey: 'blocking',
    });

    addWaitlistEntry({ customerId: customer.id, designId: design.id, ...period });
    assert.equal(getWaitlistOpportunities().length, 0, 'the period is taken');
  } finally {
    cleanup();
  }
});

test('cancelling the blocking booking turns the want into an opportunity', () => {
  installStorage();
  try {
    const { customer } = seed();
    const other = addCustomer({ name: 'سارة', phone: '90000072', status: 'normal' });
    const { design, piece } = seedDesignWithOnePiece();

    const period = { pickupDate: addDaysISO(today, 3), returnDate: addDaysISO(today, 5) };
    const blocking = createReservationCommand({
      customerId: other.id, dressId: piece.id,
      pickupDate: period.pickupDate, returnDate: period.returnDate,
      depositAmount: 0, idempotencyKey: 'to-cancel',
    });
    addWaitlistEntry({ customerId: customer.id, designId: design.id, ...period });

    writeCollection('reservations', readCollection('reservations', []).map((item) => (
      item.reservationNumber === blocking.reservationNumber ? { ...item, status: 'cancelled' } : item
    )));

    const opportunities = getWaitlistOpportunities();
    assert.equal(opportunities.length, 1, 'the freed slot must reach the waiting customer');
    assert.deepEqual(opportunities[0].availableCodes, [piece.code]);
    assert.match(opportunities[0].message, /مريم/);
    assert.match(opportunities[0].message, /فستان مطلوب/);
  } finally {
    cleanup();
  }
});

test('opportunities are ordered by who asked first', () => {
  installStorage();
  try {
    const first = addCustomer({ name: 'أولى', phone: '90000073', status: 'normal' });
    const second = addCustomer({ name: 'ثانية', phone: '90000074', status: 'normal' });
    saveAppPreferences({ ...DEFAULT_APP_PREFERENCES, preparationDaysBeforePickup: 0, cleaningDaysAfterReturn: 0 });
    const { design } = seedDesignWithOnePiece();
    const period = { pickupDate: addDaysISO(today, 3), returnDate: addDaysISO(today, 5) };

    const early = addWaitlistEntry({ customerId: first.id, designId: design.id, ...period });
    const late = addWaitlistEntry({ customerId: second.id, designId: design.id, ...period });
    // Force a distinguishable order regardless of clock resolution.
    writeCollection('waitlist', getWaitlistEntries().map((entry) => (
      entry.id === early.id ? { ...entry, createdAt: '2026-01-01T00:00:00.000Z' }
        : entry.id === late.id ? { ...entry, createdAt: '2026-06-01T00:00:00.000Z' } : entry
    )));

    const order = getWaitlistOpportunities().map((opportunity) => opportunity.entry.customerName);
    assert.deepEqual(order, ['أولى', 'ثانية'], 'the queue must be honoured');
  } finally {
    cleanup();
  }
});

test('a closed entry stops being offered, a notified one keeps being offered', () => {
  installStorage();
  try {
    const { customer } = seed();
    const { design } = seedDesignWithOnePiece();
    const period = { pickupDate: addDaysISO(today, 3), returnDate: addDaysISO(today, 5) };
    const entry = addWaitlistEntry({ customerId: customer.id, designId: design.id, ...period });

    markWaitlistNotified(entry.id);
    assert.equal(getWaitlistOpportunities().length, 1, 'a contacted customer may still not have replied');

    closeWaitlistEntry(entry.id);
    assert.equal(getWaitlistOpportunities().length, 0);
    assert.equal(getWaitlistEntries()[0].status, 'closed');
  } finally {
    cleanup();
  }
});

test('a size-specific want is not satisfied by a different size', () => {
  installStorage();
  try {
    const { customer } = seed();
    const design = addDressDesign({
      name: 'متعدد المقاسات',
      category: 'زفاف',
      defaultRentalPrice: 100,
      defaultSalePrice: 400,
      defaultDepositAmount: 0,
    });
    addDesignVariants(design.id, [{ size: 'S', color: 'أبيض' }]);

    addWaitlistEntry({
      customerId: customer.id,
      designId: design.id,
      size: 'XL',
      pickupDate: addDaysISO(today, 3),
      returnDate: addDaysISO(today, 5),
    });

    assert.equal(getWaitlistOpportunities().length, 0, 'only her size counts as available');
  } finally {
    cleanup();
  }
});
