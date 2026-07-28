import { generateId, readCollection, writeCollection } from '../../services/localDatabase';
import { MS_PER_DAY } from '../../shared/domain/businessRules';
import { createDayCloseMethodBreakdown, isActiveDayClosing } from '../../shared/utils/dailyClosingCalculations.js';
import { getTodayISO } from '../../shared/utils/date';
import { formatMoneyOMR } from '../../shared/utils/format';
import { recordAudit } from '../audit/audit.service';
import { getCustomers } from '../customers/customer.service';
import { getDresses } from '../dresses/dress.service';
import { getSales } from '../dresses/sale.service';
import { getSaleReturns } from '../dresses/salesLedger.service';
import { getExpenses } from '../expenses/expense.service';
import { getPayments } from '../payments/payment.service';
import { getFinanceTotals, getItemFinance } from '../finance/finance.service';
import { getAppPreferences } from '../preferences/preferences.service';
import { getReservations } from '../reservations/reservation.service';
import type { CloseDayInput, CustomerBalanceRow, DateRangeFilter, DayCloseBreakdown, DayCloseMethodBreakdown, DayCloseRecord, DressPerformanceRow, FinancialSummary, ReportSummary, TodayReport } from './report.types';

const activeReservationStatuses = new Set(['pending', 'confirmed', 'delivered', 'overdue']);
const DAY_CLOSE_COLLECTION = 'daily-closings';
type Method = 'cash' | 'card' | 'bank_transfer' | 'other';
type LegacyBreakdown = Partial<DayCloseBreakdown> & { cashIncome?: number; cashRefunds?: number; cashExpenses?: number; cardNet?: number; bankTransferNet?: number; otherNet?: number };
type StoredDayCloseRecord = Omit<DayCloseRecord, 'breakdown' | 'status'> & { breakdown: LegacyBreakdown; status?: DayCloseRecord['status'] };


function sum(items: Array<{ amount: number }>): number { return items.reduce((total, item) => total + item.amount, 0); }
function legacyNet(net = 0): DayCloseMethodBreakdown { return createDayCloseMethodBreakdown({ collections: Math.max(net, 0), refunds: Math.max(-net, 0), expenses: 0 }); }
function normalize(current: DayCloseMethodBreakdown | undefined, collections = 0, refunds = 0, expenses = 0): DayCloseMethodBreakdown { return createDayCloseMethodBreakdown(current ?? { collections, refunds, expenses }); }
function normalizeClosing(record: StoredDayCloseRecord): DayCloseRecord { return { ...record, status: record.status ?? 'closed', breakdown: { cash: normalize(record.breakdown.cash, record.breakdown.cashIncome, record.breakdown.cashRefunds, record.breakdown.cashExpenses), card: record.breakdown.card ? normalize(record.breakdown.card) : legacyNet(record.breakdown.cardNet), bankTransfer: record.breakdown.bankTransfer ? normalize(record.breakdown.bankTransfer) : legacyNet(record.breakdown.bankTransferNet), other: record.breakdown.other ? normalize(record.breakdown.other) : legacyNet(record.breakdown.otherNet) } }; }
function inactivityDays(date: string | null): number | null { if (!date) return null; return Math.max(Math.floor((new Date(`${getTodayISO()}T00:00:00`).getTime() - new Date(`${date}T00:00:00`).getTime()) / MS_PER_DAY), 0); }

export function formatReportMoney(amount: number): string { return formatMoneyOMR(amount, 2); }

export function getFinancialSummary(range?: DateRangeFilter): FinancialSummary {
  // Single source of truth: reports, daily close and printed documents all read
  // the same interpretation of money from the finance layer.
  const totals = getFinanceTotals(range);
  return {
    rentalCollected: totals.rentalRevenue,
    salesCollected: totals.saleRevenue,
    totalCollected: totals.grossCollected,
    totalRefunded: totals.refunds,
    totalExpenses: totals.expenses,
    netAmount: totals.netCashMovement,
    depositLiabilityCollected: totals.depositLiabilityCollected,
    depositRetained: totals.depositRetained,
    feesCollected: totals.feesCollected,
    recognisedIncome: totals.recognisedIncome,
  };
}

