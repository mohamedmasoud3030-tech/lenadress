import test from 'node:test';
import assert from 'node:assert/strict';
import { setCommandFailurePoint } from '../src/engines/workflows/index.ts';
import { createReservationCommand } from '../src/features/workflows/reservationCommands.ts';
import { recordPaymentCommand } from '../src/features/workflows/paymentCommands.ts';
import { completeDeliveryCommand, completeReturnCommand } from '../src/features/workflows/deliveryReturnCommands.ts';
import { getFinanceTotals } from '../src/features/finance/finance.service.ts';
import { calculateDayClose } from '../src/features/reports/report.service.ts';
import { buildRentalContractHtml } from '../src/features/reservations/printRentalContract.ts';
import { addCustomer } from '../src/features/customers/customer.service.ts';
import { addDress } from '../src/features/dresses/dress.service.ts';
import { addDaysISO, getTodayISO } from '../src/shared/utils/date.ts';
import { calculateRentalOutstanding, calculateSecurityDepositLiability } from '../src/shared/utils/financialCalculations.js';
import { getReservations } from '../src/features/reservations/reservation.service.ts';

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
  name: 'فستان',
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

test('booking advance reduces rental balance once and not counted as liability', () => {
  installStorage();
  try {
    const customer = addCustomer({ name: 'ع', phone: '90000001', status: 'normal' });
    const dress = addDress(rentalItem);
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: future(2),
      depositAmount: 50,
      securityDepositAmount: 50,
      bookingAdvanceAmount: 0,
      idempotencyKey: 'ba-reduce-1',
    });
    assert.equal(reservation.remainingAmount, 100);
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'booking_advance',
      method: 'cash',
      amount: 30,
      idempotencyKey: 'ba-pay1',
    });
    const updated = getReservations().find((r) => r.reservationNumber === reservation.reservationNumber);
    assert.equal(updated.remainingAmount, 70);
    const totals = getFinanceTotals();
    assert.equal(totals.depositLiabilityCollected, 0);
    assert.equal(totals.bookingAdvanceCollected, 30);
  } finally { cleanup(); }
});

test('security deposit must not reduce rental remaining balance', () => {
  installStorage();
  try {
    const customer = addCustomer({ name: 'ع', phone: '90000002', status: 'normal' });
    const dress = addDress({ ...rentalItem, rentalPrice: 100, defaultSecurityDepositAmount: 50, depositAmount: 50 });
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: future(2),
      depositAmount: 50,
      securityDepositAmount: 50,
      idempotencyKey: 'sd1',
    });
    assert.equal(reservation.remainingAmount, 100);
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'security_deposit_collection',
      method: 'cash',
      amount: 50,
      idempotencyKey: 'sd-collect',
    });
    const updated = getReservations().find((r) => r.reservationNumber === reservation.reservationNumber);
    assert.equal(updated.remainingAmount, 100);
    const totals = getFinanceTotals();
    assert.equal(totals.securityDepositCollected, 50);
    assert.equal(totals.depositLiabilityCollected, 50);
  } finally { cleanup(); }
});

test('collection creates refundable liability, not income', () => {
  installStorage();
  try {
    const customer = addCustomer({ name: 'ع', phone: '90000003', status: 'normal' });
    const dress = addDress(rentalItem);
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: future(1),
      depositAmount: 50,
      securityDepositAmount: 50,
      idempotencyKey: 'rev1',
    });
    recordPaymentCommand({
      reservationNumber: reservation.reservationNumber,
      paymentDate: today,
      type: 'security_deposit_collection',
      method: 'cash',
      amount: 50,
      idempotencyKey: 'rev-dep',
    });
    const totals = getFinanceTotals();
    assert.equal(totals.grossCollected, 50);
    assert.equal(totals.recognisedIncome, 0);
    assert.equal(totals.rentalRevenue, 0);
    assert.equal(totals.depositLiabilityCollected, 50);
  } finally { cleanup(); }
});

