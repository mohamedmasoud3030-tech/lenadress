import test from 'node:test';
import assert from 'node:assert/strict';
import { installStorage, uninstallStorage, futureDate, nowDateTimeLocal } from './helpers/storage.mjs';
import {
  REGISTERED_COLLECTIONS,
  readCollection,
  resetCountersForTesting,
  writeCollection,
} from '../src/engines/persistence/index.ts';
import { addCustomer } from '../src/features/customers/customer.service.ts';
import { addDress, updateDress } from '../src/features/dresses/dress.service.ts';
import { addAccessory } from '../src/features/accessories/accessory.service.ts';
import { attachAccessoryToReservation } from '../src/features/accessories/reservationAccessory.service.ts';
import { createReservation } from '../src/features/reservations/reservation.service.ts';
import { completeDeliveryCommand } from '../src/features/workflows/deliveryReturnCommands.ts';
import { getAuditLog } from '../src/features/audit/audit.service.ts';
import {
  buildStocktakeReport,
  cancelStocktakeSession,
  completeStocktakeSession,
  getOpenStocktakeSession,
  getStocktakeSessions,
  recordStocktakeScan,
  removeStocktakeScan,
  resolveStocktakeItem,
  startStocktakeSession,
} from '../src/features/stocktake/stocktake.service.ts';

function setup() {
  installStorage();
  resetCountersForTesting();
}

function makeDress(overrides = {}) {
  return addDress({
    name: 'فستان زفاف',
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
  });
}

/** Books a dress and delivers it, so it is legitimately out of the building. */
function sendDressOut(dress) {
  const customer = addCustomer({ name: 'نورة', phone: `+968 9191 ${Math.floor(1000 + getStocktakeSessions().length)}`, status: 'active' });
  const reservation = createReservation({
    customerId: customer.id,
    dressId: dress.id,
    pickupDate: futureDate(1),
    returnDate: futureDate(3),
    depositAmount: 50,
  });

  const stored = readCollection('reservations', []);
  writeCollection('reservations', stored.map((item) => (
    item.id === reservation.id ? { ...item, pickupDate: futureDate(0), returnDate: futureDate(2) } : item
  )));

  completeDeliveryCommand({
    paymentOverrideReason: 'تجاوز سداد مخصص لسيناريو الاختبار',
    reservationNumber: reservation.reservationNumber,
    deliveryDateTime: nowDateTimeLocal(),
  });
  return reservation;
}

test('the stocktake collection is registered so sessions survive a backup', () => {
  assert.ok(REGISTERED_COLLECTIONS.includes('stocktake-sessions'));
});

test('starting a session allocates a monotonic reference', () => {
  setup();
  try {
    const first = startStocktakeSession('رف الزفاف');
    assert.match(first.sessionNumber, /^STK-\d+$/);
    assert.equal(first.status, 'open');
    assert.equal(first.scope, 'رف الزفاف');
  } finally {
    uninstallStorage();
  }
});

test('only one session may be open at a time', () => {
  setup();
  try {
    startStocktakeSession();
    // Two concurrent counts would each see half the scans and both would report
    // the other half missing.
    assert.throws(() => startStocktakeSession(), /جلسة جرد مفتوحة/);
  } finally {
    uninstallStorage();
  }
});

test('a new session may be started once the previous one is closed', () => {
  setup();
  try {
    const first = startStocktakeSession();
    completeStocktakeSession(first.id);
    const second = startStocktakeSession();
    assert.notEqual(second.sessionNumber, first.sessionNumber);
  } finally {
    uninstallStorage();
  }
});

test('an item resolves from its stock code', () => {
  setup();
  try {
    const dress = makeDress();
    const resolved = resolveStocktakeItem(dress.code);
    assert.equal(resolved.itemId, dress.id);
    assert.equal(resolved.kind, 'dress');
  } finally {
    uninstallStorage();
  }
});

test('an item resolves from its barcode, which is what a scanner emits', () => {
  setup();
  try {
    const dress = makeDress();
    const resolved = resolveStocktakeItem(dress.barcode);
    assert.equal(resolved.itemId, dress.id);
  } finally {
    uninstallStorage();
  }
});

test('accessories resolve through the same flow as dresses', () => {
  setup();
  try {
    const accessory = addAccessory({ name: 'طرحة', category: 'veil', rentalPrice: 10 });
    const resolved = resolveStocktakeItem(accessory.code);
    assert.equal(resolved.kind, 'accessory');
    assert.equal(resolved.itemId, accessory.id);
  } finally {
    uninstallStorage();
  }
});