export function getCustomerBalances(): CustomerBalanceRow[] { return getCustomers().filter((item) => item.remainingBalance > 0).map(({ id, name, phone, remainingBalance }) => ({ id, name, phone, remainingBalance })); }

export function getDressPerformance(): DressPerformanceRow[] {
  const reservations = getReservations(); const sales = getSales(); const returns = getSaleReturns(); const expenses = getExpenses(); const dormantDays = getAppPreferences().dormantDressDays;
  return getDresses().map(({ id, code, name, timesRented, status, purchasePrice }) => {
    const relatedReservations = reservations.filter((item) => item.dressCode === code && item.status !== 'cancelled');
    const relatedSales = sales.filter((item) => item.dressCode === code);
    const relatedReturns = returns.filter((item) => item.dressCode === code);
    const relatedExpenses = expenses.filter((item) => item.relatedDressCode === code);
    // Realised money only: a booking that was never paid contributes nothing.
    const itemFinance = getItemFinance(code);
    const rentalRevenue = itemFinance.rentalRevenue;
    const salesRevenue = itemFinance.saleRevenue;
    const expenseTotal = itemFinance.expenses; const totalRevenue = itemFinance.totalRevenue; const netResult = totalRevenue - purchasePrice - expenseTotal;
    const movements = [...relatedReservations.flatMap((item) => [item.pickupDate, item.returnDate]), ...relatedSales.map((item) => item.saleDate), ...relatedReturns.map((item) => item.returnDate), ...relatedExpenses.map((item) => item.expenseDate)];
    const lastMovementDate = movements.sort((a, b) => b.localeCompare(a))[0] ?? null; const inactiveDays = inactivityDays(lastMovementDate);
    return { id, code, name, timesRented, status, purchasePrice, rentalRevenue, salesRevenue, relatedExpenses: expenseTotal, totalRevenue, netResult, roiPercent: purchasePrice > 0 ? netResult / purchasePrice * 100 : null, recoveredPurchaseCost: totalRevenue >= purchasePrice, maintenanceCostRatio: totalRevenue > 0 ? expenseTotal / totalRevenue * 100 : expenseTotal > 0 ? 100 : null, lastMovementDate, inactivityDays: inactiveDays, requiresReview: (inactiveDays !== null && inactiveDays >= dormantDays) || expenseTotal > totalRevenue };
  }).sort((left, right) => right.totalRevenue - left.totalRevenue);
}

export function getTodayReport(): TodayReport {
  const date = getTodayISO(); const reservations = getReservations(); const payments = getPayments(); const sales = getSales(); const saleReturns = getSaleReturns(); const expenses = getExpenses();
  const paymentsToday = payments.filter((item) => item.paymentDate === date).reduce((total, item) => item.direction === 'income' ? total + item.amount : item.direction === 'refund' ? total - item.amount : total, 0) + sum(sales.filter((item) => item.saleDate === date)) - sum(saleReturns.filter((item) => item.returnDate === date));
  return { date, pickupsToday: reservations.filter((item) => item.pickupDate === date).length, returnsToday: reservations.filter((item) => item.returnDate === date).length, paymentsToday, expensesToday: sum(expenses.filter((item) => item.expenseDate === date)) };
}

export function getReportSummary(range?: DateRangeFilter): ReportSummary { const reservations = getReservations(); const financial = getFinancialSummary(range); return { totalDresses: getDresses().length, activeReservations: reservations.filter((item) => activeReservationStatuses.has(item.status)).length, totalCollected: financial.totalCollected, totalExpenses: financial.totalExpenses, netAmount: financial.netAmount, customersWithBalance: getCustomerBalances().length }; }
export function getDayClosings(): DayCloseRecord[] { return readCollection<StoredDayCloseRecord>(DAY_CLOSE_COLLECTION, []).map(normalizeClosing).sort((left, right) => right.closedAt.localeCompare(left.closedAt)); }