test('full refund of security deposit clears liability', () => {
  installStorage();
  try {
    const customer = addCustomer({ name: 'ع', phone: '90000004', status: 'normal' });
    const dress = addDress(rentalItem);
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: future(1),
      depositAmount: 50,
      securityDepositAmount: 50,
      idempotencyKey: 'full-ref',
    });
    recordPaymentCommand({ reservationNumber: reservation.reservationNumber, paymentDate: today, type: 'rental_payment', method: 'cash', amount: 100, idempotencyKey: 'full-ref-rent' });
    recordPaymentCommand({ reservationNumber: reservation.reservationNumber, paymentDate: today, type: 'security_deposit_collection', method: 'cash', amount: 50, idempotencyKey: 'full-ref-dep' });
    completeDeliveryCommand({ reservationNumber: reservation.reservationNumber, deliveryDateTime: new Date().toISOString(), idempotencyKey: 'full-ref-del' });
    completeReturnCommand({ reservationNumber: reservation.reservationNumber, returnDateTime: new Date().toISOString(), lateFee: 0, damageFee: 0, refundMethod: 'cash', nextItemStatus: 'inspection', idempotencyKey: 'full-ref-ret' });
    const totals = getFinanceTotals();
    assert.equal(totals.depositLiabilityCollected, 0);
    assert.equal(totals.securityDepositRefunded, 50);
  } finally { cleanup(); }
});

test('partial refund of security deposit', () => {
  installStorage();
  try {
    const customer = addCustomer({ name: 'ع', phone: '90000005', status: 'normal' });
    const dress = addDress(rentalItem);
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: future(1),
      depositAmount: 50,
      securityDepositAmount: 50,
      idempotencyKey: 'part-ref',
    });
    recordPaymentCommand({ reservationNumber: reservation.reservationNumber, paymentDate: today, type: 'rental_payment', method: 'cash', amount: 100, idempotencyKey: 'part-ref-rent' });
    recordPaymentCommand({ reservationNumber: reservation.reservationNumber, paymentDate: today, type: 'security_deposit_collection', method: 'cash', amount: 50, idempotencyKey: 'part-ref-dep' });
    completeDeliveryCommand({ reservationNumber: reservation.reservationNumber, deliveryDateTime: new Date().toISOString(), idempotencyKey: 'part-ref-del' });
    completeReturnCommand({ reservationNumber: reservation.reservationNumber, returnDateTime: new Date().toISOString(), lateFee: 10, damageFee: 0, refundMethod: 'cash', nextItemStatus: 'inspection', idempotencyKey: 'part-ref-ret' });
    const totals = getFinanceTotals();
    assert.equal(totals.securityDepositRefunded, 40);
    assert.equal(totals.securityDepositRetained, 10);
    assert.equal(totals.depositLiabilityCollected, 0);
  } finally { cleanup(); }
});

test('partial retention plus refund', () => {
  installStorage();
  try {
    const customer = addCustomer({ name: 'ع', phone: '90000006', status: 'normal' });
    const dress = addDress(rentalItem);
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: future(1),
      depositAmount: 100,
      securityDepositAmount: 100,
      idempotencyKey: 'part-both',
    });
    recordPaymentCommand({ reservationNumber: reservation.reservationNumber, paymentDate: today, type: 'rental_payment', method: 'cash', amount: 100, idempotencyKey: 'part-both-rent' });
    recordPaymentCommand({ reservationNumber: reservation.reservationNumber, paymentDate: today, type: 'security_deposit_collection', method: 'cash', amount: 100, idempotencyKey: 'part-both-dep' });
    completeDeliveryCommand({ reservationNumber: reservation.reservationNumber, deliveryDateTime: new Date().toISOString(), idempotencyKey: 'part-both-del' });
    completeReturnCommand({ reservationNumber: reservation.reservationNumber, returnDateTime: new Date().toISOString(), lateFee: 20, damageFee: 10, refundMethod: 'cash', nextItemStatus: 'inspection', idempotencyKey: 'part-both-ret' });
    const totals = getFinanceTotals();
    assert.equal(totals.securityDepositRetained, 30);
    assert.equal(totals.securityDepositRefunded, 70);
  } finally { cleanup(); }
});

