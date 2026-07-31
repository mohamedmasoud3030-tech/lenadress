import test from 'node:test';
import assert from 'node:assert/strict';
import { installStorage, uninstallStorage, futureDate } from './helpers/storage.mjs';
import { resetCountersForTesting } from '../src/engines/persistence/index.ts';
import { addCustomer } from '../src/features/customers/customer.service.ts';
import { addDress, getDresses } from '../src/features/dresses/dress.service.ts';
import {
  createReservation,
  deliverContractLine,
  getReservations,
  returnContractLine,
} from '../src/features/reservations/reservation.service.ts';
import { DEFAULT_APP_PREFERENCES, saveAppPreferences } from '../src/features/preferences/preferences.service.ts';

function cleanup() {
  resetCountersForTesting();
  uninstallStorage();
}

const dressInput = {
  name: 'فستان زفاف',
  description: '',
  itemType: 'dress',
  category: 'زفاف',
  color: 'أبيض',
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
  saveAppPreferences({ ...DEFAULT_APP_PREFERENCES, preparationDaysBeforePickup: 0, cleaningDaysAfterReturn: 0 });
  const customer = addCustomer({ name: 'سارة', phone: '90000001', status: 'normal' });
  const dress1 = addDress({ ...dressInput, name: 'فستان زفاف' });
  const dress2 = addDress({ ...dressInput, name: 'فستان استقبال', category: 'سهرة' });
  return { customer, dress1, dress2 };
}

function createTwoLineReservation(customer, dress1, dress2) {
  return createReservation({
    customerId: customer.id,
    pickupDate: futureDate(3),
    returnDate: futureDate(5),
    depositAmount: 0,
    rentalPrice: 0,
    lines: [
      { dressId: dress1.id, rentalPrice: 40, depositAmount: 20 },
      { dressId: dress2.id, rentalPrice: 35, depositAmount: 15 },
    ],
  });
}

function deliverLine(input) {
  return deliverContractLine({
    paymentOverrideReason: 'تجاوز دفع مخصص لاختبار دورة البند',
    ...input,
  });
}

// ── deliverContractLine ──────────────────────────────────────────────────

test('deliverContractLine marks the line delivered and updates the dress status to rented', () => {
  installStorage();
  try {
    const { customer, dress1, dress2 } = seed();
    const reservation = createTwoLineReservation(customer, dress1, dress2);
    const line1 = reservation.lines.find((l) => l.dressCodeSnapshot === dress1.code);

    const updated = deliverLine({
      reservationNumber: reservation.reservationNumber,
      lineId: line1.id,
      deliveryDateTime: new Date().toISOString(),
    });

    const updatedLine = updated.lines.find((l) => l.id === line1.id);
    assert.equal(updatedLine.deliveryStatus, 'delivered');

    const dress = getDresses().find((d) => d.id === dress1.id);
    assert.equal(dress.status, 'rented');

    // The sibling line must be untouched
    const line2 = updated.lines.find((l) => l.dressCodeSnapshot === dress2.code);
    assert.equal(line2.deliveryStatus, 'pending_delivery');
    const dress2After = getDresses().find((d) => d.id === dress2.id);
    assert.notEqual(dress2After.status, 'rented');
  } finally {
    cleanup();
  }
});

test('deliverContractLine stores delivery photos and notes on the line', () => {
  installStorage();
  try {
    const { customer, dress1, dress2 } = seed();
    const reservation = createTwoLineReservation(customer, dress1, dress2);
    const line1 = reservation.lines.find((l) => l.dressCodeSnapshot === dress1.code);
    const photo = {
      id: 'photo-1',
      dataUrl: 'data:image/webp;base64,AA==',
      capturedAt: new Date().toISOString(),
    };

    const updated = deliverLine({
      reservationNumber: reservation.reservationNumber,
      lineId: line1.id,
      deliveryDateTime: new Date().toISOString(),
      deliveryPhotos: [photo],
      notes: 'تم الفحص قبل التسليم',
    });

    const updatedLine = updated.lines.find((l) => l.id === line1.id);
    assert.equal(updatedLine.deliveryPhotos?.length, 1);
    assert.equal(updatedLine.notes, 'تم الفحص قبل التسليم');
  } finally {
    cleanup();
  }
});

