import test from 'node:test';
import assert from 'node:assert/strict';
import { installStorage, uninstallStorage, todayISO } from './helpers/storage.mjs';
import { resetCountersForTesting } from '../src/engines/persistence/index.ts';
import { addCustomer } from '../src/features/customers/customer.service.ts';
import { addDress } from '../src/features/dresses/dress.service.ts';
import { createReservationCommand } from '../src/features/workflows/reservationCommands.ts';
import { recordPaymentCommand } from '../src/features/workflows/paymentCommands.ts';
import {
  buildInventoryPerformanceReport,
  getDefaultPerformanceFilters,
} from '../src/features/reports/inventoryPerformance.service.ts';
import {
  PERFORMANCE_CSV_HEADERS,
  buildInventoryPerformanceCsv,
  buildInventoryPerformanceHtml,
  buildPerformanceCsvRow,
  printInventoryPerformanceReport,
} from '../src/features/reports/inventoryPerformanceExport.ts';
import { buildCsv, escapeCsvValue, toCsvFileName, UTF8_BOM } from '../src/shared/utils/csv.ts';
import { PrintDocumentError } from '../src/platform/printing/index.ts';
import { getOverlayButton, getPrintFrameDocument, getPrintOverlay, installDom, uninstallDom } from './helpers/dom.mjs';
import { addDaysISO } from '../src/shared/utils/date.ts';

function cleanup() {
  uninstallDom();
  resetCountersForTesting();
  uninstallStorage();
}

const today = todayISO();

const dressInput = {
  name: 'فستان زفاف',
  description: '',
  itemType: 'dress',
  category: 'زفاف',
  color: 'أبيض',
  size: 'M',
  purchasePrice: 300,
  rentalPrice: 100,
  salePrice: 500,
  depositAmount: 50,
  status: 'available',
  isForRent: true,
  isForSale: true,
  images: [],
  barcode: '',
};

function filters(overrides = {}) {
  return { ...getDefaultPerformanceFilters(), from: addDaysISO(today, -30), to: addDaysISO(today, 30), ...overrides };
}

function seedReport(dressOverrides = {}) {
  const customer = addCustomer({ name: 'مريم', phone: '90000020', status: 'normal' });
  const dress = addDress({ ...dressInput, ...dressOverrides });
  const reservation = createReservationCommand({
    customerId: customer.id,
    dressId: dress.id,
    pickupDate: today,
    returnDate: addDaysISO(today, 2),
    depositAmount: 0,
    idempotencyKey: 'export-1',
  });
  recordPaymentCommand({
    reservationNumber: reservation.reservationNumber,
    paymentDate: today,
    type: 'rental',
    method: 'cash',
    amount: 100,
    idempotencyKey: 'export-pay',
  });
  return { dress, report: buildInventoryPerformanceReport(filters()) };
}

test('the CSV starts with a UTF-8 BOM so Excel renders Arabic correctly', () => {
  installStorage();
  try {
    const { report } = seedReport();
    const csv = buildInventoryPerformanceCsv(report);

    assert.ok(csv.startsWith(UTF8_BOM), 'the BOM must be the very first character');
    assert.ok(csv.includes('صافي العائد'), 'Arabic headers must be present');
    assert.ok(csv.includes('فستان زفاف'));
  } finally {
    cleanup();
  }
});

test('every configured column reaches the CSV in order', () => {
  installStorage();
  try {
    const { report } = seedReport();
    const csv = buildInventoryPerformanceCsv(report);
    const [headerLine] = csv.slice(UTF8_BOM.length).split('\r\n');

    assert.deepEqual(headerLine.split(','), PERFORMANCE_CSV_HEADERS);
    assert.equal(buildPerformanceCsvRow(report.rows[0]).length, PERFORMANCE_CSV_HEADERS.length);
  } finally {
    cleanup();
  }
});