test('an unknown value is refused with the value quoted back', () => {
  setup();
  try {
    const session = startStocktakeSession();
    assert.throws(() => recordStocktakeScan(session.id, 'NOPE-999'), /NOPE-999/);
  } finally {
    uninstallStorage();
  }
});

test('scanning the same piece twice is a no-op, not an error', () => {
  setup();
  try {
    const dress = makeDress();
    const session = startStocktakeSession();
    recordStocktakeScan(session.id, dress.code);
    const second = recordStocktakeScan(session.id, dress.code);
    // An app that scolds the operator for scanning twice trains her to stop
    // scanning; she loses her place constantly during a real count.
    assert.equal(second.duplicate, true);
    assert.equal(second.session.scans.length, 1);
  } finally {
    uninstallStorage();
  }
});

test('a mistaken scan can be removed while the session is open', () => {
  setup();
  try {
    const dress = makeDress();
    const session = startStocktakeSession();
    recordStocktakeScan(session.id, dress.code);
    const updated = removeStocktakeScan(session.id, 'dress', dress.id);
    assert.equal(updated.scans.length, 0);
  } finally {
    uninstallStorage();
  }
});

test('a closed session refuses further scans', () => {
  setup();
  try {
    const dress = makeDress();
    const session = startStocktakeSession();
    completeStocktakeSession(session.id);
    assert.throws(() => recordStocktakeScan(session.id, dress.code), /مغلقة/);
  } finally {
    uninstallStorage();
  }
});

test('an unscanned piece that should be on the rail is reported missing', () => {
  setup();
  try {
    makeDress({ name: 'مفقود محتمل' });
    const session = startStocktakeSession();
    const report = buildStocktakeReport(session.id);
    assert.equal(report.summary.missingCount, 1);
    assert.equal(report.missing[0].reason, 'unexplained');
  } finally {
    uninstallStorage();
  }
});

test('a scanned piece is reported present and not missing', () => {
  setup();
  try {
    const dress = makeDress();
    const session = startStocktakeSession();
    recordStocktakeScan(session.id, dress.code);
    const report = buildStocktakeReport(session.id);
    assert.equal(report.summary.missingCount, 0);
    assert.equal(report.summary.counted, 1);
  } finally {
    uninstallStorage();
  }
});

test('a piece out on an active rental is expected absent, never missing', () => {
  setup();
  try {
    const dress = makeDress();
    const reservation = sendDressOut(dress);

    const session = startStocktakeSession();
    const report = buildStocktakeReport(session.id);

    // A count that flags every rented dress is noise, and noise gets ignored.
    assert.equal(report.summary.missingCount, 0);
    assert.equal(report.expectedAbsent.length, 1);
    assert.equal(report.expectedAbsent[0].reason, 'out_on_rental');
    assert.match(report.expectedAbsent[0].detail, new RegExp(reservation.reservationNumber));
  } finally {
    uninstallStorage();
  }
});

test('a piece in the laundry is expected absent rather than missing', () => {
  setup();
  try {
    const dress = makeDress();
    updateDress(dress.code, { status: 'laundry' });
    const session = startStocktakeSession();
    const report = buildStocktakeReport(session.id);
    assert.equal(report.summary.missingCount, 0);
    assert.equal(report.expectedAbsent[0].reason, 'in_service');
  } finally {
    uninstallStorage();
  }
});

test('a sold piece is not counted as a loss', () => {
  setup();
  try {
    const dress = makeDress();
    updateDress(dress.code, { status: 'sold' });
    const session = startStocktakeSession();
    const report = buildStocktakeReport(session.id);
    assert.equal(report.summary.missingCount, 0);
    assert.equal(report.expectedAbsent[0].reason, 'sold');
  } finally {
    uninstallStorage();
  }
});

