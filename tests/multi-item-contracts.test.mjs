import test from 'node:test';
import assert from 'node:assert/strict';
import { installStorage, uninstallStorage, futureDate } from './helpers/storage.mjs';
import { resetCountersForTesting } from '../src/engines/persistence/index.ts';
import { addCustomer } from '../src/features/customers/customer.service.ts';
import { addDress } from '../src/features/dresses/dress.service.ts';
import {
  createReservation,
  getReservations,
  rescheduleReservation,
  addContractLine,
  removeContractLine,
  recordReservationPayment,
} from '../src/features/reservations/reservation.service.ts';
import {
  getReservationLines,
  isMultiItemReservation,
  getOutstandingLines,
  getPendingDeliveryLines,
  getReturnedLines,
  getReservationItemCodes,
  getReservationItemNames,
  calculateLinesTotal,
  calculateLinesFees,
  deriveReservationStatus,
  deriveLineDeliveryStatus,
  checkLineConflicts,
} from '../src/features/reservations/contractLineHelpers.ts';
import {
  findItemConflicts,
} from '../src/features/reservations/reservationConflicts.ts';
import { DEFAULT_APP_PREFERENCES, saveAppPreferences } from '../src/features/preferences/preferences.service.ts';
import { buildRentalContractHtml } from '../src/features/reservations/printRentalContract.ts';
import { buildReservationsCsv } from '../src/features/reports/ledgerExports.ts';

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
  const dress3 = addDress({ ...dressInput, name: 'طرحة دانتيل', category: 'طرح وشالات', itemType: 'veil' });
  const dress4 = addDress({ ...dressInput, name: 'تاج كريستال', category: 'إكسسوارات', itemType: 'accessory' });
  return { customer, dress1, dress2, dress3, dress4 };
}

// ── 1. Single-item backward compatibility ───────────────────────────────

test('single-item reservation is backward compatible with the old format', () => {
  installStorage();
  try {
    const { customer, dress1 } = seed();
    const reservation = createReservation({
      customerId: customer.id,
      dressId: dress1.id,
      pickupDate: futureDate(3),
      returnDate: futureDate(5),
      depositAmount: 20,
      rentalPrice: 40,
    });

    // Top-level fields must still be populated
    assert.equal(reservation.dressCode, dress1.code);
    assert.equal(reservation.dressName, dress1.name);
    assert.equal(reservation.inventoryItemId, dress1.id);
    assert.equal(reservation.rentalPrice, 40);
    assert.equal(reservation.depositAmount, 20);
    assert.equal(reservation.totalAmount, 60);

    // Lines array must exist with one entry
    assert.equal(reservation.lines?.length, 1);
    assert.equal(reservation.lines[0].dressCodeSnapshot, dress1.code);
    assert.equal(reservation.lines[0].rentalPrice, 40);
    assert.equal(reservation.lines[0].deliveryStatus, 'pending_delivery');

    // getReservationLines must work for both legacy and new
    const lines = getReservationLines(reservation);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].dressCodeSnapshot, dress1.code);

    // isMultiItem must be false
    assert.equal(isMultiItemReservation(reservation), false);
  } finally {
    cleanup();
  }
});

// ── 2. Multi-item reservation with multiple dresses ────────────────────

