import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCalendarMonth, isItemOccupiedOn, shiftMonth, WEEKDAY_LABELS } from '../src/features/reservations/reservationCalendar.model.ts';
import { buildRentalContractHtml, printRentalContract, PrintRentalContractError } from '../src/features/reservations/printRentalContract.ts';
import { closePrintOverlay, printDocument, PrintDocumentError, escapeHtml } from '../src/platform/printing/index.ts';
import { getOverlayButton, getPrintFrameDocument, getPrintOverlay, installDom, uninstallDom } from './helpers/dom.mjs';

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
  uninstallDom();
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

test('printing never strands the operator in a window with no way back', () => {
  installStorage();
  installDom();
  try {
    printRentalContract(reservation());

    const overlay = getPrintOverlay();
    assert.ok(overlay, 'the document must render inside the app, not in a detached popup');
    assert.equal(overlay.getAttribute('role'), 'dialog');
    assert.equal(overlay.getAttribute('aria-modal'), 'true');

    // Three independent ways out: a button, Escape, and the system back gesture.
    const closeButton = getOverlayButton('إغلاق');
    assert.ok(closeButton, 'the overlay must expose an explicit Arabic close button');

    closeButton.dispatch('click');
    assert.equal(getPrintOverlay(), null, 'closing must remove the overlay and reveal the app again');
  } finally {
    cleanup();
  }
});

test('the Escape key and a system back gesture both dismiss the printed document', () => {
  installStorage();
  installDom();
  try {
    printRentalContract(reservation());
    assert.ok(getPrintOverlay());
    globalThis.document.dispatch('keydown', { key: 'Escape' });
    assert.equal(getPrintOverlay(), null, 'Escape must close the document view');

    printRentalContract(reservation());
    assert.ok(getPrintOverlay());
    globalThis.window.dispatchWindowEvent('popstate');
    assert.equal(getPrintOverlay(), null, 'a back gesture must close the document, not leave the app');
  } finally {
    cleanup();
  }
});

test('printing twice never stacks two document views on top of each other', () => {
  installStorage();
  installDom();
  try {
    printRentalContract(reservation());
    printRentalContract(reservation());

    const overlays = globalThis.document.querySelectorAll('lena-print-overlay');
    assert.equal(overlays.length, 1, 'a second print must replace the first view, not stack on it');
  } finally {
    cleanup();
  }
});

test('the shared print boundary emits a well formed RTL Arabic document and prints it', () => {
  installStorage();
  installDom();
  try {
    printRentalContract(reservation());

    const frameDocument = getPrintFrameDocument();
    assert.ok(frameDocument);
    assert.equal(frameDocument.written.length, 1);
    assert.match(frameDocument.written[0], /<html dir="rtl" lang="ar">/);
    assert.match(frameDocument.written[0], /RSV-001/);
    assert.equal(frameDocument.closeCount, 1, 'the document must be closed after writing');
    assert.equal(frameDocument.printCount, 1, 'the print dialog is offered immediately');

    // The explicit button re-sends it, for platforms that block the automatic call.
    getOverlayButton('طباعة').dispatch('click');
    assert.equal(frameDocument.printCount, 2);
  } finally {
    cleanup();
  }
});

test('a print failure surfaces an actionable Arabic error instead of a silent break', () => {
  installStorage();
  installDom();
  try {
    // A platform that refuses to give the frame a document must not fail silently.
    const originalCreate = globalThis.document.createElement;
    globalThis.document.createElement = (tagName) => {
      const element = originalCreate(tagName);
      if (element.tagName === 'IFRAME') {
        element.contentDocument = null;
        element.contentWindow = null;
      }
      return element;
    };

    assert.throws(() => printDocument('عنوان', '<p>محتوى</p>'), (error) => {
      assert.equal(error instanceof PrintDocumentError, true);
      assert.match(error.message, /تعذر تجهيز المستند للطباعة/);
      return true;
    });
    assert.equal(getPrintOverlay(), null, 'a failed print must not leave a dead overlay behind');

    // The same failure is wrapped in the feature-level error for the contract path.
    assert.throws(() => printRentalContract(reservation()), (error) => {
      assert.equal(error instanceof PrintRentalContractError, true);
      assert.match(error.message, /تعذر/);
      return true;
    });

    globalThis.document.createElement = originalCreate;
  } finally {
    closePrintOverlay();
    cleanup();
  }
});

test('the print boundary keeps the app behind it out of the printed page', () => {
  installStorage();
  installDom();
  try {
    printRentalContract(reservation());
    const styles = globalThis.document.head.children.map((child) => child.textContent).join('');
    assert.match(styles, /@media print/);
    assert.match(styles, /body>\*:not\(\.lena-print-overlay\)/, 'the app must not print behind the document');
    assert.match(styles, /__bar\{display:none/, 'the overlay chrome must not reach the paper');
  } finally {
    cleanup();
  }
});
