import test from 'node:test';
import assert from 'node:assert/strict';
import { installStorage, uninstallStorage, todayISO } from './helpers/storage.mjs';
import { resetCountersForTesting, writeCollection } from '../src/engines/persistence/index.ts';
import {
  buildCalendarGrid,
  filterCalendarReservations,
  formatDayLabel,
  isItemOccupiedOn,
  matchesCalendarFilters,
  shiftAnchor,
  startOfWeek,
  EMPTY_CALENDAR_FILTERS,
  WEEKDAY_LABELS,
} from '../src/features/reservations/reservationCalendar.ts';
import { addDaysISO, differenceInDays, eachDayISO, extractTime, formatTimeLabel, getTodayISO, parseLocalDate } from '../src/shared/utils/date.ts';
import { DEFAULT_APP_PREFERENCES, saveAppPreferences } from '../src/features/preferences/preferences.service.ts';

function cleanup() {
  resetCountersForTesting();
  uninstallStorage();
}

function reservation(overrides) {
  return {
    id: overrides.id,
    reservationNumber: overrides.id.toUpperCase(),
    customerId: overrides.customerId ?? 'cust-1',
    inventoryItemId: overrides.inventoryItemId ?? 'item-1',
    customerName: overrides.customerName ?? 'مريم',
    customerPhone: overrides.customerPhone ?? '90000001',
    dressCode: overrides.dressCode ?? 'D-001',
    dressName: overrides.dressName ?? 'فستان سهرة',
    pickupDate: overrides.pickupDate,
    pickupTime: overrides.pickupTime,
    returnDate: overrides.returnDate,
    returnTime: overrides.returnTime,
    status: overrides.status ?? 'confirmed',
    rentalPrice: 40,
    depositAmount: 20,
    totalAmount: 60,
    paidAmount: 0,
    remainingAmount: 60,
  };
}

test('local date helpers never shift the day across timezones', () => {
  // `new Date('2026-01-01')` is UTC-parsed; parseLocalDate must stay on the local day.
  const parsed = parseLocalDate('2026-01-01');
  assert.equal(parsed.getFullYear(), 2026);
  assert.equal(parsed.getMonth(), 0);
  assert.equal(parsed.getDate(), 1);
  assert.equal(getTodayISO(parsed), '2026-01-01');

  assert.equal(addDaysISO('2026-01-31', 1), '2026-02-01');
  assert.equal(addDaysISO('2026-03-01', -1), '2026-02-28');
  assert.equal(differenceInDays('2026-01-01', '2026-01-11'), 10);
  assert.deepEqual(eachDayISO('2026-01-30', '2026-02-01'), ['2026-01-30', '2026-01-31', '2026-02-01']);
});

test('time helpers render Arabic 12-hour labels and read datetime-local values', () => {
  assert.equal(formatTimeLabel('10:00'), '10:00 ص');
  assert.equal(formatTimeLabel('20:30'), '8:30 م');
  assert.equal(formatTimeLabel('00:15'), '12:15 ص');
  assert.equal(formatTimeLabel('12:00'), '12:00 م');
  assert.equal(formatTimeLabel(undefined), '—');
  assert.equal(formatTimeLabel('99:99'), '—');
  assert.equal(extractTime('2026-07-28T14:05'), '14:05');
  assert.equal(extractTime(undefined), undefined);
});

test('the month grid always renders six Sunday-first weeks around the anchor', () => {
  installStorage();
  try {
    const grid = buildCalendarGrid([], 'month', '2026-03-15');
    assert.equal(grid.view, 'month');
    assert.equal(grid.days.length, 42);
    assert.equal(grid.label, 'مارس 2026');
    assert.equal(parseLocalDate(grid.days[0].date).getDay(), 0, 'the grid starts on Sunday');
    assert.equal(WEEKDAY_LABELS.length, 7);
    assert.equal(grid.days.filter((day) => day.inCurrentPeriod).length, 31);
  } finally {
    cleanup();
  }
});

test('the week grid covers exactly seven days from the Sunday of the anchor', () => {
  installStorage();
  try {
    const grid = buildCalendarGrid([], 'week', '2026-03-18');
    assert.equal(grid.days.length, 7);
    assert.equal(grid.days[0].date, startOfWeek('2026-03-18'));
    assert.equal(parseLocalDate(grid.days[0].date).getDay(), 0);
    assert.ok(grid.days.every((day) => day.inCurrentPeriod));
  } finally {
    cleanup();
  }
});

test('the day view renders exactly the anchored day', () => {
  installStorage();
  try {
    const grid = buildCalendarGrid([], 'day', '2026-03-18');
    assert.equal(grid.days.length, 1);
    assert.equal(grid.days[0].date, '2026-03-18');
    assert.equal(grid.label, formatDayLabel('2026-03-18'));
  } finally {
    cleanup();
  }
});

test('navigation shifts by the active view without drifting the day', () => {
  assert.equal(shiftAnchor('2026-03-18', 'day', 1), '2026-03-19');
  assert.equal(shiftAnchor('2026-03-18', 'week', -1), '2026-03-11');
  assert.equal(shiftAnchor('2026-03-31', 'month', 1), '2026-04-30', 'a shorter month clamps instead of overflowing');
  assert.equal(shiftAnchor('2026-01-15', 'month', -1), '2025-12-15');
});