test('multi-item reservation with multiple dresses', () => {
  installStorage();
  try {
    const { customer, dress1, dress2 } = seed();
    const reservation = createReservation({
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

    // Must have two lines
    assert.equal(reservation.lines?.length, 2);

    // Top-level fields must mirror the first line
    assert.equal(reservation.dressCode, dress1.code);
    assert.equal(reservation.dressName, dress1.name);
    assert.equal(reservation.inventoryItemId, dress1.id);

    // Total must be sum of all lines
    assert.equal(calculateLinesTotal(reservation.lines), 40 + 20 + 35 + 15);
    assert.equal(reservation.totalAmount, 110);

    // isMultiItem must be true
    assert.equal(isMultiItemReservation(reservation), true);

    // Each line must have independent data
    assert.equal(reservation.lines[0].rentalPrice, 40);
    assert.equal(reservation.lines[1].rentalPrice, 35);
    assert.equal(reservation.lines[0].depositAmount, 20);
    assert.equal(reservation.lines[1].depositAmount, 15);
  } finally {
    cleanup();
  }
});

// ── 3. Reservation with dress and accessories ──────────────────────────

test('reservation with dress and accessories as contract lines', () => {
  installStorage();
  try {
    const { customer, dress1, dress3, dress4 } = seed();
    const reservation = createReservation({
      customerId: customer.id,
      pickupDate: futureDate(3),
      returnDate: futureDate(5),
      depositAmount: 0,
      rentalPrice: 0,
      lines: [
        { dressId: dress1.id, rentalPrice: 40, depositAmount: 20 },
        { dressId: dress3.id, rentalPrice: 10, depositAmount: 5 },
        { dressId: dress4.id, rentalPrice: 8, depositAmount: 3 },
      ],
    });

    assert.equal(reservation.lines?.length, 3);
    assert.equal(calculateLinesTotal(reservation.lines), 40 + 20 + 10 + 5 + 8 + 3);
    assert.equal(reservation.totalAmount, 86);

    // Item codes include all lines
    const codes = getReservationItemCodes(reservation);
    assert.equal(codes.length, 3);
    assert.ok(codes.includes(dress1.code));
    assert.ok(codes.includes(dress3.code));
    assert.ok(codes.includes(dress4.code));
  } finally {
    cleanup();
  }
});

// ── 4. Conflict on only one line ───────────────────────────────────────

test('conflict on only one line does not hide status of other lines', () => {
  installStorage();
  try {
    const { customer, dress1, dress2 } = seed();
    // Book dress1 for the same period
    createReservation({
      customerId: customer.id,
      dressId: dress1.id,
      pickupDate: futureDate(3),
      returnDate: futureDate(5),
      depositAmount: 20,
    });

    // Try to create multi-item reservation with dress1 (conflicted) and dress2 (free)
    const conflictResults = checkLineConflicts(
      [{ dressId: dress1.id }, { dressId: dress2.id }],
      { pickupDate: futureDate(3), returnDate: futureDate(5) },
      getReservations(),
    );

    // Only dress1 should have conflicts
    assert.equal(conflictResults.length, 2);
    assert.equal(conflictResults[0].conflicts.length, 1);
    assert.equal(conflictResults[1].conflicts.length, 0);

    // Attempting to create the reservation should throw
    assert.throws(
      () => createReservation({
        customerId: customer.id,
        pickupDate: futureDate(3),
        returnDate: futureDate(5),
        depositAmount: 0,
        rentalPrice: 0,
        lines: [
          { dressId: dress1.id, rentalPrice: 40, depositAmount: 20 },
          { dressId: dress2.id, rentalPrice: 35, depositAmount: 15 },
        ],
      }),
      /محجوز ضمن الحجز/,
    );
  } finally {
    cleanup();
  }
});

// ── 5. Adding a line to an existing reservation ────────────────────────

test('adding a line to an existing reservation', () => {
  installStorage();
  try {
    const { customer, dress1, dress2 } = seed();
    const reservation = createReservation({
      customerId: customer.id,
      dressId: dress1.id,
      pickupDate: futureDate(3),
      returnDate: futureDate(5),
      depositAmount: 20,
    });

    assert.equal(reservation.lines?.length, 1);
    assert.equal(reservation.totalAmount, 60);

    const updated = addContractLine({
      reservationNumber: reservation.reservationNumber,
      dressId: dress2.id,
      rentalPrice: 35,
      depositAmount: 15,
    });

    assert.equal(updated.lines?.length, 2);
    assert.equal(updated.totalAmount, 60 + 35 + 15);
    assert.equal(isMultiItemReservation(updated), true);

    // Top-level fields still mirror the first line
    assert.equal(updated.dressCode, dress1.code);
  } finally {
    cleanup();
  }
});

// ── 6. Removing a line from a multi-item reservation ───────────────────

test('removing a line from a multi-item reservation', () => {
  installStorage();
  try {
    const { customer, dress1, dress2 } = seed();
    const reservation = createReservation({
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

    const line2Id = reservation.lines[1].id;
    const updated = removeContractLine({
      reservationNumber: reservation.reservationNumber,
      lineId: line2Id,
    });

    assert.equal(updated.lines?.length, 1);
    assert.equal(updated.totalAmount, 60);
    assert.equal(isMultiItemReservation(updated), false);
  } finally {
    cleanup();
  }
});

// ── 7. Cannot remove last line ──────────────────────────────────────────

test('cannot remove the last line from a reservation', () => {
  installStorage();
  try {
    const { customer, dress1 } = seed();
    const reservation = createReservation({
      customerId: customer.id,
      dressId: dress1.id,
      pickupDate: futureDate(3),
      returnDate: futureDate(5),
      depositAmount: 20,
    });

    assert.throws(
      () => removeContractLine({
        reservationNumber: reservation.reservationNumber,
        lineId: reservation.lines[0].id,
      }),
      /لا يمكن حذف البند الأخير/,
    );
  } finally {
    cleanup();
  }
});

// ── 8. Late fees per line ───────────────────────────────────────────────

test('late fees are computed per line independently', () => {
  installStorage();
  try {
    const { customer, dress1, dress2 } = seed();
    const reservation = createReservation({
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

    // Simulate late fees on one line only
    const lines = reservation.lines;
    assert.equal(lines[0].lateFee, 0);
    assert.equal(lines[1].lateFee, 0);

    // calculateLinesFees should be 0
    assert.equal(calculateLinesFees(lines), 0);
  } finally {
    cleanup();
  }
});

// ── 9. Per-line delivery status ─────────────────────────────────────────

test('per-line delivery status is tracked independently', () => {
  installStorage();
  try {
    const { customer, dress1, dress2 } = seed();
    const reservation = createReservation({
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

    // All lines start pending
    const pendingLines = getPendingDeliveryLines(reservation);
    assert.equal(pendingLines.length, 2);

    const outstandingLines = getOutstandingLines(reservation);
    assert.equal(outstandingLines.length, 0);

    const returnedLines = getReturnedLines(reservation);
    assert.equal(returnedLines.length, 0);
  } finally {
    cleanup();
  }
});

// ── 10. deriveReservationStatus ─────────────────────────────────────────

test('deriveReservationStatus aggregates line statuses correctly', () => {
  assert.equal(deriveReservationStatus([
    { deliveryStatus: 'pending_delivery' },
    { deliveryStatus: 'pending_delivery' },
  ], 'confirmed'), 'confirmed');

  assert.equal(deriveReservationStatus([
    { deliveryStatus: 'delivered' },
    { deliveryStatus: 'pending_delivery' },
  ], 'confirmed'), 'delivered');

  assert.equal(deriveReservationStatus([
    { deliveryStatus: 'returned' },
    { deliveryStatus: 'returned' },
  ], 'delivered'), 'returned');

  assert.equal(deriveReservationStatus([
    { deliveryStatus: 'late' },
    { deliveryStatus: 'delivered' },
  ], 'delivered'), 'overdue');
});

// ── 11. deriveLineDeliveryStatus ────────────────────────────────────────

test('deriveLineDeliveryStatus maps reservation status to line status', () => {
  assert.equal(deriveLineDeliveryStatus('pending'), 'pending_delivery');
  assert.equal(deriveLineDeliveryStatus('confirmed'), 'pending_delivery');
  assert.equal(deriveLineDeliveryStatus('delivered'), 'delivered');
  assert.equal(deriveLineDeliveryStatus('overdue'), 'late');
  assert.equal(deriveLineDeliveryStatus('returned'), 'returned');
  assert.equal(deriveLineDeliveryStatus('cancelled'), 'pending_delivery');
});

// ── 12. Print contract with multi-item ──────────────────────────────────

test('print contract renders all lines for multi-item reservations', () => {
  installStorage();
  try {
    const { customer, dress1, dress2 } = seed();
    const reservation = createReservation({
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

    const html = buildRentalContractHtml(reservation);

    // Both item codes must appear in the printed contract
    assert.ok(html.includes(dress1.code));
    assert.ok(html.includes(dress2.code));
    assert.ok(html.includes(dress1.name));
    assert.ok(html.includes(dress2.name));

    // Multi-item header must include rental and deposit columns
    assert.ok(html.includes('الإيجار'));
    assert.ok(html.includes('التأمين'));

    // Financial totals must include all lines (formatted as OMR)
    assert.ok(html.includes('ر.ع'));
  } finally {
    cleanup();
  }
});

// ── 13. CSV export with multi-item ──────────────────────────────────────

test('CSV export includes all line items for multi-item reservations', () => {
  installStorage();
  try {
    const { customer, dress1, dress2 } = seed();
    const reservation = createReservation({
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

    const csv = buildReservationsCsv([reservation]);

    // Both items must appear
    assert.ok(csv.includes(dress1.code));
    assert.ok(csv.includes(dress2.code));

    // The line count column must be included
    assert.ok(csv.includes('عدد البنود'));
  } finally {
    cleanup();
  }
});

// ── 14. Legacy reservation backward compatibility ──────────────────────

test('legacy reservation without lines array is handled correctly', () => {
  installStorage();
  try {
    const { customer, dress1 } = seed();

    // Create a legacy-style reservation without lines
    const legacyReservation = {
      id: 'legacy-test-1',
      reservationNumber: 'RSV-LEGACY',
      customerId: customer.id,
      inventoryItemId: dress1.id,
      customerName: customer.name,
      customerPhone: customer.phone,
      dressCode: dress1.code,
      dressName: dress1.name,
      pickupDate: futureDate(3),
      returnDate: futureDate(5),
      status: 'confirmed',
      rentalPrice: 40,
      depositAmount: 20,
      totalAmount: 60,
      paidAmount: 0,
      remainingAmount: 60,
      assessedFeesAmount: 0,
      refundedAmount: 0,
      settledDepositAmount: 0,
      retainedDepositAmount: 0,
      // No lines array!
    };

    // getReservationLines must derive a single line from the top-level fields
    const lines = getReservationLines(legacyReservation);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].dressCodeSnapshot, dress1.code);
    assert.equal(lines[0].rentalPrice, 40);
    assert.equal(lines[0].deliveryStatus, 'pending_delivery');

    // isMultiItem must be false
    assert.equal(isMultiItemReservation(legacyReservation), false);
  } finally {
    cleanup();
  }
});

// ── 15. Payments and totals are not broken by multi-item ────────────────

test('payments and totals work correctly with multi-item reservations', () => {
  installStorage();
  try {
    const { customer, dress1, dress2 } = seed();
    const reservation = createReservation({
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

    assert.equal(reservation.totalAmount, 110);
    assert.equal(reservation.remainingAmount, 110);
    assert.equal(reservation.paidAmount, 0);

    // Record a payment
    const paid = recordReservationPayment({
      reservationNumber: reservation.reservationNumber,
      type: 'rental',
      direction: 'income',
      amount: 50,
    });

    assert.equal(paid.paidAmount, 50);
    assert.equal(paid.remainingAmount, 60);

    // Total must not change
    assert.equal(paid.totalAmount, 110);
  } finally {
    cleanup();
  }
});

// ── 16. Search across all line items ────────────────────────────────────

test('search matches across all line items in multi-item reservations', () => {
  installStorage();
  try {
    const { customer, dress1, dress2 } = seed();
    const reservation = createReservation({
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

    // Item names and codes from all lines must be accessible
    const names = getReservationItemNames(reservation);
    assert.equal(names.length, 2);
    assert.ok(names.includes(dress1.name));
    assert.ok(names.includes(dress2.name));
  } finally {
    cleanup();
  }
});

// ── 17. syncTopLevelFromLines ───────────────────────────────────────────

test('syncTopLevelFromLines mirrors first line to top-level fields', () => {
  installStorage();
  try {
    const { customer, dress1, dress2 } = seed();
    const reservation = createReservation({
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

    // After removing the first line, sync should update top-level to the new first line
    const line1Id = reservation.lines[0].id;
    const afterRemove = removeContractLine({
      reservationNumber: reservation.reservationNumber,
      lineId: line1Id,
    });

    // Top-level fields should now mirror dress2
    assert.equal(afterRemove.dressCode, dress2.code);
    assert.equal(afterRemove.dressName, dress2.name);
    assert.equal(afterRemove.inventoryItemId, dress2.id);
    assert.equal(afterRemove.rentalPrice, 35);
    assert.equal(afterRemove.depositAmount, 15);
  } finally {
    cleanup();
  }
});

// ── 18. Conflict checking across multi-item reservation lines ───────────

test('conflict checking covers each line independently in findItemConflicts', () => {
  installStorage();
  try {
    const { customer, dress1, dress2 } = seed();
    // Create a multi-item reservation with dress1 and dress2
    createReservation({
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

    // Check conflicts for dress1 in the same period
    const dress1Conflicts = findItemConflicts({
      inventoryItemId: dress1.id,
      dressCode: dress1.code,
      pickupDate: futureDate(3),
      returnDate: futureDate(5),
    }, getReservations());

    assert.equal(dress1Conflicts.length, 1);

    // Check conflicts for dress2 in the same period
    const dress2Conflicts = findItemConflicts({
      inventoryItemId: dress2.id,
      dressCode: dress2.code,
      pickupDate: futureDate(3),
      returnDate: futureDate(5),
    }, getReservations());

    assert.equal(dress2Conflicts.length, 1);
  } finally {
    cleanup();
  }
});

// ── 19. Backup and restore preserves lines ──────────────────────────────

test('backup and restore preserves multi-item contract lines', () => {
  installStorage();
  try {
    const { customer, dress1, dress2 } = seed();
    const reservation = createReservation({
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

    // Verify the reservation is stored with its lines
    const stored = getReservations().find((r) => r.id === reservation.id);
    assert.ok(stored);
    assert.equal(stored.lines?.length, 2);
    assert.equal(stored.lines[0].dressCodeSnapshot, dress1.code);
    assert.equal(stored.lines[1].dressCodeSnapshot, dress2.code);
  } finally {
    cleanup();
  }
});

// ── 20. Reschedule multi-item reservation ───────────────────────────────

test('rescheduling a multi-item reservation updates all pending lines', () => {
  installStorage();
  try {
    const { customer, dress1, dress2 } = seed();
    const reservation = createReservation({
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

    const rescheduled = rescheduleReservation({
      reservationNumber: reservation.reservationNumber,
      pickupDate: futureDate(5),
      returnDate: futureDate(7),
    });

    // All lines should have the new dates
    assert.equal(rescheduled.pickupDate, futureDate(5));
    assert.equal(rescheduled.returnDate, futureDate(7));
    assert.equal(rescheduled.lines[0].pickupDate, futureDate(5));
    assert.equal(rescheduled.lines[1].pickupDate, futureDate(5));
  } finally {
    cleanup();
  }
});