test('an accessory delivered with a booking is expected absent', () => {
  setup();
  try {
    const dress = makeDress();
    const customer = addCustomer({ name: 'نورة', phone: '+968 9191 8186', status: 'active' });
    const reservation = createReservation({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: futureDate(1),
      returnDate: futureDate(3),
      depositAmount: 50,
    });
    const accessory = addAccessory({ name: 'طرحة', category: 'veil', rentalPrice: 10 });
    attachAccessoryToReservation({ reservationNumber: reservation.reservationNumber, accessoryId: accessory.id });

    const stored = readCollection('reservations', []);
    writeCollection('reservations', stored.map((item) => ({ ...item, pickupDate: futureDate(0), returnDate: futureDate(2) })));
    completeDeliveryCommand({
      paymentOverrideReason: 'تجاوز سداد مخصص لسيناريو الاختبار',
      reservationNumber: reservation.reservationNumber,
      deliveryDateTime: nowDateTimeLocal(),
      deliveredAccessoryIds: [accessory.id],
    });

    const session = startStocktakeSession();
    const report = buildStocktakeReport(session.id);
    const accessoryFinding = report.expectedAbsent.find((finding) => finding.kind === 'accessory');
    assert.ok(accessoryFinding, 'a delivered accessory must be explained, not reported lost');
    assert.equal(accessoryFinding.reason, 'out_on_rental');
  } finally {
    uninstallStorage();
  }
});

test('coverage is the share of expected-present items actually found', () => {
  setup();
  try {
    const found = makeDress({ name: 'موجود' });
    makeDress({ name: 'غائب' });
    const session = startStocktakeSession();
    recordStocktakeScan(session.id, found.code);
    const report = buildStocktakeReport(session.id);
    assert.equal(report.summary.expectedPresent, 2);
    assert.equal(report.summary.coveragePercent, 50);
  } finally {
    uninstallStorage();
  }
});

test('coverage is 100 percent when nothing was expected on the rail', () => {
  setup();
  try {
    // An empty showroom must not report 0% and look like a catastrophe.
    const session = startStocktakeSession();
    const report = buildStocktakeReport(session.id);
    assert.equal(report.summary.coveragePercent, 100);
  } finally {
    uninstallStorage();
  }
});

test('finding a piece that should be out on rental is still recorded as present', () => {
  setup();
  try {
    const dress = makeDress();
    sendDressOut(dress);
    const session = startStocktakeSession();
    recordStocktakeScan(session.id, dress.code);
    const report = buildStocktakeReport(session.id);
    // The piece being here when the system says it is with a customer is itself
    // worth knowing, so the reason is preserved on the present line.
    assert.equal(report.present.length, 1);
    assert.equal(report.present[0].reason, 'out_on_rental');
  } finally {
    uninstallStorage();
  }
});

test('closing a session freezes it and stamps the completion time', () => {
  setup();
  try {
    const session = startStocktakeSession();
    const report = completeStocktakeSession(session.id, 'جرد نهاية الشهر');
    assert.equal(report.session.status, 'completed');
    assert.ok(report.session.completedAt);
    assert.equal(report.session.notes, 'جرد نهاية الشهر');
    assert.equal(getOpenStocktakeSession(), undefined);
  } finally {
    uninstallStorage();
  }
});

test('closing a session never changes any item status', () => {
  setup();
  try {
    const dress = makeDress();
    const session = startStocktakeSession();
    completeStocktakeSession(session.id);

    // A stocktake is an observation, not an authority. Writing off stock from
    // one hurried count would be far more damaging than an unexplained line.
    const stored = readCollection('dresses', []).find((item) => item.id === dress.id);
    assert.equal(stored.status, 'available');
  } finally {
    uninstallStorage();
  }
});

test('closing a session records the outcome in the audit trail', () => {
  setup();
  try {
    makeDress();
    const session = startStocktakeSession();
    completeStocktakeSession(session.id);
    const entry = getAuditLog().find((item) => item.entityType === 'stocktake' && item.action === 'update');
    assert.ok(entry);
    assert.equal(entry.nextValues.missing, 1);
  } finally {
    uninstallStorage();
  }
});

test('a session can be cancelled without producing a report', () => {
  setup();
  try {
    const session = startStocktakeSession();
    const cancelled = cancelStocktakeSession(session.id);
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(getOpenStocktakeSession(), undefined);
  } finally {
    uninstallStorage();
  }
});

test('a completed session cannot be cancelled retroactively', () => {
  setup();
  try {
    const session = startStocktakeSession();
    completeStocktakeSession(session.id);
    assert.throws(() => cancelStocktakeSession(session.id), /مغلقة/);
  } finally {
    uninstallStorage();
  }
});

test('a scan whose item was later deleted is surfaced, not silently dropped', () => {
  setup();
  try {
    const dress = makeDress();
    const session = startStocktakeSession();
    recordStocktakeScan(session.id, dress.code);
    writeCollection('dresses', []);

    const report = buildStocktakeReport(session.id);
    assert.equal(report.unknownScans.length, 1, 'a dangling scan points at a real data problem');
  } finally {
    uninstallStorage();
  }
});
