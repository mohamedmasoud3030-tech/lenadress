import test from 'node:test';
import assert from 'node:assert/strict';
import { setCommandFailurePoint } from '../src/engines/workflows/index.ts';
import { createReservationCommand } from '../src/features/workflows/reservationCommands.ts';
import { recordPaymentCommand } from '../src/features/workflows/paymentCommands.ts';
import { getFinanceTotals } from '../src/features/finance/finance.service.ts';
import { getReservations } from '../src/features/reservations/reservation.service.ts';
import { getPayments } from '../src/features/payments/payment.service.ts';
import { addCustomer } from '../src/features/customers/customer.service.ts';
import { addDress } from '../src/features/dresses/dress.service.ts';
import { getTodayISO, addDaysISO } from '../src/shared/utils/date.ts';
import { getCollectionKey } from '../src/engines/persistence/collectionRegistry.ts';

function installStorage() {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      get length() { return store.size; },
      getItem(k) { return store.has(k) ? store.get(k) : null; },
      setItem(k, v) { store.set(k, String(v)); },
      removeItem(k) { store.delete(k); },
      key(i) { return Array.from(store.keys())[i] ?? null; },
      clear() { store.clear(); },
    },
  };
  return store;
}
function cleanup() {
  setCommandFailurePoint(null);
  delete globalThis.window;
}

const today = getTodayISO();
function future(days) { return addDaysISO(today, days); }

const rentalItem = {
  name: 'فستان إيجار',
  description: '',
  itemType: 'dress',
  category: 'سهرة',
  color: 'أحمر',
  size: 'M',
  purchasePrice: 100,
  rentalPrice: 100,
  salePrice: 0,
  depositAmount: 50,
  defaultSecurityDepositAmount: 50,
  status: 'available',
  isForRent: true,
  isForSale: false,
  images: [],
  barcode: '',
};

function writeRaw(store, collection, items) {
  store.set(getCollectionKey(collection), JSON.stringify(items));
}

// used in migration test

// 1. دفعتين حجز ثم دفعة إيجار - تحقق من مجموع الحجز والإيجار وpaidAmount وremaining والتقرير المالي
test('two booking advance installments then rental payment - totals reconcile', () => {
  const store = installStorage();

  void store;
  try {
    const customer = addCustomer({ name: 'عميل', phone: '90000101', status: 'normal' });
    const dress = addDress({ ...rentalItem, barcode: 'B1' });

    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: future(2),
      depositAmount: 50,
      securityDepositAmount: 50,
      bookingAdvanceAmount: 0,
      idempotencyKey: 'blk-1',
    });

    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'booking_advance',
      method: 'cash',
      amount: 20,
      idempotencyKey: 'blk-1-ba1',
    });

    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'booking_advance',
      method: 'cash',
      amount: 30,
      idempotencyKey: 'blk-1-ba2',
    });

    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'rental_payment',
      method: 'cash',
      amount: 50,
      idempotencyKey: 'blk-1-rent',
    });

    const updated = getReservations().find((r) => r.reservationNumber === reservation.reservationNumber);
    assert.ok(updated);
    assert.equal(updated.bookingAdvanceCollectedAmount, 50, 'مجموع دفعات الحجز يجب أن يكون 50');
    assert.equal(updated.rentalCollectedAmount, 50, 'مجموع الإيجار يجب أن يكون 50');
    assert.equal(updated.paidAmount, 100, 'paidAmount = rentalCollected + bookingAdvanceCollected');
    assert.equal(updated.remainingAmount, 0, 'remaining يجب أن يكون 0 بعد سداد 100 من إيجار 100');

    const totals = getFinanceTotals();
    assert.equal(totals.bookingAdvanceCollected, 50);
    assert.equal(totals.rentalRevenue, 50);
    assert.equal(totals.grossCollected, 100);
  } finally { cleanup(); }
});

// 2. رد إيجار منفصل عن رد التأمين
test('rental refund separate from security deposit refund - rental refund succeeds even if security balance zero', () => {
  installStorage();
  try {
    const customer = addCustomer({ name: 'عميل', phone: '90000102', status: 'normal' });
    const dress = addDress({ ...rentalItem, barcode: 'B2' });

    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: future(2),
      depositAmount: 0,
      securityDepositAmount: 0,
      idempotencyKey: 'blk-2a',
    });

    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'rental_payment',
      method: 'cash',
      amount: 100,
      idempotencyKey: 'blk-2a-rent',
    });

    // No security deposit collected - balance zero, rental refund should still succeed
    const before = getReservations().find((r) => r.reservationNumber === reservation.reservationNumber);
    assert.equal(before.securityDepositCollectedAmount ?? 0, 0);

    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'refund',
      method: 'cash',
      amount: 30,
      notes: 'استرجاع إيجار',
      idempotencyKey: 'blk-2a-refund',
    });

    const after = getReservations().find((r) => r.reservationNumber === reservation.reservationNumber);
    assert.equal(after.rentalCollectedAmount, 100);
    assert.equal(after.rentalRefundedAmount, 30);
    assert.equal(after.paidAmount, 100, 'paidAmount يظل مجموع المحصل، لا ينقص بالاسترداد، remaining يزيد عبر rentalRefunded');
    assert.equal(after.remainingAmount, 30);
  } finally { cleanup(); }
});

