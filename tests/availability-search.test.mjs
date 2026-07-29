import test from 'node:test';
import assert from 'node:assert/strict';
import { installStorage, uninstallStorage, futureDate } from './helpers/storage.mjs';
import { resetCountersForTesting } from '../src/engines/persistence/index.ts';
import { addCustomer } from '../src/features/customers/customer.service.ts';
import { addDress, updateDress } from '../src/features/dresses/dress.service.ts';
import { addDressDesign, addDesignVariants } from '../src/features/dresses/design.service.ts';
import { addAccessory } from '../src/features/accessories/accessory.service.ts';
import { attachAccessoryToReservation } from '../src/features/accessories/reservationAccessory.service.ts';
import { createReservation } from '../src/features/reservations/reservation.service.ts';
import {
  searchAvailability,
  searchAvailableAccessories,
  searchAvailabilityWithAccessories,
} from '../src/features/availability/availability.service.ts';

function baseDress(overrides = {}) {
  return {
    name: 'فستان زفاف كلاسيكي',
    description: '',
    category: 'زفاف',
    color: 'أبيض',
    size: '42',
    purchasePrice: 300,
    rentalPrice: 80,
    salePrice: 600,
    depositAmount: 50,
    status: 'available',
    isForRent: true,
    isForSale: false,
    images: [],
    barcode: '',
    ...overrides,
  };
}

function setup() {
  installStorage();
  resetCountersForTesting();
}

function teardown() {
  uninstallStorage();
}

test('an empty catalogue returns an empty result rather than throwing', () => {
  setup();
  try {
    const result = searchAvailability({ pickupDate: futureDate(10), returnDate: futureDate(12) });
    assert.equal(result.items.length, 0);
    assert.equal(result.summary.availableItems, 0);
  } finally {
    teardown();
  }
});

test('a free piece is offered for the requested period', () => {
  setup();
  try {
    const dress = addDress(baseDress());
    const result = searchAvailability({ pickupDate: futureDate(10), returnDate: futureDate(12) });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].dress.code, dress.code);
    assert.equal(result.items[0].available, true);
    assert.equal(result.items[0].reason, undefined);
  } finally {
    teardown();
  }
});

test('the requested duration is reported in nights', () => {
  setup();
  try {
    const result = searchAvailability({ pickupDate: futureDate(10), returnDate: futureDate(13) });
    assert.equal(result.durationDays, 3);
  } finally {
    teardown();
  }
});

test('a period whose return precedes its pickup is refused', () => {
  setup();
  try {
    assert.throws(
      () => searchAvailability({ pickupDate: futureDate(12), returnDate: futureDate(10) }),
      /تاريخ الإرجاع/,
    );
  } finally {
    teardown();
  }
});

test('a booked piece is hidden by default', () => {
  setup();
  try {
    const customer = addCustomer({ name: 'نورة', phone: '+968 9191 8186', status: 'active' });
    const dress = addDress(baseDress());
    createReservation({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: futureDate(10),
      returnDate: futureDate(12),
      depositAmount: 50,
    });

    const result = searchAvailability({ pickupDate: futureDate(11), returnDate: futureDate(13) });
    assert.equal(result.items.length, 0, 'an overlapping piece must not be offered');
    assert.equal(result.summary.busyItems, 1);
  } finally {
    teardown();
  }
});

test('a booked piece can be shown with its reason and its blocking reservation', () => {
  setup();
  try {
    const customer = addCustomer({ name: 'نورة', phone: '+968 9191 8186', status: 'active' });
    const dress = addDress(baseDress());
    const reservation = createReservation({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: futureDate(10),
      returnDate: futureDate(12),
      depositAmount: 50,
    });

    const result = searchAvailability({
      pickupDate: futureDate(11),
      returnDate: futureDate(13),
      includeUnavailable: true,
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].available, false);
    assert.equal(result.items[0].reason, 'booked');
    assert.equal(result.items[0].conflicts[0].reservationNumber, reservation.reservationNumber);
  } finally {
    teardown();
  }
});

