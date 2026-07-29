import { addDaysISO, differenceInDays, getTodayISO } from '../../shared/utils/date';
import { getAccessories } from '../accessories/accessory.service';
import { getReservationAccessories } from '../accessories/reservationAccessory.service';
import { getDresses } from '../dresses/dress.service';
import { getDressDesigns } from '../dresses/design.service';
import { getSales } from '../dresses/sale.service';
import { getSaleReturns } from '../dresses/salesLedger.service';
import { getExpenses } from '../expenses/expense.service';
import { getPayments } from '../payments/payment.service';
import { getAppPreferences } from '../preferences/preferences.service';
import { getReservations } from '../reservations/reservation.service';
import {
  ACCESSORY_CATEGORY_LABELS,
  ACCESSORY_STATUS_LABELS,
} from '../../shared/domain/accessoryConstants';
import { DRESS_STATUS_LABELS } from '../../shared/domain/dressConstants';
import { RESERVATION_STATUS_LABELS } from '../../shared/domain/reservationConstants';
import type { PaymentRecord } from '../payments/payment.types';
import type { Reservation } from '../reservations/reservation.types';
import type {
  DesignPerformanceRow,
  InventoryPerformanceDetail,
  InventoryPerformanceFilters,
  InventoryPerformanceReport,
  InventoryPerformanceRow,
  InventoryPerformanceTotals,
  PerformanceCostLine,
  PerformancePeriodGranularity,
  PerformancePeriodPoint,
  PerformanceReservationLine,
  PerformanceRevenueLine,
  PerformanceSortKey,
} from './inventoryPerformance.types';
import { matchesSearchQuery } from '../../shared/utils/search';

/**
 * Inventory performance and profitability.
 *
 * ## Source of truth for every number
 *
 * | Metric | Source |
 * | --- | --- |
 * | Rental revenue | `payments` rows with `direction: 'income'` and `type: 'rental'`, plus settlement fees and retained deposits, matched to the item through the reservation. Never the listed price of a booking. |
 * | Sale revenue | `sales` rows minus `sale-returns` rows for the same item. The invoice writes exactly one `sales` row per line, so a payment record and a sale record never double-count the same event. |
 * | Discounts | `listRentalPrice - rentalPrice` on the reservation and `listPrice - amount` on the sale line. Both are snapshots taken when the deal was struck, so a later catalogue price change cannot invent a discount. |
 * | Service and damage cost | `expenses` linked to the item (`relatedDressCode`) or to the accessory (`relatedAccessoryCode`). Accessory damage and loss charges are posted there by the return workflow. |
 * | Occupied days | Booked days of non-cancelled reservations, clipped to the reporting period. |
 * | Available days | Days of the reporting period, minus the days the item was retired, sold or out of service before/after the period boundaries. |
 *
 * ## Formulas
 *
 * - **Utilisation rate** = occupied days inside the period ÷ available days inside the period.
 * - **Net result** = realised revenue − discounts already excluded from revenue − service, damage and loss costs attributed to the item.
 * - **Idle item** = no rental, sale or service movement for at least the configured idle threshold (default: the showroom's dormant-days setting).
 * - **High performer** = ranked on net result *and* utilisation, never on booking count alone.
 * - **Turnover rate** = rentals in the period ÷ available days in the period.
 *
 * ## Exclusions
 *
 * - Cancelled reservations contribute no revenue and no occupied days.
 * - A booking that was never paid contributes no revenue, only occupancy.
 * - A refunded amount reduces revenue; a returned sale reverses its own revenue.
 */

const FEE_TYPES = new Set(['late_fee', 'damage_fee', 'penalty']);
const SERVICE_EXPENSE_CATEGORIES = new Set(['laundry', 'tailoring', 'maintenance']);
const DAMAGE_EXPENSE_CATEGORIES = new Set(['purchase']);
const CANCELLED = 'cancelled';

const MONTH_LABELS = [
  'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر',
];

export const PERFORMANCE_SORT_LABELS: Record<PerformanceSortKey, string> = {
  revenue: 'الإيراد',
  netResult: 'صافي العائد',
  rentalCount: 'عدد مرات التأجير',
  utilisationRate: 'نسبة الإشغال',
  idleDays: 'الركود',
  serviceCost: 'تكلفة الصيانة',
};

export const PERFORMANCE_GRANULARITY_LABELS: Record<PerformancePeriodGranularity, string> = {
  week: 'أسبوعي',
  month: 'شهري',
  year: 'سنوي',
};