test('security deposit refund does not change rental balance', () => {
  installStorage();
  try {
    const customer = addCustomer({ name: 'عميل', phone: '90000103', status: 'normal' });
    const dress = addDress({ ...rentalItem, barcode: 'B3' });

    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: future(2),
      depositAmount: 50,
      securityDepositAmount: 50,
      idempotencyKey: 'blk-2b',
    });

    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'rental_payment',
      method: 'cash',
      amount: 100,
      idempotencyKey: 'blk-2b-rent',
    });

    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'security_deposit_collection',
      method: 'cash',
      amount: 50,
      idempotencyKey: 'blk-2b-dep',
    });

    const before = getReservations().find((r) => r.reservationNumber === reservation.reservationNumber);
    assert.equal(before.rentalCollectedAmount, 100);
    assert.equal(before.paidAmount, 100);
    assert.equal(before.securityDepositCollectedAmount, 50);

    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'security_deposit_refund',
      method: 'cash',
      amount: 20,
      idempotencyKey: 'blk-2b-refund-dep',
    });

    const after = getReservations().find((r) => r.reservationNumber === reservation.reservationNumber);
    assert.equal(after.rentalCollectedAmount, 100, 'رد التأمين لا يغير رصيد الإيجار');
    assert.equal(after.paidAmount, 100, 'paidAmount لا يتأثر برد التأمين');
    assert.equal(after.securityDepositRefundedAmount, 20);
    assert.equal(after.securityDepositCollectedAmount, 50);
  } finally { cleanup(); }
});

// 3. احتجاز التأمين لا يغير paidAmount
test('security deposit retention does not change paidAmount, rentalCollected, bookingAdvanceCollected', () => {
  installStorage();
  try {
    const customer = addCustomer({ name: 'عميل', phone: '90000104', status: 'normal' });
    const dress = addDress({ ...rentalItem, barcode: 'B4' });

    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: future(2),
      depositAmount: 50,
      securityDepositAmount: 50,
      idempotencyKey: 'blk-3',
    });

    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'rental_payment',
      method: 'cash',
      amount: 100,
      idempotencyKey: 'blk-3-rent',
    });

    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'security_deposit_collection',
      method: 'cash',
      amount: 50,
      idempotencyKey: 'blk-3-dep',
    });

    const before = getReservations().find((r) => r.reservationNumber === reservation.reservationNumber);
    assert.equal(before.paidAmount, 100);

    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'security_deposit_retention',
      method: 'other',
      amount: 20,
      retentionReason: 'تأخير مثبت 20 ر.ع مع إيصال',
      idempotencyKey: 'blk-3-ret',
    });

    const after = getReservations().find((r) => r.reservationNumber === reservation.reservationNumber);
    assert.equal(after.paidAmount, 100, 'احتجاز التأمين يجب ألا يزيد paidAmount');
    assert.equal(after.rentalCollectedAmount, 100, 'لا يزيد rentalCollectedAmount');
    assert.equal(after.bookingAdvanceCollectedAmount ?? 0, 0, 'لا يزيد bookingAdvanceCollectedAmount');
    assert.equal(after.securityDepositRetainedAmount, 20, 'يزيد securityDepositRetainedAmount');
    // يقلل التزام التأمين فقط
    const liability = (after.securityDepositCollectedAmount ?? 0) - (after.securityDepositRefundedAmount ?? 0) - (after.securityDepositRetainedAmount ?? 0);
    assert.equal(liability, 30);
  } finally { cleanup(); }
});