test('deliverContractLine rejects a line that was already delivered', () => {
  installStorage();
  try {
    const { customer, dress1, dress2 } = seed();
    const reservation = createTwoLineReservation(customer, dress1, dress2);
    const line1 = reservation.lines.find((l) => l.dressCodeSnapshot === dress1.code);

    deliverLine({
      reservationNumber: reservation.reservationNumber,
      lineId: line1.id,
      deliveryDateTime: new Date().toISOString(),
    });

    assert.throws(() => {
      deliverLine({
        reservationNumber: reservation.reservationNumber,
        lineId: line1.id,
        deliveryDateTime: new Date().toISOString(),
      });
    }, /تم تسليمه بالفعل/);
  } finally {
    cleanup();
  }
});

test('deliverContractLine throws for an unknown reservation number', () => {
  installStorage();
  try {
    seed();
    assert.throws(() => {
      deliverLine({
        reservationNumber: 'NOPE-0000',
        lineId: 'missing-line',
        deliveryDateTime: new Date().toISOString(),
      });
    }, /الحجز المحدد غير موجود/);
  } finally {
    cleanup();
  }
});

test('deliverContractLine throws for an unknown line id on a real reservation', () => {
  installStorage();
  try {
    const { customer, dress1, dress2 } = seed();
    const reservation = createTwoLineReservation(customer, dress1, dress2);

    assert.throws(() => {
      deliverLine({
        reservationNumber: reservation.reservationNumber,
        lineId: 'not-a-real-line-id',
        deliveryDateTime: new Date().toISOString(),
      });
    }, /البند المحدد غير موجود/);
  } finally {
    cleanup();
  }
});

// ── returnContractLine ───────────────────────────────────────────────────

test('returnContractLine marks the line returned and applies the requested dress status', () => {
  installStorage();
  try {
    const { customer, dress1, dress2 } = seed();
    const reservation = createTwoLineReservation(customer, dress1, dress2);
    const line1 = reservation.lines.find((l) => l.dressCodeSnapshot === dress1.code);

    deliverLine({
      reservationNumber: reservation.reservationNumber,
      lineId: line1.id,
      deliveryDateTime: new Date().toISOString(),
    });

    const updated = returnContractLine({
      reservationNumber: reservation.reservationNumber,
      lineId: line1.id,
      returnDateTime: new Date().toISOString(),
      lateFee: 0,
      damageFee: 0,
      nextItemStatus: 'laundry',
    });

    const updatedLine = updated.lines.find((l) => l.id === line1.id);
    assert.equal(updatedLine.deliveryStatus, 'returned');

    const dress = getDresses().find((d) => d.id === dress1.id);
    assert.equal(dress.status, 'laundry');
  } finally {
    cleanup();
  }
});

test('returnContractLine closes a late return and accumulates its fees once', () => {
  installStorage();
  try {
    const { customer, dress1, dress2 } = seed();
    const reservation = createTwoLineReservation(customer, dress1, dress2);
    const line1 = reservation.lines.find((l) => l.dressCodeSnapshot === dress1.code);

    deliverLine({
      reservationNumber: reservation.reservationNumber,
      lineId: line1.id,
      deliveryDateTime: new Date().toISOString(),
    });

    const updated = returnContractLine({
      reservationNumber: reservation.reservationNumber,
      lineId: line1.id,
      returnDateTime: new Date().toISOString(),
      lateFee: 20,
      damageFee: 5,
      nextItemStatus: 'inspection',
    });

    const updatedLine = updated.lines.find((l) => l.id === line1.id);
    assert.equal(updatedLine.deliveryStatus, 'returned');
    assert.equal(updatedLine.lateFee, 20);
    assert.equal(updatedLine.damageFee, 5);
    assert.equal(updated.assessedFeesAmount, 25);
  } finally {
    cleanup();
  }
});

