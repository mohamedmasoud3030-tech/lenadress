import { getSales } from '../dresses/sale.service';
import { getSaleReturns } from '../dresses/salesLedger.service';
import { getExpenses } from '../expenses/expense.service';
import { getPayments } from '../payments/payment.service';
import type { PaymentRecord } from '../payments/payment.types';
import { getReservations } from '../reservations/reservation.service';
import { getReservationItemShare } from '../reservations/contractLineHelpers';
import type { DateRangeFilter } from '../reports/report.types';

/**
 * Canonical finance service — separates booking advance from security deposit.
 *
 * Rules:
 * - A refundable security deposit is a **liability**, never revenue. Cash in, but belongs to customer until refunded or retained.
 * - Only a **retained** deposit becomes showroom income (fee).
 * - Booking advance (دفعة الحجز) reduces rental receivable, is cash in, is rental revenue, not liability, not part of deposit settlement.
 * - Rental revenue = rental_payment + booking_advance - rental refunds
 * - Cash collected includes rental, booking advance, security deposit collection, fees, sales
 * - Recognised income excludes security deposit liability.
 */

export type MoneyMethod = 'cash' | 'card' | 'bank_transfer' | 'other';

export type FinanceTotals = {
  /** Cash actually received, including security deposits (liability) and booking advances */
  grossCollected: number;
  rentalRevenue: number;
  bookingAdvanceRevenue: number;
  saleRevenue: number;
  /** Refundable security deposits collected and not yet settled: liability, not income */
  depositLiabilityCollected: number;
  securityDepositCollected: number;
  depositRefunded: number;
  securityDepositRefunded: number;
  depositRetained: number;
  securityDepositRetained: number;
  bookingAdvanceCollected: number;
  feesCollected: number;
  refunds: number;
  expenses: number;
  /** Cash movement: everything in minus everything out */
  netCashMovement: number;
  /** Recognised income: rental + booking advance + sale + fees + retained deposits, minus expenses? Actually gross recognised before expenses */
  recognisedIncome: number;
  netResult: number;
  outstandingSecurityDepositLiability: number;
};

const FEE_TYPES = new Set(['late_fee', 'damage_fee', 'penalty']);
const RENTAL_TYPES = new Set(['rental', 'rental_payment']);
const BOOKING_ADVANCE_TYPES = new Set(['booking_advance']);
const SECURITY_DEPOSIT_COLLECTION_TYPES = new Set(['deposit', 'security_deposit_collection']);
const SECURITY_DEPOSIT_REFUND_TYPES = new Set(['security_deposit_refund']);
const SECURITY_DEPOSIT_RETENTION_TYPES = new Set(['retained_deposit', 'security_deposit_retention']);

function inRange(date: string, range?: DateRangeFilter): boolean {
  if (!range) return true;
  return (!range.from || date >= range.from) && (!range.to || date <= range.to);
}

function sumAmounts(items: Array<{ amount: number }>): number {
  return items.reduce((total, item) => total + item.amount, 0);
}

export function getPaymentsInRange(range?: DateRangeFilter): PaymentRecord[] {
  return getPayments().filter((payment) => inRange(payment.paymentDate, range));
}

export function getFinanceTotals(range?: DateRangeFilter): FinanceTotals {
  const payments = getPaymentsInRange(range);
  const sales = getSales().filter((sale) => inRange(sale.saleDate, range));
  const saleReturns = getSaleReturns().filter((item) => inRange(item.returnDate, range));
  const expenses = getExpenses().filter((expense) => inRange(expense.expenseDate, range));

  const income = payments.filter((payment) => payment.direction === 'income');
  const rentalCollected = sumAmounts(income.filter((payment) => RENTAL_TYPES.has(payment.type)));
  const bookingAdvanceCollected = sumAmounts(income.filter((payment) => BOOKING_ADVANCE_TYPES.has(payment.type)));
  const securityDepositCollected = sumAmounts(income.filter((payment) => SECURITY_DEPOSIT_COLLECTION_TYPES.has(payment.type)));
  const feesCollected = sumAmounts(income.filter((payment) => FEE_TYPES.has(payment.type)));
  const adjustments = sumAmounts(income.filter((payment) => payment.type === 'adjustment'));

  const refunds = sumAmounts(payments.filter((payment) => payment.direction === 'refund'));
  // Security deposit refunds are refunds with type security_deposit_refund or source return
  const securityDepositRefunds = sumAmounts(
    payments.filter((payment) => SECURITY_DEPOSIT_REFUND_TYPES.has(payment.type) || (payment.direction === 'refund' && payment.type === 'refund' && payment.source === 'return')),
  );
  const rentalRefunds = sumAmounts(
    payments.filter((payment) => payment.direction === 'refund' && (RENTAL_TYPES.has(payment.type) || payment.type === 'refund') && payment.source !== 'return'),
  );
  const securityDepositRetained = sumAmounts(
    payments.filter((payment) => SECURITY_DEPOSIT_RETENTION_TYPES.has(payment.type)),
  );

  const saleRevenue = sumAmounts(sales) - sumAmounts(saleReturns);
  const saleRefunds = sumAmounts(saleReturns);
  const expenseTotal = sumAmounts(expenses);

  // Gross includes rental + booking advance + security deposit + fees + adjustments + sales
  const grossCollected = rentalCollected + bookingAdvanceCollected + securityDepositCollected + feesCollected + adjustments + sumAmounts(sales);
  const netRentalRevenue = rentalCollected - rentalRefunds;
  const netBookingAdvanceRevenue = bookingAdvanceCollected; // booking advance is rental revenue, distinct but part of rental
  // Liability: collected - refunded - retained (canonical)
  const canonicalLiability = Math.max(securityDepositCollected - securityDepositRefunds - securityDepositRetained, 0);
  const depositLiabilityCollected = canonicalLiability; // new canonical
  const outstandingSecurityDepositLiability = canonicalLiability;

  const totalFees = feesCollected + securityDepositRetained;
  const recognisedIncome = netRentalRevenue + netBookingAdvanceRevenue + saleRevenue + totalFees + adjustments;

  return {
    grossCollected,
    rentalRevenue: netRentalRevenue,
    bookingAdvanceRevenue: netBookingAdvanceRevenue,
    bookingAdvanceCollected,
    saleRevenue,
    depositLiabilityCollected,
    securityDepositCollected,
    depositRefunded: securityDepositRefunds,
    securityDepositRefunded: securityDepositRefunds,
    depositRetained: securityDepositRetained,
    securityDepositRetained,
    feesCollected: totalFees,
    refunds: refunds + saleRefunds,
    expenses: expenseTotal,
    netCashMovement: grossCollected - refunds - saleRefunds - expenseTotal,
    recognisedIncome,
    netResult: recognisedIncome - expenseTotal,
    outstandingSecurityDepositLiability,
  };
}