test('a value that a spreadsheet would execute is neutralised', () => {
  // Every formula trigger recognised by Excel, LibreOffice and Sheets.
  assert.equal(escapeCsvValue('=1+1'), "'=1+1");
  assert.equal(escapeCsvValue('+1'), "'+1");
  assert.equal(escapeCsvValue('-1'), "'-1");
  assert.equal(escapeCsvValue('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(escapeCsvValue('\tcmd'), '"\'\tcmd"');
  assert.equal(escapeCsvValue('=HYPERLINK("http://evil","x")'), '"\'=HYPERLINK(""http://evil"",""x"")"');
  // A harmless value is left untouched.
  assert.equal(escapeCsvValue('D-001'), 'D-001');
  assert.equal(escapeCsvValue('فستان'), 'فستان');
  assert.equal(escapeCsvValue(120.5), '120.5');
  assert.equal(escapeCsvValue(null), '');
});

test('quotes, commas and newlines are quoted instead of breaking the row', () => {
  assert.equal(escapeCsvValue('a,b'), '"a,b"');
  assert.equal(escapeCsvValue('a"b'), '"a""b"');
  assert.equal(escapeCsvValue('a\nb'), '"a\nb"');

  const csv = buildCsv(['x'], [['a,b']]);
  assert.equal(csv, `${UTF8_BOM}x\r\n"a,b"\r\n`);
});

test('an injected item name cannot smuggle a formula into the export', () => {
  installStorage();
  try {
    const { report } = seedReport({ name: '=cmd|calc' });
    const csv = buildInventoryPerformanceCsv(report);

    assert.ok(csv.includes("'=cmd|calc"), 'the name must be prefixed so it stays text');
    assert.equal(csv.includes(',=cmd|calc'), false, 'no raw formula may reach a cell');
  } finally {
    cleanup();
  }
});

test('the CSV file name is filesystem safe and carries the date', () => {
  assert.equal(toCsvFileName('تقرير-أداء-المخزون', '2026-07-28'), 'تقرير-أداء-المخزون-2026-07-28.csv');
  assert.equal(toCsvFileName('a/b:c', '2026-07-28'), 'a-b-c-2026-07-28.csv');
});

test('the printable report carries the period, the generation time and the formulas', () => {
  installStorage();
  try {
    const { report } = seedReport();
    const html = buildInventoryPerformanceHtml(report);

    assert.ok(html.includes(report.filters.from));
    assert.ok(html.includes(report.filters.to));
    assert.ok(html.includes('تاريخ ووقت إنشاء التقرير'));
    assert.ok(html.includes('نسبة الإشغال = أيام الحجز الفعلية'));
    assert.ok(html.includes('صافي العائد'));
  } finally {
    cleanup();
  }
});

test('the printable report escapes every value and hides interactive chrome', () => {
  installStorage();
  try {
    const { report } = seedReport({ name: '<img src=x onerror=alert(1)>' });
    const html = buildInventoryPerformanceHtml(report);

    assert.ok(html.includes('&lt;img'), 'the item name must be escaped');
    assert.equal(html.includes('<img src=x'), false);
    assert.ok(html.includes('@media print{.no-print{display:none !important}}'), 'UI-only chrome must not print');
  } finally {
    cleanup();
  }
});

test('the report prints inside the app so the operator is never trapped', () => {
  installStorage();
  installDom();
  try {
    const { report } = seedReport();
    printInventoryPerformanceReport(report);

    const overlay = getPrintOverlay();
    assert.ok(overlay, 'the report must render in a dismissible in-app view');
    assert.equal(overlay.getAttribute('aria-modal'), 'true');
    assert.ok(getOverlayButton('إغلاق'), 'there must always be a way back to the app');

    getOverlayButton('إغلاق').dispatch('click');
    assert.equal(getPrintOverlay(), null);
  } finally {
    cleanup();
  }
});

test('a print failure surfaces the shared Arabic error instead of breaking silently', () => {
  installStorage();
  installDom();
  try {
    const { report } = seedReport();
    const originalCreate = globalThis.document.createElement;
    globalThis.document.createElement = (tagName) => {
      const element = originalCreate(tagName);
      if (element.tagName === 'IFRAME') {
        element.contentDocument = null;
        element.contentWindow = null;
      }
      return element;
    };

    assert.throws(() => printInventoryPerformanceReport(report), PrintDocumentError);
    assert.throws(() => printInventoryPerformanceReport(report), /تعذر تجهيز المستند للطباعة/);
    globalThis.document.createElement = originalCreate;
  } finally {
    cleanup();
  }
});

test('the printed document is produced once and stays RTL', () => {
  installStorage();
  installDom();
  try {
    const { report } = seedReport();
    printInventoryPerformanceReport(report);

    const frameDocument = getPrintFrameDocument();
    assert.equal(frameDocument.written.length, 1);
    assert.equal(frameDocument.printCount, 1);
    assert.ok(frameDocument.written[0].includes('dir="rtl"'), 'the print document must stay RTL');
    assert.ok(frameDocument.written[0].includes('تقرير أداء المخزون'));
  } finally {
    cleanup();
  }
});