// 4. مفتاح idempotency متكرر بين حجزين - لا يرجع حركة الحجز الأول للحجز الثاني
test('same idempotency key on two reservations does not return first reservation movement for second', () => {
  installStorage();
  try {
    const customer1 = addCustomer({ name: 'عميل1', phone: '90000105', status: 'normal' });
    const customer2 = addCustomer({ name: 'عميل2', phone: '90000106', status: 'normal' });
    const dress1 = addDress({ ...rentalItem, barcode: 'B5-1' });
    const dress2 = addDress({ ...rentalItem, barcode: 'B5-2' });

    const res1 = createReservationCommand({
      customerId: customer1.id,
      dressId: dress1.id,
      pickupDate: today,
      returnDate: future(2),
      depositAmount: 50,
      securityDepositAmount: 50,
      idempotencyKey: 'blk-4-res1',
    });

    const res2 = createReservationCommand({
      customerId: customer2.id,
      dressId: dress2.id,
      pickupDate: today,
      returnDate: future(2),
      depositAmount: 50,
      securityDepositAmount: 50,
      idempotencyKey: 'blk-4-res2',
    });

    const pay1 = recordPaymentCommand({
      reservationNumber: res1.reservationNumber,
      paymentDate: today,
      type: 'rental_payment',
      method: 'cash',
      amount: 40,
      idempotencyKey: 'same-key-across-reservations',
    });

    const pay2 = recordPaymentCommand({
      reservationNumber: res2.reservationNumber,
      paymentDate: today,
      type: 'rental_payment',
      method: 'cash',
      amount: 40,
      idempotencyKey: 'same-key-across-reservations',
    });

    assert.notEqual(pay1.id, pay2.id, 'يجب أن تكون الحركتان منفصلتين');
    assert.equal(pay1.reservationNumber, res1.reservationNumber);
    assert.equal(pay2.reservationNumber, res2.reservationNumber);
    assert.notEqual(pay1.reservationNumber, pay2.reservationNumber);

    const allPayments = getPayments().filter((p) => p.idempotencyKey === 'same-key-across-reservations');
    assert.equal(allPayments.length, 2, 'يجب وجود حركتين منفصلتين بنفس المفتاح لحجزين مختلفين');
  } finally { cleanup(); }
});

// 5. إعادة استخدام المفتاح مع مبلغ مختلف تُرفض
test('idempotency reuse with different amount is rejected', () => {
  installStorage();
  try {
    const customer = addCustomer({ name: 'عميل', phone: '90000107', status: 'normal' });
    const dress = addDress({ ...rentalItem, barcode: 'B6' });

    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: future(2),
      depositAmount: 50,
      securityDepositAmount: 50,
      idempotencyKey: 'blk-5-res',
    });

    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'rental_payment',
      method: 'cash',
      amount: 20,
      idempotencyKey: 'dup-amount-key',
    });

    let threw = false;
    try {
      recordPaymentCommand({
        reservationNumber: reservation.reservationNumber,
        paymentDate: today,
        type: 'rental_payment',
        method: 'cash',
        amount: 30,
        idempotencyKey: 'dup-amount-key',
      });
    } catch (e) {
      threw = true;
      // Accept both DuplicateCommandError (command layer) and payload mismatch error (service layer)
      assert.match(String(e.message), /بالفعل|idempotency|مختلفة|مختلف|مسموحة/i);
    }
    assert.equal(threw, true, 'يجب رفض إعادة استخدام المفتاح مع مبلغ مختلف');
  } finally { cleanup(); }
});

test('idempotency service layer rejects different payload with same key for same reservation', async () => {
  const store = installStorage();

  void store;
  void store;
  try {
    const { addPayment: directAddPayment } = await import('../src/features/payments/payment.service.ts');
    const customer = addCustomer({ name: 'عميل', phone: '90000107b', status: 'normal' });
    const dress = addDress({ ...rentalItem, barcode: 'B6b' });

    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: future(2),
      depositAmount: 50,
      securityDepositAmount: 50,
      idempotencyKey: 'blk-5b-res',
    });

    directAddPayment({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'rental_payment',
      method: 'cash',
      amount: 20,
      idempotencyKey: 'service-dup-key',
    });

    let threw = false;
    try {
      directAddPayment({
        reservationNumber: reservation.reservationNumber,
        paymentDate: today,
        type: 'rental_payment',
        method: 'cash',
        amount: 30,
        idempotencyKey: 'service-dup-key',
      });
    } catch (e) {
      threw = true;
      assert.match(String(e.message), /حمولة مختلفة|مختلف|idempotency/i);
    }
    assert.equal(threw, true, 'service layer must reject same key with different amount');
  } finally { cleanup(); }
});