test('pickups, returns and ongoing days are placed on the right dates with times', () => {
  installStorage();
  try {
    saveAppPreferences({ ...DEFAULT_APP_PREFERENCES, defaultPickupTime: '10:00', defaultReturnTime: '20:00' });
    const booking = reservation({ id: 'r1', pickupDate: '2026-03-10', pickupTime: '11:30', returnDate: '2026-03-12' });
    const grid = buildCalendarGrid([booking], 'month', '2026-03-01');
    const byDate = new Map(grid.days.map((day) => [day.date, day]));

    assert.equal(byDate.get('2026-03-10').pickups.length, 1);
    assert.equal(byDate.get('2026-03-10').entries[0].timeLabel, '11:30 ص');
    assert.equal(byDate.get('2026-03-11').ongoing.length, 1);
    assert.equal(byDate.get('2026-03-11').entries[0].time, undefined);
    assert.equal(byDate.get('2026-03-12').returns.length, 1);
    // The return time falls back to the configured default.
    assert.equal(byDate.get('2026-03-12').entries[0].timeLabel, '8:00 م');
    assert.equal(byDate.get('2026-03-09').entries.length, 0);
    assert.equal(byDate.get('2026-03-13').entries.length, 0);
  } finally {
    cleanup();
  }
});

test('entries inside a day are ordered by time', () => {
  installStorage();
  try {
    const early = reservation({ id: 'r-early', pickupDate: '2026-03-10', pickupTime: '09:00', returnDate: '2026-03-11' });
    const late = reservation({ id: 'r-late', inventoryItemId: 'item-2', dressCode: 'D-002', pickupDate: '2026-03-10', pickupTime: '17:00', returnDate: '2026-03-11' });
    const grid = buildCalendarGrid([late, early], 'day', '2026-03-10');

    assert.deepEqual(grid.days[0].entries.map((entry) => entry.time), ['09:00', '17:00']);
  } finally {
    cleanup();
  }
});

test('cancelled reservations are hidden until their status is explicitly requested', () => {
  installStorage();
  try {
    const cancelled = reservation({ id: 'r-cancelled', pickupDate: '2026-03-10', returnDate: '2026-03-12', status: 'cancelled' });
    const hidden = buildCalendarGrid([cancelled], 'day', '2026-03-10');
    assert.equal(hidden.days[0].entries.length, 0);

    const shown = buildCalendarGrid([cancelled], 'day', '2026-03-10', { ...EMPTY_CALENDAR_FILTERS, statuses: ['cancelled'] });
    assert.equal(shown.days[0].entries.length, 1);
  } finally {
    cleanup();
  }
});

test('calendar filters narrow by status, dress, customer and date range', () => {
  installStorage();
  try {
    const first = reservation({ id: 'r1', pickupDate: '2026-03-10', returnDate: '2026-03-12', dressCode: 'D-001', customerName: 'مريم' });
    const second = reservation({ id: 'r2', inventoryItemId: 'item-2', dressCode: 'D-002', customerName: 'سارة', customerPhone: '90000002', pickupDate: '2026-04-01', returnDate: '2026-04-03', status: 'delivered' });
    const all = [first, second];

    assert.equal(filterCalendarReservations(all, { ...EMPTY_CALENDAR_FILTERS, statuses: ['delivered'] }).length, 1);
    assert.equal(filterCalendarReservations(all, { ...EMPTY_CALENDAR_FILTERS, dress: 'D-002' }).length, 1);
    assert.equal(filterCalendarReservations(all, { ...EMPTY_CALENDAR_FILTERS, customer: 'مريم' }).length, 1);
    assert.equal(filterCalendarReservations(all, { ...EMPTY_CALENDAR_FILTERS, customer: '90000002' }).length, 1);
    assert.equal(filterCalendarReservations(all, { ...EMPTY_CALENDAR_FILTERS, from: '2026-03-20', to: '2026-04-30' }).length, 1);
    // A range that only touches the tail of a booking still includes it.
    assert.equal(matchesCalendarFilters(first, { ...EMPTY_CALENDAR_FILTERS, from: '2026-03-12', to: '2026-03-20' }), true);
    assert.equal(matchesCalendarFilters(first, { ...EMPTY_CALENDAR_FILTERS, from: '2026-03-13', to: '2026-03-20' }), false);
  } finally {
    cleanup();
  }
});

test('today is marked on the grid using the local calendar day', () => {
  installStorage();
  try {
    const today = todayISO();
    const grid = buildCalendarGrid([], 'day', today);
    assert.equal(grid.days[0].isToday, true);
    assert.equal(buildCalendarGrid([], 'day', addDaysISO(today, 1)).days[0].isToday, false);
  } finally {
    cleanup();
  }
});

test('occupancy is derived from reservations, never from a stored item flag', () => {
  installStorage();
  try {
    const booking = reservation({ id: 'r1', pickupDate: '2026-03-10', returnDate: '2026-03-12' });
    writeCollection('dresses', [{ id: 'item-1', code: 'D-001', status: 'available' }]);

    assert.equal(isItemOccupiedOn([booking], 'D-001', '2026-03-11'), true);
    assert.equal(isItemOccupiedOn([booking], 'D-001', '2026-03-13'), false);
    assert.equal(isItemOccupiedOn([{ ...booking, status: 'cancelled' }], 'D-001', '2026-03-11'), false);
  } finally {
    cleanup();
  }
});
