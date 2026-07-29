import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { UTF8_BOM } from '../src/shared/utils/csv.ts';
import {
  AUDIT_CSV_HEADERS,
  CUSTOMERS_CSV_HEADERS,
  EXPENSES_CSV_HEADERS,
  PAYMENTS_CSV_HEADERS,
  RESERVATIONS_CSV_HEADERS,
  buildAuditCsv,
  buildCustomersCsv,
  buildExpensesCsv,
  buildPaymentsCsv,
  buildReservationsCsv,
  ledgerFileName,
} from '../src/features/reports/ledgerExports.ts';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = join(repositoryRoot, 'src');

const payment = {
  id: 'p1',
  paymentNumber: 'PAY-001',
  paymentDate: '2026-09-20',
  reservationNumber: 'RSV-001',
  customerName: 'نورة',
  dressCode: 'DRS-001',
  dressName: 'فستان زفاف',
  type: 'rental',
  direction: 'income',
  method: 'cash',
  amount: 80,
  notes: '',
};

const expense = {
  id: 'e1',
  expenseNumber: 'EXP-001',
  expenseDate: '2026-09-20',
  title: 'تنظيف',
  category: 'cleaning',
  paymentMethod: 'cash',
  amount: 5,
  notes: '',
};

const reservation = {
  id: 'r1',
  reservationNumber: 'RSV-001',
  customerName: 'نورة',
  customerPhone: '+968 9191 8186',
  dressCode: 'DRS-001',
  dressName: 'فستان زفاف',
  pickupDate: '2026-09-20',
  returnDate: '2026-09-22',
  status: 'confirmed',
  rentalPrice: 70,
  listRentalPrice: 80,
  depositAmount: 50,
  totalAmount: 120,
  paidAmount: 40,
  remainingAmount: 80,
};

const customer = {
  id: 'c1',
  name: 'نورة',
  phone: '+968 9191 8186',
  address: 'صحار',
  status: 'active',
  totalReservations: 3,
  activeReservations: 1,
  totalPaid: 200,
  remainingBalance: 80,
};

const auditEntry = {
  id: 'a1',
  timestamp: '2026-09-20T10:00:00.000Z',
  action: 'create',
  entityType: 'reservation',
  entityId: 'RSV-001',
  summary: 'تم إنشاء حجز',
  performedBy: 'سارة',
};

const builders = [
  ['payments', buildPaymentsCsv, [payment], PAYMENTS_CSV_HEADERS],
  ['expenses', buildExpensesCsv, [expense], EXPENSES_CSV_HEADERS],
  ['reservations', buildReservationsCsv, [reservation], RESERVATIONS_CSV_HEADERS],
  ['customers', buildCustomersCsv, [customer], CUSTOMERS_CSV_HEADERS],
  ['audit', buildAuditCsv, [auditEntry], AUDIT_CSV_HEADERS],
];

for (const [name, build, rows, headers] of builders) {
  test(`the ${name} export starts with a UTF-8 BOM so Excel keeps Arabic`, () => {
    // Without the BOM Excel guesses a legacy codepage and the whole Arabic file
    // renders as mojibake.
    assert.ok(build(rows).startsWith(UTF8_BOM));
  });

  test(`the ${name} export emits its header row first`, () => {
    const [first] = build(rows).replace(UTF8_BOM, '').split('\r\n');
    assert.equal(first.split(',').length, headers.length);
  });

  test(`the ${name} export produces one line per record`, () => {
    const lines = build(rows).replace(UTF8_BOM, '').trim().split('\r\n');
    assert.equal(lines.length, rows.length + 1);
  });

  test(`the ${name} export of an empty list is a header-only file, not a crash`, () => {
    const output = build([]);
    assert.ok(output.startsWith(UTF8_BOM));
    assert.equal(output.replace(UTF8_BOM, '').trim().split('\r\n').length, 1);
  });
}