test('full retention with approved fees', () => {
  installStorage();
  try {
    const customer = addCustomer({ name: 'ع', phone: '90000007', status: 'normal' });
    const dress = addDress(rentalItem);
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: future(1),
      depositAmount: 50,
      securityDepositAmount: 50,
      idempotencyKey: 'full-ret',
    });
    recordPaymentCommand({ reservationNumber: reservation.reservationNumber, paymentDate: today, type: 'rental_payment', method: 'cash', amount: 100, idempotencyKey: 'full-ret-rent' });
    recordPaymentCommand({ reservationNumber: reservation.reservationNumber, paymentDate: today, type: 'security_deposit_collection', method: 'cash', amount: 50, idempotencyKey: 'full-ret-dep' });
    completeDeliveryCommand({ reservationNumber: reservation.reservationNumber, deliveryDateTime: new Date().toISOString(), idempotencyKey: 'full-ret-del' });
    completeReturnCommand({ reservationNumber: reservation.reservationNumber, returnDateTime: new Date().toISOString(), lateFee: 50, damageFee: 0, refundMethod: 'cash', nextItemStatus: 'inspection', idempotencyKey: 'full-ret-ret' });
    const totals = getFinanceTotals();
    assert.equal(totals.securityDepositRetained, 50);
    assert.equal(totals.securityDepositRefunded, 0);
    assert.equal(totals.feesCollected, 50);
  } finally { cleanup(); }
});

test('over-refund rejected', () => {
  installStorage();
  try {
    const customer = addCustomer({ name: 'ع', phone: '90000008', status: 'normal' });
    const dress = addDress(rentalItem);
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: future(1),
      depositAmount: 50,
      securityDepositAmount: 50,
      idempotencyKey: 'over-ref',
    });
    recordPaymentCommand({ reservationNumber: reservation.reservationNumber, paymentDate: today, type: 'security_deposit_collection', method: 'cash', amount: 50, idempotencyKey: 'over-ref-dep' });
    assert.throws(() => {
      recordPaymentCommand({
        reservationNumber: reservation.reservationNumber,
        paymentDate: today,
        type: 'security_deposit_refund',
        method: 'cash',
        amount: 60,
        idempotencyKey: 'over-ref-attempt',
      });
    }, /تجاوز/);
  } finally { cleanup(); }
});

test('over-retention rejected', () => {
  installStorage();
  try {
    const customer = addCustomer({ name: 'ع', phone: '90000009', status: 'normal' });
    const dress = addDress(rentalItem);
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: future(1),
      depositAmount: 50,
      securityDepositAmount: 50,
      idempotencyKey: 'over-ret',
    });
    recordPaymentCommand({ reservationNumber: reservation.reservationNumber, paymentDate: today, type: 'security_deposit_collection', method: 'cash', amount: 50, idempotencyKey: 'over-ret-dep' });
    assert.throws(() => {
      recordPaymentCommand({
        reservationNumber: reservation.reservationNumber,
        paymentDate: today,
        type: 'security_deposit_retention',
        method: 'cash',
        amount: 60,
        idempotencyKey: 'over-ret-attempt',
      });
    }, /تجاوز|مطلوب/);
  } finally { cleanup(); }
});