test('a booked piece carries the next date it is free for the same duration', () => {
  setup();
  try {
    const customer = addCustomer({ name: 'نورة', phone: '+968 9191 8186', status: 'active' });
    const dress = addDress(baseDress());
    createReservation({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: futureDate(10),
      returnDate: futureDate(12),
      depositAmount: 50,
    });

    const result = searchAvailability({
      pickupDate: futureDate(11),
      returnDate: futureDate(13),
      includeUnavailable: true,
    });
    const suggestion = result.items[0].nextFreeDate;
    assert.ok(suggestion, 'the operator must be able to counter-offer a date instead of saying no');
    assert.ok(suggestion > futureDate(12), 'the suggestion must clear the existing booking');
  } finally {
    teardown();
  }
});

test('a piece the showroom does not rent is never offered', () => {
  setup();
  try {
    addDress(baseDress({ isForRent: false, isForSale: true }));
    const result = searchAvailability({ pickupDate: futureDate(10), returnDate: futureDate(12), includeUnavailable: true });
    assert.equal(result.items[0].available, false);
    assert.equal(result.items[0].reason, 'not_for_rent');
  } finally {
    teardown();
  }
});

test('a damaged piece reports damage rather than a booking clash', () => {
  setup();
  try {
    const dress = addDress(baseDress());
    updateDress(dress.code, { status: 'damaged' });
    const result = searchAvailability({ pickupDate: futureDate(10), returnDate: futureDate(12), includeUnavailable: true });
    assert.equal(result.items[0].reason, 'damaged');
    assert.equal(result.items[0].conflicts.length, 0, 'a status refusal must not run the calendar check');
  } finally {
    teardown();
  }
});

test('a piece in the laundry is reported as in service', () => {
  setup();
  try {
    const dress = addDress(baseDress());
    updateDress(dress.code, { status: 'laundry' });
    const result = searchAvailability({ pickupDate: futureDate(10), returnDate: futureDate(12), includeUnavailable: true });
    assert.equal(result.items[0].reason, 'in_service');
  } finally {
    teardown();
  }
});

test('the size filter matches exactly and never by substring', () => {
  setup();
  try {
    addDress(baseDress({ name: 'فستان مقاس أربعة', size: '4' }));
    addDress(baseDress({ name: 'فستان مقاس اثنين وأربعين', size: '42' }));

    const result = searchAvailability({ pickupDate: futureDate(10), returnDate: futureDate(12), size: '4' });
    assert.equal(result.items.length, 1, 'size 4 must not also return size 42');
    assert.equal(result.items[0].dress.size, '4');
  } finally {
    teardown();
  }
});

test('the colour filter matches as a substring so a shade still counts', () => {
  setup();
  try {
    addDress(baseDress({ color: 'أبيض عاجي' }));
    const result = searchAvailability({ pickupDate: futureDate(10), returnDate: futureDate(12), color: 'ابيض' });
    assert.equal(result.items.length, 1, 'the customer says the base colour, the showroom records the shade');
  } finally {
    teardown();
  }
});

test('the price range narrows the offer on both ends', () => {
  setup();
  try {
    addDress(baseDress({ name: 'رخيص', rentalPrice: 30 }));
    addDress(baseDress({ name: 'متوسط', rentalPrice: 80 }));
    addDress(baseDress({ name: 'غالي', rentalPrice: 200 }));

    const result = searchAvailability({
      pickupDate: futureDate(10),
      returnDate: futureDate(12),
      minRentalPrice: 50,
      maxRentalPrice: 100,
    });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].dress.rentalPrice, 80);
  } finally {
    teardown();
  }
});

test('the free-text filter folds Arabic variants like every other search', () => {
  setup();
  try {
    addDress(baseDress({ name: 'فستان مطرّز' }));
    const result = searchAvailability({ pickupDate: futureDate(10), returnDate: futureDate(12), search: 'مطرز' });
    assert.equal(result.items.length, 1);
  } finally {
    teardown();
  }
});

test('results are ordered available first, then cheapest', () => {
  setup();
  try {
    addDress(baseDress({ name: 'غالي', rentalPrice: 200 }));
    addDress(baseDress({ name: 'رخيص', rentalPrice: 30 }));
    const result = searchAvailability({ pickupDate: futureDate(10), returnDate: futureDate(12) });
    assert.deepEqual(result.items.map((item) => item.dress.rentalPrice), [30, 200]);
  } finally {
    teardown();
  }
});