test('returnContractLine rejects a line that has not been delivered yet', () => {
  installStorage();
  try {
    const { customer, dress1, dress2 } = seed();
    const reservation = createTwoLineReservation(customer, dress1, dress2);
    const line1 = reservation.lines.find((l) => l.dressCodeSnapshot === dress1.code);

    assert.throws(() => {
      returnContractLine({
        reservationNumber: reservation.reservationNumber,
        lineId: line1.id,
        returnDateTime: new Date().toISOString(),
        lateFee: 0,
        damageFee: 0,
        nextItemStatus: 'inspection',
      });
    }, /لم يتم تسليمه بعد/);
  } finally {
    cleanup();
  }
});

test('returnContractLine rejects a second return and cannot duplicate fees', () => {
  installStorage();
  try {
    const { customer, dress1, dress2 } = seed();
    const reservation = createTwoLineReservation(customer, dress1, dress2);
    const line1 = reservation.lines.find((l) => l.dressCodeSnapshot === dress1.code);

    deliverLine({
      reservationNumber: reservation.reservationNumber,
      lineId: line1.id,
      deliveryDateTime: new Date().toISOString(),
    });

    returnContractLine({
      reservationNumber: reservation.reservationNumber,
      lineId: line1.id,
      returnDateTime: new Date().toISOString(),
      lateFee: 10,
      damageFee: 0,
      nextItemStatus: 'inspection',
    });

    assert.throws(
      () => returnContractLine({
        reservationNumber: reservation.reservationNumber,
        lineId: line1.id,
        returnDateTime: new Date().toISOString(),
        lateFee: 10,
        damageFee: 0,
        nextItemStatus: 'laundry',
      }),
      /تم استرجاع هذا البند بالفعل/,
    );
    assert.equal(getReservations()[0].assessedFeesAmount, 10);
  } finally {
    cleanup();
  }
});

test('returnContractLine throws for an unknown reservation number', () => {
  installStorage();
  try {
    seed();
    assert.throws(() => {
      returnContractLine({
        reservationNumber: 'NOPE-0000',
        lineId: 'missing-line',
        returnDateTime: new Date().toISOString(),
        lateFee: 0,
        damageFee: 0,
        nextItemStatus: 'inspection',
      });
    }, /الحجز المحدد غير موجود/);
  } finally {
    cleanup();
  }
});

test('returnContractLine throws for an unknown line id on a real reservation', () => {
  installStorage();
  try {
    const { customer, dress1, dress2 } = seed();
    const reservation = createTwoLineReservation(customer, dress1, dress2);

    assert.throws(() => {
      returnContractLine({
        reservationNumber: reservation.reservationNumber,
        lineId: 'not-a-real-line-id',
        returnDateTime: new Date().toISOString(),
        lateFee: 0,
        damageFee: 0,
        nextItemStatus: 'inspection',
      });
    }, /البند المحدد غير موجود/);
  } finally {
    cleanup();
  }
});

test('delivering and returning one line does not affect the sibling line status', () => {
  installStorage();
  try {
    const { customer, dress1, dress2 } = seed();
    const reservation = createTwoLineReservation(customer, dress1, dress2);
    const line1 = reservation.lines.find((l) => l.dressCodeSnapshot === dress1.code);

    deliverLine({
      reservationNumber: reservation.reservationNumber,
      lineId: line1.id,
      deliveryDateTime: new Date().toISOString(),
    });
    const finalState = returnContractLine({
      reservationNumber: reservation.reservationNumber,
      lineId: line1.id,
      returnDateTime: new Date().toISOString(),
      lateFee: 0,
      damageFee: 0,
      nextItemStatus: 'inspection',
    });

    const line2 = finalState.lines.find((l) => l.dressCodeSnapshot === dress2.code);
    assert.equal(line2.deliveryStatus, 'pending_delivery');

    // dress2 was never delivered/returned, so its status must remain exactly
    // what it was seeded with.
    const dress2After = getDresses().find((d) => d.id === dress2.id);
    assert.equal(dress2After.status, 'available');
  } finally {
    cleanup();
  }
});