function sumAmounts(items: Array<{ amount: number }>): number {
  return items.reduce((total, item) => total + item.amount, 0);
}

function inRange(date: string, from: string, to: string): boolean {
  return date >= from && date <= to;
}

/** Days of a booked period that fall inside the reporting window. */
export function overlapDays(period: { pickupDate: string; returnDate: string }, from: string, to: string): number {
  const start = period.pickupDate > from ? period.pickupDate : from;
  const end = period.returnDate < to ? period.returnDate : to;
  if (end < start) return 0;
  // Both endpoints are occupied: a same-day pickup and return still occupies one day.
  return differenceInDays(start, end) + 1;
}

export function getDefaultPerformanceFilters(): InventoryPerformanceFilters {
  const to = getTodayISO();
  return {
    from: addDaysISO(to, -89),
    to,
    kind: 'all',
    category: 'all',
    status: 'all',
    operation: 'both',
    granularity: 'month',
    sortBy: 'netResult',
    sortDirection: 'desc',
    idleThresholdDays: getAppPreferences().dormantDressDays,
    search: '',
  };
}

function periodKey(date: string, granularity: PerformancePeriodGranularity): string {
  if (granularity === 'year') return date.slice(0, 4);
  if (granularity === 'month') return date.slice(0, 7);
  // ISO week key, computed on local calendar days.
  const parsed = new Date(`${date}T00:00:00`);
  const target = new Date(parsed.getTime());
  target.setDate(target.getDate() + 4 - (target.getDay() || 7));
  const yearStart = new Date(target.getFullYear(), 0, 1);
  const week = Math.ceil(((target.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${target.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

function periodLabel(key: string, granularity: PerformancePeriodGranularity): string {
  if (granularity === 'year') return key;
  if (granularity === 'month') {
    const [year, month] = key.split('-');
    return `${MONTH_LABELS[Number(month) - 1]} ${year}`;
  }
  const [year, week] = key.split('-W');
  return `الأسبوع ${Number(week)} / ${year}`;
}

type ItemMoney = {
  rentalRevenue: number;
  saleRevenue: number;
  discounts: number;
  serviceCost: number;
  damageCost: number;
  revenueLines: PerformanceRevenueLine[];
  costLines: PerformanceCostLine[];
};

/**
 * Realised money for one dress inside the period.
 *
 * Rental money is matched through the reservation, so a payment always lands on
 * the item that was actually rented. Sale money comes from the sale records,
 * which the invoice writes once per line — the payment ledger never records a
 * second copy of the same sale, so there is no double count.
 */
function getDressMoney(itemCode: string, from: string, to: string, payments: PaymentRecord[], reservations: Reservation[]): ItemMoney {
  const itemReservations = reservations.filter(
    (reservation) => reservation.dressCode === itemCode && reservation.status !== CANCELLED,
  );
  const reservationNumbers = new Set(itemReservations.map((reservation) => reservation.reservationNumber));

  const itemPayments = payments.filter(
    (payment) => reservationNumbers.has(payment.reservationNumber) && inRange(payment.paymentDate, from, to),
  );

  const rentalCollected = sumAmounts(itemPayments.filter((payment) => payment.direction === 'income' && payment.type === 'rental'));
  const feesCollected = sumAmounts(itemPayments.filter((payment) => FEE_TYPES.has(payment.type) && payment.direction !== 'refund'));
  const retained = sumAmounts(itemPayments.filter((payment) => payment.direction === 'settlement' && payment.type === 'retained_deposit'));
  // A rental refund gives money back and must reduce the recognised rental revenue.
  const rentalRefunds = sumAmounts(itemPayments.filter((payment) => payment.direction === 'refund'));

  const sales = getSales().filter((sale) => sale.dressCode === itemCode && inRange(sale.saleDate, from, to));
  const saleReturns = getSaleReturns().filter((item) => item.dressCode === itemCode && inRange(item.returnDate, from, to));
  const saleRevenue = sumAmounts(sales) - sumAmounts(saleReturns);

  const rentalDiscounts = itemReservations
    .filter((reservation) => inRange(reservation.pickupDate, from, to))
    .reduce((total, reservation) => total + Math.max((reservation.listRentalPrice ?? reservation.rentalPrice) - reservation.rentalPrice, 0), 0);
  const saleDiscounts = sales.reduce((total, sale) => total + Math.max((sale.listPrice ?? sale.amount) - sale.amount, 0), 0);

  const expenses = getExpenses().filter(
    (expense) => expense.relatedDressCode === itemCode && inRange(expense.expenseDate, from, to),
  );
  const serviceCost = sumAmounts(expenses.filter((expense) => SERVICE_EXPENSE_CATEGORIES.has(expense.category)));
  const damageCost = sumAmounts(expenses.filter((expense) => DAMAGE_EXPENSE_CATEGORIES.has(expense.category)));

  const revenueLines: PerformanceRevenueLine[] = [
    ...itemPayments
      .filter((payment) => payment.direction !== 'refund' && (payment.type === 'rental' || FEE_TYPES.has(payment.type) || payment.type === 'retained_deposit'))
      .map((payment) => ({
        reference: payment.paymentNumber,
        date: payment.paymentDate,
        kind: payment.type === 'rental' ? ('rental' as const) : payment.type === 'retained_deposit' ? ('retained_deposit' as const) : ('fee' as const),
        amount: payment.amount,
      })),
    ...sales.map((sale) => ({ reference: sale.saleNumber, date: sale.saleDate, kind: 'sale' as const, amount: sale.amount })),
    ...saleReturns.map((item) => ({ reference: item.returnNumber, date: item.returnDate, kind: 'sale_return' as const, amount: -item.amount })),
  ].sort((left, right) => right.date.localeCompare(left.date));

  const costLines: PerformanceCostLine[] = expenses
    .map((expense) => ({ reference: expense.expenseNumber, date: expense.expenseDate, title: expense.title, category: expense.category, amount: expense.amount }))
    .sort((left, right) => right.date.localeCompare(left.date));

  return {
    rentalRevenue: rentalCollected + feesCollected + retained - rentalRefunds,
    saleRevenue,
    discounts: rentalDiscounts + saleDiscounts,
    serviceCost,
    damageCost,
    revenueLines,
    costLines,
  };
}

/**
 * Realised money for one accessory inside the period.
 *
 * An accessory earns through its reservation links: the agreed accessory rental
 * price is realised once the reservation it belongs to actually collected rental
 * money. Its costs are the damage and loss charges the return workflow posted
 * against its code.
 */
function getAccessoryMoney(accessoryCode: string, accessoryId: string, from: string, to: string, reservations: Reservation[]): ItemMoney {
  const reservationByNumber = new Map(reservations.map((reservation) => [reservation.reservationNumber, reservation]));
  const links = getReservationAccessories().filter((link) => link.accessoryId === accessoryId);

  const revenueLines: PerformanceRevenueLine[] = [];
  let rentalRevenue = 0;

  links.forEach((link) => {
    const reservation = reservationByNumber.get(link.reservationNumber);
    if (!reservation || reservation.status === CANCELLED) return;
    // Only a delivered accessory has actually earned its rental price.
    if (!link.deliveredAt) return;
    const earnedOn = link.deliveredAt.slice(0, 10);
    if (!inRange(earnedOn, from, to)) return;
    if (link.rentalPrice <= 0) return;
    rentalRevenue += link.rentalPrice;
    revenueLines.push({ reference: link.reservationNumber, date: earnedOn, kind: 'rental', amount: link.rentalPrice });
  });

  const expenses = getExpenses().filter(
    (expense) => expense.relatedAccessoryCode === accessoryCode && inRange(expense.expenseDate, from, to),
  );
  const serviceCost = sumAmounts(expenses.filter((expense) => SERVICE_EXPENSE_CATEGORIES.has(expense.category)));
  const damageCost = sumAmounts(expenses.filter((expense) => DAMAGE_EXPENSE_CATEGORIES.has(expense.category)));

  const costLines: PerformanceCostLine[] = expenses
    .map((expense) => ({ reference: expense.expenseNumber, date: expense.expenseDate, title: expense.title, category: expense.category, amount: expense.amount }))
    .sort((left, right) => right.date.localeCompare(left.date));

  return {
    rentalRevenue,
    saleRevenue: 0,
    discounts: 0,
    serviceCost,
    damageCost,
    revenueLines: revenueLines.sort((left, right) => right.date.localeCompare(left.date)),
    costLines,
  };
}

function buildRow(
  base: { id: string; kind: 'dress' | 'accessory'; code: string; name: string; category: string; status: string; retiredAt?: string },
  money: ItemMoney,
  usage: {
    rentals: Reservation[];
    saleCount: number;
    saleReturnCount: number;
    lateCount: number;
    damageCount: number;
    lossCount: number;
    lastUsedDate: string | null;
  },
  filters: InventoryPerformanceFilters,
): InventoryPerformanceRow {
  const { from, to } = filters;
  const periodDays = differenceInDays(from, to) + 1;
  // An item retired inside the period stops being rentable from that day on.
  const retiredOn = base.retiredAt?.slice(0, 10);
  const availableDays = retiredOn && retiredOn >= from && retiredOn <= to
    ? Math.max(differenceInDays(from, retiredOn), 0)
    : retiredOn && retiredOn < from
      ? 0
      : periodDays;

  const occupiedDays = usage.rentals.reduce((total, reservation) => total + overlapDays(reservation, from, to), 0);
  const rentalDays = usage.rentals.reduce((total, reservation) => total + differenceInDays(reservation.pickupDate, reservation.returnDate) + 1, 0);
  const totalRevenue = money.rentalRevenue + money.saleRevenue;
  const totalCost = money.serviceCost + money.damageCost;
  const transactionCount = usage.rentals.length + usage.saleCount;
  const idleDays = usage.lastUsedDate ? Math.max(differenceInDays(usage.lastUsedDate, to), 0) : null;

  return {
    id: base.id,
    kind: base.kind,
    code: base.code,
    name: base.name,
    category: base.category,
    status: base.status,
    rentalCount: usage.rentals.length,
    saleCount: usage.saleCount,
    saleReturnCount: usage.saleReturnCount,
    rentalRevenue: money.rentalRevenue,
    saleRevenue: money.saleRevenue,
    totalRevenue,
    discounts: money.discounts,
    serviceCost: money.serviceCost,
    damageCost: money.damageCost,
    totalCost,
    netResult: totalRevenue - totalCost,
    occupiedDays,
    availableDays,
    utilisationRate: availableDays > 0 ? occupiedDays / availableDays : 0,
    averageTransactionValue: transactionCount > 0 ? totalRevenue / transactionCount : 0,
    averageRentalDays: usage.rentals.length > 0 ? rentalDays / usage.rentals.length : 0,
    lateCount: usage.lateCount,
    damageCount: usage.damageCount,
    lossCount: usage.lossCount,
    lastUsedDate: usage.lastUsedDate,
    idleDays,
    turnoverRate: availableDays > 0 ? usage.rentals.length / availableDays : 0,
    // Never used at all inside a period longer than the threshold also counts as idle.
    isIdle: idleDays === null ? periodDays >= filters.idleThresholdDays : idleDays >= filters.idleThresholdDays,
    costToRevenueRatio: totalRevenue > 0 ? totalCost / totalRevenue : totalCost > 0 ? 1 : null,
  };
}

function sortRows(rows: InventoryPerformanceRow[], sortBy: PerformanceSortKey, direction: 'asc' | 'desc'): InventoryPerformanceRow[] {
  const value = (row: InventoryPerformanceRow): number => {
    switch (sortBy) {
      case 'revenue': return row.totalRevenue;
      case 'netResult': return row.netResult;
      case 'rentalCount': return row.rentalCount;
      case 'utilisationRate': return row.utilisationRate;
      case 'idleDays': return row.idleDays ?? Number.MAX_SAFE_INTEGER;
      case 'serviceCost': return row.serviceCost + row.damageCost;
      default: return row.netResult;
    }
  };

  return [...rows].sort((left, right) => {
    const delta = value(left) - value(right);
    if (delta !== 0) return direction === 'asc' ? delta : -delta;
    return left.code.localeCompare(right.code);
  });
}

function matchesFilters(row: InventoryPerformanceRow, filters: InventoryPerformanceFilters, rawCategory: string, rawStatus: string): boolean {
  if (filters.kind !== 'all' && row.kind !== filters.kind) return false;
  if (filters.category !== 'all' && rawCategory !== filters.category) return false;
  if (filters.status !== 'all' && rawStatus !== filters.status) return false;
  if (filters.operation === 'rental' && row.rentalCount === 0 && row.rentalRevenue === 0) return false;
  if (filters.operation === 'sale' && row.saleCount === 0 && row.saleRevenue === 0) return false;
  if (filters.search && !matchesSearchQuery(filters.search, [row.code, row.name])) return false;
  return true;
}

function buildTimeline(rows: InventoryPerformanceRow[], details: Map<string, ItemMoney>, filters: InventoryPerformanceFilters, rentalsByItem: Map<string, Reservation[]>): PerformancePeriodPoint[] {
  const buckets = new Map<string, PerformancePeriodPoint>();

  const bucket = (date: string): PerformancePeriodPoint => {
    const key = periodKey(date, filters.granularity);
    const existing = buckets.get(key);
    if (existing) return existing;
    const created: PerformancePeriodPoint = { period: key, label: periodLabel(key, filters.granularity), rentalCount: 0, revenue: 0, cost: 0, netResult: 0 };
    buckets.set(key, created);
    return created;
  };

  rows.forEach((row) => {
    const money = details.get(row.id);
    money?.revenueLines.forEach((line) => {
      const point = bucket(line.date);
      point.revenue += line.amount;
    });
    money?.costLines.forEach((line) => {
      const point = bucket(line.date);
      point.cost += line.amount;
    });
    (rentalsByItem.get(row.id) ?? []).forEach((reservation) => {
      if (!inRange(reservation.pickupDate, filters.from, filters.to)) return;
      bucket(reservation.pickupDate).rentalCount += 1;
    });
  });

  return Array.from(buckets.values())
    .map((point) => ({ ...point, netResult: point.revenue - point.cost }))
    .sort((left, right) => left.period.localeCompare(right.period));
}

type BuiltRow = {
  row: InventoryPerformanceRow;
  money: ItemMoney;
  rentals: Reservation[];
};

function buildAllRows(filters: InventoryPerformanceFilters): BuiltRow[] {
  const { from, to } = filters;
  const reservations = getReservations();
  const payments = getPayments();
  const links = getReservationAccessories();
  const built: BuiltRow[] = [];

  getDresses().forEach((dress) => {
    const rentals = reservations.filter(
      (reservation) => reservation.dressCode === dress.code
        && reservation.status !== CANCELLED
        && overlapDays(reservation, from, to) > 0,
    );
    const sales = getSales().filter((sale) => sale.dressCode === dress.code && inRange(sale.saleDate, from, to));
    const saleReturns = getSaleReturns().filter((item) => item.dressCode === dress.code && inRange(item.returnDate, from, to));
    const money = getDressMoney(dress.code, from, to, payments, reservations);

    const lateCount = rentals.filter((reservation) => reservation.status === 'overdue').length;
    const damageCount = getExpenses().filter(
      (expense) => expense.relatedDressCode === dress.code && expense.category === 'maintenance' && inRange(expense.expenseDate, from, to),
    ).length;

    const movements = [
      ...rentals.map((reservation) => reservation.pickupDate),
      ...sales.map((sale) => sale.saleDate),
      ...money.costLines.map((line) => line.date),
    ].filter((date) => date <= to);
    const lastUsedDate = movements.sort((left, right) => right.localeCompare(left))[0] ?? null;

    const row = buildRow(
      {
        id: dress.id,
        kind: 'dress',
        code: dress.code,
        name: dress.name,
        category: dress.category,
        status: DRESS_STATUS_LABELS[dress.status],
        retiredAt: dress.archivedAt,
      },
      money,
      { rentals, saleCount: sales.length, saleReturnCount: saleReturns.length, lateCount, damageCount, lossCount: 0, lastUsedDate },
      filters,
    );

    if (matchesFilters(row, filters, dress.category, dress.status)) built.push({ row, money, rentals });
  });

  getAccessories().forEach((accessory) => {
    const accessoryLinks = links.filter((link) => link.accessoryId === accessory.id);
    const linkedNumbers = new Set(accessoryLinks.map((link) => link.reservationNumber));
    const rentals = reservations.filter(
      (reservation) => linkedNumbers.has(reservation.reservationNumber)
        && reservation.status !== CANCELLED
        && overlapDays(reservation, from, to) > 0,
    );
    const money = getAccessoryMoney(accessory.code, accessory.id, from, to, reservations);

    const closedInPeriod = accessoryLinks.filter((link) => link.returnedAt && inRange(link.returnedAt.slice(0, 10), from, to));
    const damageCount = closedInPeriod.filter((link) => link.returnCondition === 'damaged').length;
    const lossCount = closedInPeriod.filter((link) => link.returnCondition === 'lost').length;
    const lateCount = rentals.filter((reservation) => reservation.status === 'overdue').length;

    const movements = [
      ...rentals.map((reservation) => reservation.pickupDate),
      ...money.costLines.map((line) => line.date),
    ].filter((date) => date <= to);
    const lastUsedDate = movements.sort((left, right) => right.localeCompare(left))[0] ?? null;

    const row = buildRow(
      {
        id: accessory.id,
        kind: 'accessory',
        code: accessory.code,
        name: accessory.name,
        category: ACCESSORY_CATEGORY_LABELS[accessory.category],
        status: ACCESSORY_STATUS_LABELS[accessory.status],
        retiredAt: accessory.retiredAt,
      },
      money,
      { rentals, saleCount: 0, saleReturnCount: 0, lateCount, damageCount, lossCount, lastUsedDate },
      filters,
    );

    if (matchesFilters(row, filters, accessory.category, accessory.status)) built.push({ row, money, rentals });
  });

  return built;
}

function summarize(rows: InventoryPerformanceRow[]): InventoryPerformanceTotals {
  const utilisationSum = rows.reduce((total, row) => total + row.utilisationRate, 0);
  return {
    itemCount: rows.length,
    rentalCount: rows.reduce((total, row) => total + row.rentalCount, 0),
    saleCount: rows.reduce((total, row) => total + row.saleCount, 0),
    totalRevenue: rows.reduce((total, row) => total + row.totalRevenue, 0),
    discounts: rows.reduce((total, row) => total + row.discounts, 0),
    totalCost: rows.reduce((total, row) => total + row.totalCost, 0),
    netResult: rows.reduce((total, row) => total + row.netResult, 0),
    averageUtilisationRate: rows.length > 0 ? utilisationSum / rows.length : 0,
    idleItemCount: rows.filter((row) => row.isIdle).length,
    costHeavyItemCount: rows.filter((row) => row.totalCost > row.totalRevenue && row.totalCost > 0).length,
    lateCount: rows.reduce((total, row) => total + row.lateCount, 0),
  };
}

/**
 * Ranks items on realised value, not on popularity.
 *
 * The score combines net result with utilisation so a frequently-booked item
 * that barely covers its own cleaning does not outrank a quieter, profitable one.
 */
function performanceScore(row: InventoryPerformanceRow): number {
  return row.netResult * (0.5 + row.utilisationRate);
}

/**
 * Rolls per-piece rows up to their design.
 *
 * Every figure is summed from rows the finance layer already produced, so a
 * design can never report a number its own pieces do not add up to. Designs with
 * no pieces in the filtered set are omitted rather than shown as empty noise.
 */
function summarizeDesignPerformance(rows: InventoryPerformanceRow[]): DesignPerformanceRow[] {
  const designs = getDressDesigns();
  if (designs.length === 0) return [];

  // A row is a piece; map it back to its design through the inventory record.
  const designByPieceId = new Map<string, string>();
  getDresses().forEach((dress) => {
    if (dress.designId) designByPieceId.set(dress.id, dress.designId);
  });

  const grouped = new Map<string, InventoryPerformanceRow[]>();
  rows.forEach((row) => {
    const designId = designByPieceId.get(row.id);
    if (!designId) return;
    grouped.set(designId, [...(grouped.get(designId) ?? []), row]);
  });

  return designs
    .filter((design) => grouped.has(design.id))
    .map((design) => {
      const pieceRows = grouped.get(design.id) ?? [];
      const occupiedDays = pieceRows.reduce((total, row) => total + row.occupiedDays, 0);
      const availableDays = pieceRows.reduce((total, row) => total + row.availableDays, 0);
      const best = pieceRows.reduce<InventoryPerformanceRow | null>(
        (winner, row) => (winner === null || row.totalRevenue > winner.totalRevenue ? row : winner),
        null,
      );

      return {
        designId: design.id,
        code: design.code,
        name: design.name,
        category: design.category,
        pieceCount: pieceRows.length,
        rentalCount: pieceRows.reduce((total, row) => total + row.rentalCount, 0),
        saleCount: pieceRows.reduce((total, row) => total + row.saleCount, 0),
        totalRevenue: pieceRows.reduce((total, row) => total + row.totalRevenue, 0),
        discounts: pieceRows.reduce((total, row) => total + row.discounts, 0),
        totalCost: pieceRows.reduce((total, row) => total + row.totalCost, 0),
        netResult: pieceRows.reduce((total, row) => total + row.netResult, 0),
        occupiedDays,
        availableDays,
        // Pooled across the design: one busy piece must not hide four idle ones.
        utilisationRate: availableDays > 0 ? occupiedDays / availableDays : 0,
        lateCount: pieceRows.reduce((total, row) => total + row.lateCount, 0),
        bestPieceRevenue: best?.totalRevenue ?? 0,
        bestPieceCode: best?.code ?? null,
        idlePieceCount: pieceRows.filter((row) => row.rentalCount === 0 && row.saleCount === 0).length,
      };
    })
    .sort((left, right) => right.netResult - left.netResult);
}

export function buildInventoryPerformanceReport(filters: InventoryPerformanceFilters): InventoryPerformanceReport {
  if (filters.from > filters.to) throw new Error('تاريخ البداية يجب ألا يكون بعد تاريخ النهاية.');

  const built = buildAllRows(filters);
  const rows = sortRows(built.map((entry) => entry.row), filters.sortBy, filters.sortDirection);
  const moneyById = new Map(built.map((entry) => [entry.row.id, entry.money]));
  const rentalsById = new Map(built.map((entry) => [entry.row.id, entry.rentals]));

  const ranked = [...rows].sort((left, right) => performanceScore(right) - performanceScore(left));
  const active = ranked.filter((row) => row.rentalCount > 0 || row.saleCount > 0);

  return {
    filters,
    generatedAt: new Date().toISOString(),
    rows,
    totals: summarize(rows),
    timeline: buildTimeline(rows, moneyById, filters, rentalsById),
    topPerformers: active.slice(0, 5),
    lowPerformers: [...active].reverse().slice(0, 5),
    idleItems: rows.filter((row) => row.isIdle).sort((left, right) => (right.idleDays ?? Number.MAX_SAFE_INTEGER) - (left.idleDays ?? Number.MAX_SAFE_INTEGER)).slice(0, 10),
    serviceHeavyItems: rows
      .filter((row) => row.totalCost > 0 && (row.costToRevenueRatio === null || row.costToRevenueRatio >= 0.35))
      .sort((left, right) => right.totalCost - left.totalCost)
      .slice(0, 10),
    chronicallyLateItems: rows.filter((row) => row.lateCount > 0).sort((left, right) => right.lateCount - left.lateCount).slice(0, 10),
    designRows: summarizeDesignPerformance(rows),
  };
}

export function getInventoryPerformanceDetail(itemId: string, filters: InventoryPerformanceFilters): InventoryPerformanceDetail | null {
  const built = buildAllRows({ ...filters, kind: 'all', category: 'all', status: 'all', operation: 'both', search: '' })
    .find((entry) => entry.row.id === itemId);
  if (!built) return null;

  const { row, money, rentals } = built;
  const reservationLines: PerformanceReservationLine[] = rentals
    .map((reservation) => ({
      reservationNumber: reservation.reservationNumber,
      customerName: reservation.customerName,
      pickupDate: reservation.pickupDate,
      returnDate: reservation.returnDate,
      status: RESERVATION_STATUS_LABELS[reservation.status],
      occupiedDays: overlapDays(reservation, filters.from, filters.to),
      collected: reservation.paidAmount,
      wasLate: reservation.status === 'overdue',
    }))
    .sort((left, right) => right.pickupDate.localeCompare(left.pickupDate));

  // Accessories that travelled with this dress inside the period.
  const links = getReservationAccessories();
  const accessoriesById = new Map(getAccessories().map((accessory) => [accessory.id, accessory]));
  const rentalNumbers = new Set(rentals.map((reservation) => reservation.reservationNumber));
  const linkedCounts = new Map<string, number>();
  links
    .filter((link) => rentalNumbers.has(link.reservationNumber))
    .forEach((link) => linkedCounts.set(link.accessoryId, (linkedCounts.get(link.accessoryId) ?? 0) + 1));

  const linkedAccessories = Array.from(linkedCounts.entries())
    .map(([accessoryId, times]) => {
      const accessory = accessoriesById.get(accessoryId);
      return { code: accessory?.code ?? accessoryId, name: accessory?.name ?? 'ملحق محذوف', times };
    })
    .sort((left, right) => right.times - left.times);

  return {
    row,
    timeline: buildTimeline([row], new Map([[row.id, money]]), filters, new Map([[row.id, rentals]])),
    reservations: reservationLines,
    revenues: money.revenueLines,
    costs: money.costLines,
    linkedAccessories: row.kind === 'dress' ? linkedAccessories : [],
  };
}