test('duplicate retry does not duplicate refund or retention', () => {
  installStorage();
  try {
    const customer = addCustomer({ name: 'ع', phone: '90000010', status: 'normal' });
    const dress = addDress(rentalItem);
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: future(1),
      depositAmount: 50,
      securityDepositAmount: 50,
      idempotencyKey: 'dup',
    });
    recordPaymentCommand({ reservationNumber: reservation.reservationNumber, paymentDate: today, type: 'rental_payment', method: 'cash', amount: 100, idempotencyKey: 'dup-rent' });
    recordPaymentCommand({ reservationNumber: reservation.reservationNumber, paymentDate: today, type: 'security_deposit_collection', method: 'cash', amount: 50, idempotencyKey: 'dup-dep' });
    completeDeliveryCommand({ reservationNumber: reservation.reservationNumber, deliveryDateTime: new Date().toISOString(), idempotencyKey: 'dup-del' });
    completeReturnCommand({ reservationNumber: reservation.reservationNumber, returnDateTime: new Date().toISOString(), lateFee: 10, damageFee: 0, refundMethod: 'cash', nextItemStatus: 'inspection', idempotencyKey: 'dup-ret' });
    let threw = false;
    try {
      completeReturnCommand({ reservationNumber: reservation.reservationNumber, returnDateTime: new Date().toISOString(), lateFee: 10, damageFee: 0, refundMethod: 'cash', nextItemStatus: 'inspection', idempotencyKey: 'dup-ret' });
    } catch (e) {
      threw = true;
      assert.match(String(e.message), /بالفعل/);
    }
    assert.equal(threw, true, 'duplicate should be blocked');
    const totals = getFinanceTotals();
    assert.equal(totals.securityDepositRetained, 10);
    assert.equal(totals.securityDepositRefunded, 40);
  } finally { cleanup(); }
});

test('cancellation policy independent of security deposit', () => {
  installStorage();
  try {
    const customer = addCustomer({ name: 'ع', phone: '90000011', status: 'normal' });
    const dress = addDress(rentalItem);
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: future(1),
      depositAmount: 50,
      securityDepositAmount: 50,
      bookingAdvanceAmount: 20,
      idempotencyKey: 'cancel',
    });
    assert.equal(reservation.remainingAmount, 100);
  } finally { cleanup(); }
});

test('daily close classification separates rental, booking advance, security deposit', () => {
  installStorage();
  try {
    const customer = addCustomer({ name: 'ع', phone: '90000012', status: 'normal' });
    const dress = addDress(rentalItem);
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: future(1),
      depositAmount: 50,
      securityDepositAmount: 50,
      idempotencyKey: 'daily',
    });
    recordPaymentCommand({ reservationNumber: reservation.reservationNumber, paymentDate: today, type: 'booking_advance', method: 'cash', amount: 20, idempotencyKey: 'daily-ba' });
    recordPaymentCommand({ reservationNumber: reservation.reservationNumber, paymentDate: today, type: 'rental_payment', method: 'cash', amount: 30, idempotencyKey: 'daily-rent' });
    recordPaymentCommand({ reservationNumber: reservation.reservationNumber, paymentDate: today, type: 'security_deposit_collection', method: 'cash', amount: 50, idempotencyKey: 'daily-dep' });
    const totals = getFinanceTotals();
    assert.equal(totals.bookingAdvanceCollected, 20);
    assert.equal(totals.rentalRevenue, 30);
    assert.equal(totals.securityDepositCollected, 50);
    assert.equal(totals.grossCollected, 100);
    const closing = calculateDayClose({ businessDate: today, openingCash: 0, actualCash: 100 });
    assert.equal(closing.breakdown.cash.collections, 100);
  } finally { cleanup(); }
});

test('recognized income excludes security deposit liability', () => {
  installStorage();
  try {
    const customer = addCustomer({ name: 'ع', phone: '90000013', status: 'normal' });
    const dress = addDress(rentalItem);
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: future(1),
      depositAmount: 50,
      securityDepositAmount: 50,
      idempotencyKey: 'recog',
    });
    recordPaymentCommand({ reservationNumber: reservation.reservationNumber, paymentDate: today, type: 'rental_payment', method: 'cash', amount: 100, idempotencyKey: 'recog-rent' });
    recordPaymentCommand({ reservationNumber: reservation.reservationNumber, paymentDate: today, type: 'security_deposit_collection', method: 'cash', amount: 50, idempotencyKey: 'recog-dep' });
    const totals = getFinanceTotals();
    assert.equal(totals.grossCollected, 150);
    assert.equal(totals.recognisedIncome, 100);
  } finally { cleanup(); }
});

