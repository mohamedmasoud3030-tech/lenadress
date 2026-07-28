import type { DressStatus } from '../dresses/dress.types';

export type ReportSummary = {
  totalDresses: number;
  activeReservations: number;
  totalCollected: number;
  totalExpenses: number;
  netAmount: number;
  customersWithBalance: number;
};

export type TodayReport = {
  date: string;
  pickupsToday: number;
  returnsToday: number;
  paymentsToday: number;
  expensesToday: number;
};

export type DressPerformanceRow = {
  id: string;
  code: string;
  name: string;
  timesRented: number;
  status: DressStatus;
  purchasePrice: number;
  rentalRevenue: number;
  salesRevenue: number;
  relatedExpenses: number;
  totalRevenue: number;
  netResult: number;
  roiPercent: number | null;
  recoveredPurchaseCost: boolean;
  maintenanceCostRatio: number | null;
  lastMovementDate: string | null;
  inactivityDays: number | null;
  requiresReview: boolean;
};

export type CustomerBalanceRow = {
  id: string;
  name: string;
  phone: string;
  remainingBalance: number;
};

export type FinancialSummary = {
  rentalCollected: number;
  salesCollected: number;
  totalCollected: number;
  totalRefunded: number;
  totalExpenses: number;
  /** Net cash movement, not profit. */
  netAmount: number;
  /** Refundable deposits still owed to customers: a liability, never revenue. */
  depositLiabilityCollected: number;
  /** Deposit amounts explicitly retained, which are income. */
  depositRetained: number;
  feesCollected: number;
  /** Rental + sale + fees + retained deposits (excludes refundable deposits). */
  recognisedIncome: number;
};

export type DateRangeFilter = {
  from: string;
  to: string;
};

export type DayCloseMethodBreakdown = {
  collections: number;
  refunds: number;
  expenses: number;
  net: number;
};

export type DayCloseBreakdown = {
  cash: DayCloseMethodBreakdown;
  card: DayCloseMethodBreakdown;
  bankTransfer: DayCloseMethodBreakdown;
  other: DayCloseMethodBreakdown;
};

export type DayCloseStatus = 'closed' | 'reopened';

export type DayCloseRecord = {
  id: string;
  businessDate: string;
  openingCash: number;
  expectedCash: number;
  actualCash: number;
  difference: number;
  breakdown: DayCloseBreakdown;
  notes?: string;
  status: DayCloseStatus;
  closedAt: string;
  reopenedAt?: string;
  reopenReason?: string;
};

export type CloseDayInput = {
  businessDate: string;
  openingCash: number;
  actualCash: number;
  notes?: string;
};
