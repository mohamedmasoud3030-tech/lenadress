import { getTodayISO } from '../../shared/utils/date';
import { getAccessories } from '../accessories/accessory.service';
import { getOutstandingAccessories, getReservationAccessories } from '../accessories/reservationAccessory.service';
import { getCustomers } from '../customers/customer.service';
import { getDresses, summarizeDresses } from '../dresses/dress.service';
import { getFinanceTotals, getOutstandingRentalBalances } from '../finance/finance.service';
import { getReservations, getReservationTimes } from '../reservations/reservation.service';
import { getReminders, summarizeReminders } from '../reminders/reminder.service';
import { getServiceTasks, summarizeServiceQueue } from '../service/service.service';
import type { Reservation } from '../reservations/reservation.types';

/**
 * The daily operations board.
 *
 * The dashboard used to show four counts and a shortcut grid, so it answered
 * "how much stock do I own" but never "what do I have to do right now, and what
 * money have I not collected". This module is the single place that answers the
 * second question, reading exclusively from the existing operational and
 * finance layers — it introduces no new stored state and no new money rules.
 */

export type DashboardTask = {
  reservation: Reservation;
  time: string;
  /** Accessories attached to the booking, so the counter can prepare them. */
  accessoryCount: number;
};

export type OutstandingBalanceRow = {
  reservationNumber: string;
  customerName: string;
  dressCode: string;
  remainingAmount: number;
  /** True when the rental period has already ended with money still owed. */
  isOverdue: boolean;
};

export type DashboardSnapshot = {
  date: string;
  inventory: { total: number; available: number; rented: number; inService: number };
  accessories: { total: number; available: number; out: number };
  customerCount: number;
  reservations: { active: number; today: number; overdue: number; upcomingWeek: number };
  /** Bookings due to be handed over today, earliest first. */
  pickupsToday: DashboardTask[];
  /** Bookings due back today, earliest first. */
  returnsToday: DashboardTask[];
  /** Bookings whose return date has passed and that are still out. */
  overdueReturns: DashboardTask[];
  money: {
    collectedToday: number;
    expensesToday: number;
    netToday: number;
    /** Money owed to the showroom across all open bookings. */
    outstandingTotal: number;
    outstandingCount: number;
    /** Owed on bookings whose rental period has already ended. */
    outstandingOverdueTotal: number;
  };
  outstandingBalances: OutstandingBalanceRow[];
  service: { open: number; inProgress: number; overdue: number };
  /** Accessories still physically out across every delivered booking. */
  accessoriesOutCount: number;
  /** Customer follow-ups still outstanding today. */
  reminders: { total: number; critical: number };
};

const ACTIVE_STATUSES = new Set<Reservation['status']>(['pending', 'confirmed', 'delivered', 'overdue']);

function toTask(reservation: Reservation, kind: 'pickup' | 'return', accessoryCounts: Map<string, number>): DashboardTask {
  const times = getReservationTimes(reservation);
  return {
    reservation,
    time: kind === 'pickup' ? times.pickupTime : times.returnTime,
    accessoryCount: accessoryCounts.get(reservation.reservationNumber) ?? 0,
  };
}

function byTime(left: DashboardTask, right: DashboardTask): number {
  return left.time.localeCompare(right.time);
}

export function getDashboardSnapshot(): DashboardSnapshot {
  const today = getTodayISO();
  const reservations = getReservations();
  const active = reservations.filter((reservation) => ACTIVE_STATUSES.has(reservation.status));

  const accessoryCounts = new Map<string, number>();
  getReservationAccessories().forEach((link) => {
    accessoryCounts.set(link.reservationNumber, (accessoryCounts.get(link.reservationNumber) ?? 0) + 1);
  });

  const pickupsToday = active
    .filter((reservation) => reservation.pickupDate === today && (reservation.status === 'pending' || reservation.status === 'confirmed'))
    .map((reservation) => toTask(reservation, 'pickup', accessoryCounts))
    .sort(byTime);

  const returnsToday = active
    .filter((reservation) => reservation.returnDate === today && reservation.status === 'delivered')
    .map((reservation) => toTask(reservation, 'return', accessoryCounts))
    .sort(byTime);

  const overdueReturns = active
    .filter((reservation) => reservation.status === 'overdue')
    .map((reservation) => toTask(reservation, 'return', accessoryCounts))
    .sort((left, right) => left.reservation.returnDate.localeCompare(right.reservation.returnDate));

  // A week ahead is what the showroom can actually prepare for.
  const weekAhead = new Date(`${today}T00:00:00`);
  weekAhead.setDate(weekAhead.getDate() + 7);
  const weekAheadISO = getTodayISO(weekAhead);
  const upcomingWeek = active.filter(
    (reservation) => reservation.pickupDate > today && reservation.pickupDate <= weekAheadISO,
  ).length;

  const todayTotals = getFinanceTotals({ from: today, to: today });

  const outstandingBalances: OutstandingBalanceRow[] = getOutstandingRentalBalances()
    .map((balance) => {
      const reservation = reservations.find((item) => item.reservationNumber === balance.reservationNumber);
      return {
        ...balance,
        isOverdue: Boolean(reservation && reservation.returnDate < today),
      };
    })
    // Overdue money first, then the largest amount: that is the collection order.
    .sort((left, right) => (Number(right.isOverdue) - Number(left.isOverdue)) || (right.remainingAmount - left.remainingAmount));

  const outstandingTotal = outstandingBalances.reduce((total, row) => total + row.remainingAmount, 0);
  const outstandingOverdueTotal = outstandingBalances
    .filter((row) => row.isOverdue)
    .reduce((total, row) => total + row.remainingAmount, 0);

  const accessories = getAccessories();
  const serviceSummary = summarizeServiceQueue(getServiceTasks());

  const accessoriesOutCount = active.reduce(
    (total, reservation) => total + getOutstandingAccessories(reservation.reservationNumber).length,
    0,
  );

  const inventory = summarizeDresses();

  return {
    date: today,
    inventory,
    accessories: {
      total: accessories.length,
      available: accessories.filter((accessory) => accessory.status === 'available').length,
      out: accessories.filter((accessory) => accessory.status === 'delivered' || accessory.status === 'reserved').length,
    },
    customerCount: getCustomers().length,
    reservations: {
      active: active.length,
      today: pickupsToday.length + returnsToday.length,
      overdue: overdueReturns.length,
      upcomingWeek,
    },
    pickupsToday,
    returnsToday,
    overdueReturns,
    money: {
      collectedToday: todayTotals.grossCollected,
      expensesToday: todayTotals.expenses,
      netToday: todayTotals.netCashMovement,
      outstandingTotal,
      outstandingCount: outstandingBalances.length,
      outstandingOverdueTotal,
    },
    outstandingBalances,
    service: { open: serviceSummary.open, inProgress: serviceSummary.inProgress, overdue: serviceSummary.overdue },
    accessoriesOutCount,
    reminders: (() => {
      const summary = summarizeReminders(getReminders());
      return { total: summary.total, critical: summary.critical };
    })(),
  };
}

/** True when the showroom has nothing recorded at all, so onboarding is shown. */
export function isShowroomEmpty(): boolean {
  return getDresses().length === 0 && getCustomers().length === 0 && getReservations().length === 0;
}