export type ItemFinance = {
  /** Rental money actually collected for this item, not the listed price. */
  rentalRevenue: number;
  bookingAdvanceRevenue: number;
  saleRevenue: number;
  expenses: number;
  totalRevenue: number;
};

/**
 * Item profitability from realised money only. A confirmed-but-never-delivered
 * booking contributes nothing until money is collected against it.
 */
export function getItemFinance(itemCode: string): ItemFinance {
  const reservations = getReservations().filter(
    (reservation) => reservation.status !== 'cancelled'
      && getReservationItemShare(reservation, itemCode) > 0,
  );
  const reservationByNumber = new Map(
    reservations.map((reservation) => [reservation.reservationNumber, reservation]),
  );

  const payments = getPayments()
    .map((payment) => {
      const reservation = reservationByNumber.get(payment.reservationNumber);
      return reservation
        ? { payment, amount: payment.amount * getReservationItemShare(reservation, itemCode) }
        : null;
    })
    .filter((entry): entry is { payment: PaymentRecord; amount: number } => entry !== null);
  const rentalCollected = payments
    .filter(({ payment }) => payment.direction === 'income' && RENTAL_TYPES.has(payment.type))
    .reduce((total, entry) => total + entry.amount, 0);
  const bookingAdvanceCollected = payments
    .filter(({ payment }) => payment.direction === 'income' && BOOKING_ADVANCE_TYPES.has(payment.type))
    .reduce((total, entry) => total + entry.amount, 0);
  const feesCollected = payments
    .filter(({ payment }) => FEE_TYPES.has(payment.type) && payment.direction === 'income')
    .reduce((total, entry) => total + entry.amount, 0);
  const retainedDeposit = payments
    .filter(({ payment }) => SECURITY_DEPOSIT_RETENTION_TYPES.has(payment.type as string))
    .reduce((total, entry) => total + entry.amount, 0);
  const rentalRefunds = payments
    .filter(({ payment }) => payment.direction === 'refund' && payment.source !== 'return')
    .reduce((total, entry) => total + entry.amount, 0);

  const saleRevenue = sumAmounts(getSales().filter((sale) => sale.dressCode === itemCode))
    - sumAmounts(getSaleReturns().filter((item) => item.dressCode === itemCode));
  const expenses = sumAmounts(getExpenses().filter((expense) => expense.relatedDressCode === itemCode));

  const rentalRevenue = rentalCollected + feesCollected + retainedDeposit - rentalRefunds;
  const bookingAdvanceRevenue = bookingAdvanceCollected;

  return {
    rentalRevenue,
    bookingAdvanceRevenue,
    saleRevenue,
    expenses,
    totalRevenue: rentalRevenue + bookingAdvanceRevenue + saleRevenue,
  };
}

export type OutstandingRentalBalance = {
  reservationNumber: string;
  customerName: string;
  dressCode: string;
  remainingAmount: number;
};

export function getOutstandingRentalBalances(): OutstandingRentalBalance[] {
  return getReservations()
    .filter((reservation) => reservation.status !== 'cancelled' && reservation.remainingAmount > 0)
    .map(({ reservationNumber, customerName, dressCode, remainingAmount }) => ({
      reservationNumber,
      customerName,
      dressCode,
      remainingAmount,
    }));
}

export function getSecurityDepositLiability(): number {
  return getFinanceTotals().outstandingSecurityDepositLiability;
}