test('a leading formula character is neutralised so a cell cannot execute', () => {
  const output = buildCustomersCsv([{ ...customer, name: '=cmd|calc' }]);
  assert.match(output, /'=cmd/, 'the value must be prefixed so Excel reads it as text');
});

test('a phone number keeps its plus sign as text rather than becoming a formula', () => {
  const output = buildCustomersCsv([customer]);
  // A leading + is a formula trigger, and an unguarded number also loses its
  // leading zero to Excel's number parsing.
  assert.match(output, /'\+968/);
});

test('a value containing a comma is quoted rather than splitting the row', () => {
  const output = buildCustomersCsv([{ ...customer, address: 'صحار, الباطنة' }]);
  assert.match(output, /"صحار, الباطنة"/);
});

test('a value containing a quote has it doubled', () => {
  const output = buildCustomersCsv([{ ...customer, name: 'نورة "الأولى"' }]);
  assert.match(output, /""الأولى""/);
});

test('a value containing a newline cannot break the row structure', () => {
  const output = buildExpensesCsv([{ ...expense, notes: 'سطر\nثانٍ' }]);
  const withoutQuoted = output.replace(/"[^"]*"/g, 'X');
  assert.equal(withoutQuoted.replace(UTF8_BOM, '').trim().split('\r\n').length, 2);
});

test('the reservation export derives the discount from the booking snapshot', () => {
  // Recomputing against today's catalogue price would misreport every past
  // booking after a price change.
  const output = buildReservationsCsv([reservation]);
  const row = output.replace(UTF8_BOM, '').split('\r\n')[1].split(',');
  assert.equal(row[RESERVATIONS_CSV_HEADERS.indexOf('الخصم')], '10');
});

test('a reservation with no price snapshot reports no discount rather than a negative', () => {
  const output = buildReservationsCsv([{ ...reservation, listRentalPrice: undefined }]);
  const row = output.replace(UTF8_BOM, '').split('\r\n')[1].split(',');
  assert.equal(row[RESERVATIONS_CSV_HEADERS.indexOf('الخصم')], '0');
});

test('statuses and categories are exported as Arabic labels, not raw codes', () => {
  assert.match(buildReservationsCsv([reservation]), /مؤكد/);
  assert.match(buildPaymentsCsv([payment]), /نقداً/);
});

test('an unknown stored code falls back to the code instead of blanking the cell', () => {
  // A blank cell in an accountant's ledger is worse than an unfamiliar code.
  const output = buildPaymentsCsv([{ ...payment, type: 'future_type' }]);
  assert.match(output, /future_type/);
});

test('dates are exported as sortable ISO values, not localised text', () => {
  // A localised Arabic date sorts alphabetically into nonsense.
  assert.match(buildPaymentsCsv([payment]), /2026-09-20/);
});

test('filenames are dated so a month of exports sorts correctly', () => {
  const name = ledgerFileName('سجل-المدفوعات');
  assert.match(name, /^سجل-المدفوعات-\d{4}-\d{2}-\d{2}\.csv$/);
});

test('every ledger the accountant asks for can be exported', async () => {
  const pages = [
    ['features/payments/PaymentsPage.tsx', 'buildPaymentsCsv'],
    ['features/expenses/ExpensesPage.tsx', 'buildExpensesCsv'],
    ['features/reservations/ReservationsPage.tsx', 'buildReservationsCsv'],
    ['features/customers/CustomersPage.tsx', 'buildCustomersCsv'],
    ['features/audit/AuditLogPage.tsx', 'buildAuditCsv'],
  ];

  for (const [relative, builder] of pages) {
    const content = await readFile(join(sourceRoot, relative), 'utf8');
    assert.match(content, new RegExp(builder), `${relative} must offer an export`);
    assert.match(content, /downloadCsv/, `${relative} must use the shared download helper`);
    assert.match(content, /تصدير CSV/, `${relative} must label the action in Arabic`);
  }
});

test('exports respect the active filters instead of dumping everything', async () => {
  const page = await readFile(join(sourceRoot, 'features/payments/PaymentsPage.tsx'), 'utf8');
  // The accountant asks for a period; exporting everything makes her redo the
  // narrowing in the spreadsheet.
  assert.match(page, /buildPaymentsCsv\(filteredPayments\)/);
});

test('every download goes through the platform helper, not a hand-rolled anchor', async () => {
  const files = [
    'features/preferences/PreferencesPage.tsx',
    'features/reports/InventoryPerformancePage.tsx',
  ];
  for (const relative of files) {
    const content = await readFile(join(sourceRoot, relative), 'utf8');
    assert.doesNotMatch(content, /URL\.createObjectURL/, `${relative} must not touch object URLs directly`);
  }
});

test('the download helper attaches the anchor before clicking it', async () => {
  const helper = await readFile(join(sourceRoot, 'platform/download/downloadFile.ts'), 'utf8');
  // A detached anchor's synthetic click is ignored by several WebViews,
  // including the one behind an installed PWA on older Android: the operator
  // taps export and gets no file and no error.
  assert.match(helper, /appendChild\(anchor\)/);
  assert.match(helper, /removeChild\(anchor\)/);
});

test('the object URL is revoked even when the click throws', async () => {
  const helper = await readFile(join(sourceRoot, 'platform/download/downloadFile.ts'), 'utf8');
  assert.match(helper, /finally \{[\s\S]*revokeObjectURL/);
});