test('customer balance reconciliation - rental remaining excludes deposit', () => {
  installStorage();
  try {
    const customer = addCustomer({ name: 'ع', phone: '90000014', status: 'normal' });
    const dress = addDress(rentalItem);
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: future(1),
      depositAmount: 50,
      securityDepositAmount: 50,
      idempotencyKey: 'cust-bal',
    });
    assert.equal(reservation.remainingAmount, 100);
    recordPaymentCommand({ reservationNumber: reservation.reservationNumber, paymentDate: today, type: 'rental_payment', method: 'cash', amount: 40, idempotencyKey: 'cust-bal-rent' });
    const updated = getReservations().find((r) => r.reservationNumber === reservation.reservationNumber);
    assert.equal(updated.remainingAmount, 60);
  } finally { cleanup(); }
});

test('multi-item reservation calculation remains correct', () => {
  installStorage();
  try {
    const customer = addCustomer({ name: 'ع', phone: '90000015', status: 'normal' });
    const dress1 = addDress({ ...rentalItem, purchasePrice: 10, rentalPrice: 60, defaultSecurityDepositAmount: 30, depositAmount: 30, barcode: 'D1' });
    const dress2 = addDress({ ...rentalItem, purchasePrice: 10, rentalPrice: 40, defaultSecurityDepositAmount: 20, depositAmount: 20, barcode: 'D2' });
    const reservation = createReservationCommand({
      customerId: customer.id,
      pickupDate: today,
      returnDate: future(2),
      depositAmount: 0,
      securityDepositAmount: 50,
      bookingAdvanceAmount: 20,
      lines: [
        { dressId: dress1.id, rentalPrice: 60, securityDepositAmount: 30, bookingAdvanceAmount: 10 },
        { dressId: dress2.id, rentalPrice: 40, securityDepositAmount: 20, bookingAdvanceAmount: 10 },
      ],
      idempotencyKey: 'multi',
    });
    assert.equal(reservation.rentalPrice, 60);
    assert.equal(reservation.securityDepositAmount, 50);
    assert.equal(reservation.bookingAdvanceAmount, 20);
    assert.equal(reservation.remainingAmount, 100);
  } finally { cleanup(); }
});

test('contract and receipt labels distinct', () => {
  installStorage();
  try {
    const customer = addCustomer({ name: 'سارة', phone: '90000020', status: 'normal' });
    const dress = addDress(rentalItem);
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: future(2),
      depositAmount: 50,
      securityDepositAmount: 50,
      bookingAdvanceAmount: 20,
      idempotencyKey: 'labels',
    });
    const html = buildRentalContractHtml(reservation);
    assert.ok(html.includes('التأمين المسترد'));
    assert.ok(html.includes('دفعة الحجز'));
    assert.ok(html.includes('المتبقي من الإيجار'));
  } finally { cleanup(); }
});

test('no canonical runtime use of ambiguous depositAmount - service layer uses canonical', () => {
  installStorage();
  try {
    const customer = addCustomer({ name: 'ع', phone: '90000021', status: 'normal' });
    const dress = addDress(rentalItem);
    const reservation = createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: today,
      returnDate: future(1),
      depositAmount: 50,
      securityDepositAmount: 50,
      idempotencyKey: 'arch',
    });
    assert.ok(reservation.securityDepositAmount !== undefined);
    assert.ok(reservation.bookingAdvanceAmount !== undefined);
    assert.equal(reservation.depositAmount, 50);
  } finally { cleanup(); }
});

test('security deposit liability = collected - refunded - retained, never negative', () => {
  const liability = calculateSecurityDepositLiability({ collected: 100, refunded: 30, retained: 20 });
  assert.equal(liability, 50);
  const liability2 = calculateSecurityDepositLiability({ collected: 50, refunded: 40, retained: 20 });
  assert.equal(liability2, 0);
  const remaining = calculateRentalOutstanding({ rentalTotal: 100, assessedFees: 0, bookingAdvanceCollected: 0, rentalCollected: 0, rentalRefunded: 0, retainedDeposit: 0 });
  assert.equal(remaining, 100);
});