// 6. المبلغ المطلوب كدفعة حجز لا يُعامل كمبلغ محصل
test('configured bookingAdvanceAmount is not treated as collected', () => {
  const store = installStorage();

  void store;
  void store;
  try {
    const customer = addCustomer({ name: 'عميل', phone: '90000108', status: 'normal' });
    const dress = addDress({ ...rentalItem, barcode: 'B7' });

    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: future(2),
      depositAmount: 50,
      securityDepositAmount: 50,
      bookingAdvanceAmount: 50,
      idempotencyKey: 'blk-6',
    });

    const stored = getReservations().find((r) => r.reservationNumber === reservation.reservationNumber);
    assert.equal(stored.bookingAdvanceAmount, 50, 'المطلوب 50');
    assert.equal(stored.bookingAdvanceCollectedAmount, 0, 'المحصل يجب أن يكون 0 وليس 50');
    assert.equal(stored.paidAmount, 0);
    assert.equal(stored.remainingAmount, 100, 'المتبقي يجب أن يكون إيجار كامل 100، ليس 50');

    // Now collect 20 as booking advance, then remaining should be 80
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'booking_advance',
      method: 'cash',
      amount: 20,
      idempotencyKey: 'blk-6-ba',
    });

    const after = getReservations().find((r) => r.reservationNumber === reservation.reservationNumber);
    assert.equal(after.bookingAdvanceCollectedAmount, 20);
    assert.equal(after.remainingAmount, 80);
  } finally { cleanup(); }
});

// 7. بنود وملحقات legacy غير المحسومة تظل غير مصنفة
test('unresolved legacy lines and accessory links remain neutral', async () => {
  const store = installStorage();

  void store;
  try {
    const { resetMigrationMarkers } = await import('../src/engines/persistence/migrationRunner.ts');
    const { migrateFinancialDepositFields } = await import('../src/engines/persistence/financialDepositMigration.ts');

    resetMigrationMarkers();

    const reservationId = 'res-legacy-lines';
    const reservationNumber = 'RSV-LINES-UNRES';

    writeRaw(store, 'reservations', [
      {
        id: reservationId,
        reservationNumber,
        customerName: 'عميل قديم',
        customerPhone: '90000999',
        dressCode: 'D999',
        dressName: 'فستان قديم',
        pickupDate: '2026-08-10',
        returnDate: '2026-08-12',
        status: 'confirmed',
        rentalPrice: 100,
        depositAmount: 50,
        totalAmount: 150,
        paidAmount: 0,
        remainingAmount: 150,
        lines: [
          {
            id: 'line-1',
            dressCodeSnapshot: 'D999',
            dressNameSnapshot: 'فستان قديم',
            pickupDate: '2026-08-10',
            returnDate: '2026-08-12',
            rentalPrice: 100,
            depositAmount: 50,
            deliveryStatus: 'pending_delivery',
            lateFee: 0,
            damageFee: 0,
          },
        ],
      },
    ]);

    writeRaw(store, 'reservation-accessories', [
      {
        id: 'ra-1',
        reservationNumber,
        accessoryId: 'acc-1',
        accessoryCodeSnapshot: 'ACC001',
        accessoryNameSnapshot: 'طرحة',
        rentalPrice: 10,
        depositAmount: 20,
      },
    ]);

    writeRaw(store, 'payments', []);
    writeRaw(store, 'delivery-return', []);

    const migrated = migrateFinancialDepositFields();
    assert.equal(migrated, true);

    const { readCollection } = await import('../src/engines/persistence/persistenceEngine.ts');
    const reservations = readCollection('reservations');
    const res = reservations.find((r) => r.reservationNumber === reservationNumber);
    assert.ok(res);
    assert.equal(res.legacyDepositClassification, 'unresolved');
    assert.equal(res.needsFinancialClassification, true);
    assert.equal(res.securityDepositAmount, 0);
    assert.equal(res.bookingAdvanceAmount, 0);

    // Check lines remain neutral
    const lines = res.lines;
    assert.ok(Array.isArray(lines));
    assert.equal(lines.length, 1);
    assert.equal(lines[0].securityDepositAmount, 0, 'بند legacy غير محسوم يجب أن يظل محايداً 0');
    assert.equal(lines[0].bookingAdvanceAmount, 0);
    assert.equal(lines[0].legacyDepositAmount, 50, 'القيمة الأصلية محفوظة في legacy metadata');
    assert.equal(lines[0].legacyDepositClassification, 'unresolved');

    // Check accessory links remain neutral
    const accLinks = readCollection('reservation-accessories');
    const link = accLinks.find((l) => l.reservationNumber === reservationNumber);
    assert.ok(link);
    assert.equal(link.securityDepositAmount, 0, 'ملحق legacy غير محسوم يظل محايداً');
    assert.equal(link.bookingAdvanceAmount, 0);
    assert.equal(link.legacyDepositAmount, 20);
    assert.equal(link.legacyDepositClassification, 'unresolved');
  } finally { cleanup(); }
});
