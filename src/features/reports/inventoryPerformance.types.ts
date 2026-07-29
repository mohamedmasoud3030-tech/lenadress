import type { AccessoryCategory, AccessoryStatus } from '../accessories/accessory.types';
import type { DressCategory, DressStatus } from '../dresses/dress.types';

export type PerformanceItemKind = 'dress' | 'accessory';

export type PerformanceOperationType = 'rental' | 'sale' | 'both';

export type PerformancePeriodGranularity = 'week' | 'month' | 'year';

export type PerformanceSortKey =
  | 'revenue'
  | 'netResult'
  | 'rentalCount'
  | 'utilisationRate'
  | 'idleDays'
  | 'serviceCost';

export type InventoryPerformanceFilters = {
  /** Inclusive ISO start of the reporting period. */
  from: string;
  /** Inclusive ISO end of the reporting period. */
  to: string;
  kind: 'all' | PerformanceItemKind;
  /** Dress category or accessory category value; `all` keeps everything. */
  category: 'all' | DressCategory | AccessoryCategory;
  /** Dress status or accessory status value; `all` keeps everything. */
  status: 'all' | DressStatus | AccessoryStatus;
  operation: PerformanceOperationType;
  granularity: PerformancePeriodGranularity;
  sortBy: PerformanceSortKey;
  sortDirection: 'asc' | 'desc';
  /** Days without any use after which an item counts as idle. */
  idleThresholdDays: number;
  search: string;
};

/**
 * One row of the inventory performance report.
 *
 * Every money field is realised money taken from the finance layer, restricted
 * to the reporting period. Nothing here is summed from a screen.
 */
export type InventoryPerformanceRow = {
  id: string;
  kind: PerformanceItemKind;
  code: string;
  name: string;
  category: string;
  status: string;
  /** Number of rentals whose booked period intersects the reporting period. */
  rentalCount: number;
  /** Completed sales inside the period, net of sale returns. */
  saleCount: number;
  saleReturnCount: number;
  rentalRevenue: number;
  saleRevenue: number;
  totalRevenue: number;
  discounts: number;
  serviceCost: number;
  damageCost: number;
  totalCost: number;
  netResult: number;
  /** Booked days that fall inside the reporting period. */
  occupiedDays: number;
  /** Days the item could have been rented inside the period. */
  availableDays: number;
  utilisationRate: number;
  averageTransactionValue: number;
  averageRentalDays: number;
  lateCount: number;
  damageCount: number;
  lossCount: number;
  lastUsedDate: string | null;
  idleDays: number | null;
  /** Rentals per available day inside the period. */
  turnoverRate: number;
  isIdle: boolean;
  /** Service and damage cost as a share of revenue, or null when there is none. */
  costToRevenueRatio: number | null;
};

export type InventoryPerformanceTotals = {
  itemCount: number;
  rentalCount: number;
  saleCount: number;
  totalRevenue: number;
  discounts: number;
  totalCost: number;
  netResult: number;
  averageUtilisationRate: number;
  idleItemCount: number;
  /** Items whose service and damage cost exceeds their revenue. */
  costHeavyItemCount: number;
  lateCount: number;
};

export type PerformancePeriodPoint = {
  /** Period key, e.g. `2026-W12`, `2026-03` or `2026`. */
  period: string;
  label: string;
  rentalCount: number;
  revenue: number;
  cost: number;
  netResult: number;
};

/**
 * A design's performance, aggregated from its pieces.
 *
 * Money and usage are never recomputed here: the figures are summed from the
 * per-piece rows that the finance layer already produced, so a design can never
 * report a number its own pieces do not add up to.
 */
export type DesignPerformanceRow = {
  designId: string;
  code: string;
  name: string;
  category: string;
  pieceCount: number;
  rentalCount: number;
  saleCount: number;
  totalRevenue: number;
  discounts: number;
  totalCost: number;
  netResult: number;
  /** Occupied days across every piece. */
  occupiedDays: number;
  /** Available days across every piece. */
  availableDays: number;
  /** Occupied days divided by available days, across the whole design. */
  utilisationRate: number;
  lateCount: number;
  /** Revenue of the single best-earning piece, to expose an unbalanced design. */
  bestPieceRevenue: number;
  bestPieceCode: string | null;
  /** Pieces that earned nothing at all during the period. */
  idlePieceCount: number;
};

export type InventoryPerformanceReport = {
  filters: InventoryPerformanceFilters;
  generatedAt: string;
  rows: InventoryPerformanceRow[];
  totals: InventoryPerformanceTotals;
  timeline: PerformancePeriodPoint[];
  topPerformers: InventoryPerformanceRow[];
  lowPerformers: InventoryPerformanceRow[];
  idleItems: InventoryPerformanceRow[];
  serviceHeavyItems: InventoryPerformanceRow[];
  chronicallyLateItems: InventoryPerformanceRow[];
  /** Per-design roll-up; empty when the showroom uses no designs. */
  designRows: DesignPerformanceRow[];
};

export type PerformanceReservationLine = {
  reservationNumber: string;
  customerName: string;
  pickupDate: string;
  returnDate: string;
  status: string;
  occupiedDays: number;
  collected: number;
  wasLate: boolean;
};

export type PerformanceCostLine = {
  reference: string;
  date: string;
  title: string;
  category: string;
  amount: number;
};

export type PerformanceRevenueLine = {
  reference: string;
  date: string;
  kind: 'rental' | 'fee' | 'retained_deposit' | 'sale' | 'sale_return';
  amount: number;
};

export type InventoryPerformanceDetail = {
  row: InventoryPerformanceRow;
  timeline: PerformancePeriodPoint[];
  reservations: PerformanceReservationLine[];
  revenues: PerformanceRevenueLine[];
  costs: PerformanceCostLine[];
  /** Accessories rented alongside this dress inside the period. */
  linkedAccessories: Array<{ code: string; name: string; times: number }>;
};