test('a busy piece suggests a free sibling of the same design', () => {
  setup();
  try {
    const design = addDressDesign({
      name: 'حورية البحر العاجية',
      category: 'زفاف',
      defaultRentalPrice: 90,
      defaultSalePrice: 500,
      defaultDepositAmount: 50,
    });
    const [small, large] = addDesignVariants(design.id, [
      { size: '40', color: 'أبيض', quantity: 1 },
      { size: '44', color: 'أبيض', quantity: 1 },
    ]);

    const customer = addCustomer({ name: 'نورة', phone: '+968 9191 8186', status: 'active' });
    createReservation({
      customerId: customer.id,
      dressId: small.id,
      pickupDate: futureDate(10),
      returnDate: futureDate(12),
      depositAmount: 50,
    });

    const result = searchAvailability({
      pickupDate: futureDate(11),
      returnDate: futureDate(13),
      includeUnavailable: true,
    });
    const busy = result.items.find((item) => item.dress.code === small.code);
    assert.ok(busy, 'the busy piece must still be listed when unavailable items are included');
    assert.deepEqual(busy.alternativePieceCodes, [large.code]);
  } finally {
    teardown();
  }
});

test('the summary lists the sizes and colours actually available', () => {
  setup();
  try {
    addDress(baseDress({ size: '40', color: 'أبيض' }));
    addDress(baseDress({ size: '44', color: 'ذهبي' }));
    const result = searchAvailability({ pickupDate: futureDate(10), returnDate: futureDate(12) });
    assert.deepEqual(result.summary.sizes, ['40', '44']);
    assert.deepEqual(result.summary.colors.sort(), ['أبيض', 'ذهبي'].sort());
  } finally {
    teardown();
  }
});

test('a free accessory is offered for the period', () => {
  setup();
  try {
    addAccessory({ name: 'طرحة طويلة', category: 'veil', rentalPrice: 10 });
    const found = searchAvailableAccessories(futureDate(10), futureDate(12));
    assert.equal(found.length, 1);
    assert.equal(found[0].available, true);
  } finally {
    teardown();
  }
});

test('an accessory attached to an overlapping reservation is not offered', () => {
  setup();
  try {
    const customer = addCustomer({ name: 'نورة', phone: '+968 9191 8186', status: 'active' });
    const dress = addDress(baseDress());
    const reservation = createReservation({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: futureDate(10),
      returnDate: futureDate(12),
      depositAmount: 50,
    });
    const accessory = addAccessory({ name: 'طرحة طويلة', category: 'veil', rentalPrice: 10 });
    attachAccessoryToReservation({
      reservationNumber: reservation.reservationNumber,
      accessoryId: accessory.id,
    });

    const found = searchAvailableAccessories(futureDate(11), futureDate(13));
    assert.equal(found.length, 0);

    const withBusy = searchAvailableAccessories(futureDate(11), futureDate(13), { includeUnavailable: true });
    assert.equal(withBusy[0].reason, 'booked');
    assert.equal(withBusy[0].conflicts[0].reservationNumber, reservation.reservationNumber);
  } finally {
    teardown();
  }
});

test('a retired accessory is never offered', () => {
  setup();
  try {
    addAccessory({ name: 'تاج قديم', category: 'crown', rentalPrice: 5, status: 'retired' });
    const found = searchAvailableAccessories(futureDate(10), futureDate(12));
    assert.equal(found.length, 0);
  } finally {
    teardown();
  }
});

test('the combined search reports both pieces and accessories in one summary', () => {
  setup();
  try {
    addDress(baseDress());
    addAccessory({ name: 'طرحة طويلة', category: 'veil', rentalPrice: 10 });
    const result = searchAvailabilityWithAccessories({
      pickupDate: futureDate(10),
      returnDate: futureDate(12),
    });
    assert.equal(result.summary.availableItems, 1);
    assert.equal(result.summary.availableAccessories, 1);
    assert.equal(result.accessories.length, 1);
  } finally {
    teardown();
  }
});

test('availability never contradicts the booking rule that would run on save', () => {
  setup();
  try {
    const customer = addCustomer({ name: 'نورة', phone: '+968 9191 8186', status: 'active' });
    const dress = addDress(baseDress());
    const result = searchAvailability({ pickupDate: futureDate(20), returnDate: futureDate(22) });
    assert.equal(result.items.length, 1, 'the screen promises the piece');

    // The promise must hold: the write path enforces the same central rule, so
    // creating the reservation the screen offered can never be refused.
    const reservation = createReservation({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: futureDate(20),
      returnDate: futureDate(22),
      depositAmount: 50,
    });
    assert.ok(reservation.reservationNumber);
  } finally {
    teardown();
  }
});
