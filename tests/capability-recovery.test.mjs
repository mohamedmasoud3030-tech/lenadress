import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCalendarMonth, isItemOccupiedOn, shiftMonth, WEEKDAY_LABELS } from '../src/features/reservations/reservationCalendar.ts';
import { buildRentalContractHtml, printRentalContract, PrintRentalContractError } from '../src/features/reservations/printRentalContract.ts';
import { printDocument, PrintDocumentError, escapeHtml } from '../src/platform/printing/index.ts';

function installStorage() {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      get length() {
        return store.size;
      },
      getItem(key) {
        return store.has(key) ? store.get(key) : null;
      },
      setItem(key, value) {
        store.set(key, String(value));
      },
      removeItem(key) {
        store.delete(key);
      },
      key(index) {
        return Array.from(store.keys())[index] ?? null;
      },
      clear() {
        store.clear();
      },
    },
  };
  return store;
}

function cleanup() {
  delete globalThis.window;
}

function reservation(overrides = {}) {
  return {
    id: 'rsv-1',
    reservationNumber: 'RSV-001',
    customerId: 'cus-1',
    inventoryItemId: 'itm-1',
    customerName: 'مريم الحالية',
    customerPhone: '90000009',
    customerNameSnapshot: 'مريم وقت الحجز',
    customerPhoneSnapshot: '90000001',
    dressCode: 'D-002',
    dressName: 'اسم حالي',
    dressCodeSnapshot: 'D-001',
    dressNameSnapshot: 'فستان وقت الحجز',
    pickupDate: '2026-06-10',
    returnDate: '2026-06-13',
    status: 'confirmed',
    rentalPrice: 40,
    depositAmount: 50,
    totalAmount: 90,
    paidAmount: 40,
    remainingAmount: 50,
    ...overrides,
  };
}

test('the calendar grid always covers six weeks starting on Sunday', () => {
  const calendar = buildCalendarMonth([], 2026, 5);
  assert.equal(calendar.days.length, 42);
  assert.equal(WEEKDAY_LABELS.length, 7);
  assert.equal(WEEKDAY_LABELS[0], 'الأحد');
  assert.equal(new Date(`${calendar.days[0].date}T00:00:00`).getDay(), 0);
  assert.equal(calendar.label, 'يونيو 2026');
});

test('the calendar derives pickups, returns and ongoing days from the reservations', () => {
  const calendar = buildCalendarMonth([reservation()], 2026, 5);
  const byDate = Object.fromEntries(calendar.days.map((day) => [day.date, day]));

  assert.equal(byDate['2026-06-10'].pickups.length, 1);
  assert.equal(byDate['2026-06-13'].returns.length, 1);
  assert.equal(byDate['2026-06-11'].ongoing.length, 1, 'the middle of the rental is occupied');
  assert.equal(byDate['2026-06-10'].ongoing.length, 0, 'the pickup day is not double counted');
  assert.equal(byDate['2026-06-14'].pickups.length + byDate['2026-06-14'].returns.length, 0);
});

test('cancelled and returned reservations do not occupy the calendar', () => {
  const cancelled = buildCalendarMonth([reservation({ status: 'cancelled' })], 2026, 5);
  const day = cancelled.days.find((item) => item.date === '2026-06-11');
  assert.equal(day.ongoing.length, 0);

  const done = buildCalendarMonth([reservation({ status: 'returned' })], 2026, 5);
  assert.equal(done.days.find((item) => item.date === '2026-06-11').ongoing.length, 0);
});

test('occupancy is derived from dates, never from a stored item flag', () => {
  const reservations = [reservation()];
  assert.equal(isItemOccupiedOn(reservations, 'D-002', '2026-06-11'), true);
  assert.equal(isItemOccupiedOn(reservations, 'D-002', '2026-06-20'), false);
  assert.equal(isItemOccupiedOn(reservations, 'D-999', '2026-06-11'), false);
});

test('month navigation wraps across year boundaries', () => {
  assert.deepEqual(shiftMonth(2026, 0, -1), { year: 2025, month: 11 });
  assert.deepEqual(shiftMonth(2026, 11, 1), { year: 2027, month: 0 });
});

test('the rental contract prints the historical snapshots, not the current values', () => {
  installStorage();
  try {
    const html = buildRentalContractHtml(reservation());
    assert.match(html, /مريم وقت الحجز/);
    assert.match(html, /فستان وقت الحجز/);
    assert.match(html, /D-001/);
    assert.doesNotMatch(html, /مريم الحالية/);
    assert.doesNotMatch(html, /اسم حالي/);
  } finally {
    cleanup();
  }
});

test('the rental contract states the deposit is refundable and lists the terms', () => {
  installStorage();
  try {
    const html = buildRentalContractHtml(reservation());
    assert.match(html, /العربون مبلغ تأمين مسترد/);
    assert.match(html, /الشروط والأحكام/);
    assert.match(html, /رسوم تأخير/);
    assert.match(html, /توقيع العميلة/);
  } finally {
    cleanup();
  }
});

test('contract values are HTML escaped', () => {
  installStorage();
  try {
    const html = buildRentalContractHtml(reservation({ customerNameSnapshot: 'مريم <script>' }));
    assert.match(html, /&lt;script&gt;/);
    assert.doesNotMatch(html, /<script>/);
    assert.equal(escapeHtml('a&b"<c>'), 'a&amp;b&quot;&lt;c&gt;');
  } finally {
    cleanup();
  }
});

test('a blocked popup produces an actionable Arabic error, not a silent failure', () => {
  installStorage();
  globalThis.window.open = () => null;
  try {
    assert.throws(() => printDocument('عنوان', '<p>محتوى</p>'), (error) => {
      assert.equal(error instanceof PrintDocumentError, true);
      assert.match(error.message, /النوافذ المنبثقة/);
      return true;
    });

    assert.throws(() => printRentalContract(reservation()), (error) => {
      assert.equal(error instanceof PrintRentalContractError, true);
      assert.match(error.message, /النوافذ المنبثقة/);
      return true;
    });
  } finally {
    cleanup();
  }
});

test('the shared print boundary emits a well formed RTL Arabic document', () => {
  installStorage();
  const written = [];
  globalThis.window.open = () => ({
    document: {
      write(markup) {
        written.push(markup);
      },
      close() {},
    },
    focus() {},
    print() {},
  });

  try {
    printRentalContract(reservation());
    assert.equal(written.length, 1);
    assert.match(written[0], /<html dir="rtl" lang="ar">/);
    assert.match(written[0], /RSV-001/);
  } finally {
    cleanup();
  }
});