export function calculateDayClose(input: CloseDayInput): DayCloseRecord {
  if (!input.businessDate) throw new Error('تاريخ اليومية مطلوب.'); if (input.businessDate > getTodayISO()) throw new Error('لا يمكن إقفال يومية بتاريخ مستقبلي.'); if (!Number.isFinite(input.openingCash) || input.openingCash < 0) throw new Error('رصيد البداية غير صالح.'); if (!Number.isFinite(input.actualCash) || input.actualCash < 0) throw new Error('الرصيد الفعلي غير صالح.');
  const payments = getPayments().filter((item) => item.paymentDate === input.businessDate); const sales = getSales().filter((item) => item.saleDate === input.businessDate); const returns = getSaleReturns().filter((item) => item.returnDate === input.businessDate); const expenses = getExpenses().filter((item) => item.expenseDate === input.businessDate);
  const paymentIncome = (method: Method) => sum(payments.filter((item) => item.method === method && item.direction === 'income'));
  const refunds = (method: Method) => sum(payments.filter((item) => item.method === method && item.direction === 'refund')) + sum(returns.filter((item) => item.paymentMethod === method));
  const salesIncome = (method: Method) => sum(sales.filter((item) => item.paymentMethod === method)); const expenseTotal = (method: Method) => sum(expenses.filter((item) => item.paymentMethod === method));
  const methodBreakdown = (method: Method) => createDayCloseMethodBreakdown({ collections: paymentIncome(method) + salesIncome(method), refunds: refunds(method), expenses: expenseTotal(method) });
  const breakdown: DayCloseBreakdown = { cash: methodBreakdown('cash'), card: methodBreakdown('card'), bankTransfer: methodBreakdown('bank_transfer'), other: methodBreakdown('other') }; const expectedCash = input.openingCash + breakdown.cash.net;
  return { id: generateId(), businessDate: input.businessDate, openingCash: input.openingCash, expectedCash, actualCash: input.actualCash, difference: input.actualCash - expectedCash, breakdown, notes: input.notes?.trim() || undefined, status: 'closed', closedAt: new Date().toISOString() };
}

export function closeDay(input: CloseDayInput): DayCloseRecord { const closings = getDayClosings(); if (closings.some((item) => item.businessDate === input.businessDate && isActiveDayClosing(item.status))) throw new Error('تم إقفال هذه اليومية بالفعل.'); const closing = calculateDayClose(input); writeCollection(DAY_CLOSE_COLLECTION, [closing, ...closings]); recordAudit({ action: 'close-day', entityType: 'daily-closing', entityId: closing.id, summary: `تم إقفال يومية ${closing.businessDate}.`, nextValues: { expectedCash: closing.expectedCash, actualCash: closing.actualCash, difference: closing.difference } }); return closing; }
export function reopenDay(id: string, reason: string): DayCloseRecord { const closings = getDayClosings(); const closing = closings.find((item) => item.id === id); const normalizedReason = reason.trim(); if (!closing) throw new Error('اليومية المحددة غير موجودة.'); if (!isActiveDayClosing(closing.status)) throw new Error('تمت إعادة فتح هذه اليومية بالفعل.'); if (!normalizedReason) throw new Error('سبب إعادة فتح اليومية مطلوب لحفظ سجل واضح.'); const reopened: DayCloseRecord = { ...closing, status: 'reopened', reopenedAt: new Date().toISOString(), reopenReason: normalizedReason }; writeCollection(DAY_CLOSE_COLLECTION, closings.map((item) => item.id === id ? reopened : item)); recordAudit({ action: 'reopen-day', entityType: 'daily-closing', entityId: closing.id, summary: `تمت إعادة فتح يومية ${closing.businessDate}.`, previousValues: { status: closing.status }, nextValues: { status: reopened.status, reason: normalizedReason } }); return reopened; }
