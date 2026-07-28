import { getSales } from '../dresses/sale.service';
import { getSaleReturns } from '../dresses/salesLedger.service';
import { getExpenses } from '../expenses/expense.service';
import { getPayments } from '../payments/payment.service';
import type { PaymentRecord } from '../payments/payment.types';
import { getReservations } from '../reservations/reservation.service';
import type { DateRangeFilter } from '../reports/report.types';

/**
 * Phase 3 — one financial truth.
 *
 * Every page used to compute its own numbers, which let the reports, the daily
 * close and the printed documents disagree. This module is the single place
 * where money is interpreted, and every consumer reads from it.
 *
 * Rules encoded here:
 * - A refundable deposit is a **liability**, never revenue. It is cash in, but
 *   it belongs to the customer until it is refunded or explicitly retained.
 * - Only a **retained** deposit becomes showroom income.
 * - Cash collected is not profit: refunds and expenses are deducted.
 * - Rental revenue is recognised from money actually collected against rentals,
 *   never from the listed price of a booking that was never fulfilled.
 * - Sale revenue is net of sale returns.
 */

export type MoneyMethod = 'cash' | 'card' | 'bank_transfer' | 'other';

export type FinanceTotals = {
  /** Cash actually received, including deposits (which are a liability). */
  grossCollected: number;
  rentalRevenue: number;
  saleRevenue: number;
  /** Refundable deposits collected and not yet settled: a liability, not income. */
  depositLiabilityCollected: number;
  depositRefunded: number;
  depositRetained: number;
  feesCollected: number;
  refunds: number;
  expenses: number;
  /** Cash movement: everything in minus everything out. */
  netCashMovement: number;
  /** Recognised income: rental + sale + fees + retained deposits, minus expenses. */
  recognisedIncome: number;
  netResult: number;
};

const FEE_TYPES = new Set(['late_fee', 'damage_fee', 'penalty']);

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
  const rentalCollected = sumAmounts(income.filter((payment) => payment.type === 'rental'));
  const depositCollected = sumAmounts(income.filter((payment) => payment.type === 'deposit'));
  const feesCollected = sumAmounts(income.filter((payment) => FEE_TYPES.has(payment.type)));
  const adjustments = sumAmounts(income.filter((payment) => payment.type === 'adjustment'));

  const refunds = sumAmounts(payments.filter((payment) => payment.direction === 'refund'));
  const settlementFees = sumAmounts(
    payments.filter((payment) => payment.direction === 'settlement' && FEE_TYPES.has(payment.type)),
  );
  const depositRetained = sumAmounts(
    payments.filter((payment) => payment.direction === 'settlement' && payment.type === 'retained_deposit'),
  );

  const saleRevenue = sumAmounts(sales) - sumAmounts(saleReturns);
  const saleRefunds = sumAmounts(saleReturns);
  const expenseTotal = sumAmounts(expenses);

  const grossCollected = rentalCollected + depositCollected + feesCollected + adjustments + sumAmounts(sales);
  const depositLiabilityCollected = Math.max(depositCollected - depositRetained, 0);
  const totalFees = feesCollected + settlementFees;
  const recognisedIncome = rentalCollected + saleRevenue + totalFees + depositRetained + adjustments;

  return {
    grossCollected,
    rentalRevenue: rentalCollected,
    saleRevenue,
    depositLiabilityCollected,
    depositRefunded: refunds,
    depositRetained,
    feesCollected: totalFees,
    refunds: refunds + saleRefunds,
    expenses: expenseTotal,
    netCashMovement: grossCollected - refunds - saleRefunds - expenseTotal,
    recognisedIncome,
    netResult: recognisedIncome - expenseTotal,
  };
}

export type ItemFinance = {
  /** Rental money actually collected for this item, not the listed price. */
  rentalRevenue: number;
  saleRevenue: number;
  expenses: number;
  totalRevenue: number;
};

/**
 * Item profitability from realised money only. A confirmed-but-never-delivered
 * booking contributes nothing until money is collected against it.
 */
export function getItemFinance(itemCode: string): ItemFinance {
  const reservationNumbers = new Set(
    getReservations()
      .filter((reservation) => reservation.dressCode === itemCode && reservation.status !== 'cancelled')
      .map((reservation) => reservation.reservationNumber),
  );

  const payments = getPayments().filter((payment) => reservationNumbers.has(payment.reservationNumber));
  const rentalCollected = sumAmounts(
    payments.filter((payment) => payment.direction === 'income' && payment.type === 'rental'),
  );
  const feesCollected = sumAmounts(
    payments.filter((payment) => FEE_TYPES.has(payment.type) && payment.direction !== 'refund'),
  );
  const retained = sumAmounts(
    payments.filter((payment) => payment.direction === 'settlement' && payment.type === 'retained_deposit'),
  );

  const saleRevenue = sumAmounts(getSales().filter((sale) => sale.dressCode === itemCode))
    - sumAmounts(getSaleReturns().filter((item) => item.dressCode === itemCode));
  const expenses = sumAmounts(getExpenses().filter((expense) => expense.relatedDressCode === itemCode));

  const rentalRevenue = rentalCollected + feesCollected + retained;

  return {
    rentalRevenue,
    saleRevenue,
    expenses,
    totalRevenue: rentalRevenue + saleRevenue,
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
