import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

/**
 * Release audit, expressed as executable assertions.
 *
 * Each test corresponds to one claim in the launch gate. If a future change
 * violates a launch invariant, the gate fails instead of the claim quietly
 * becoming false in the documentation.
 */

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = join(repositoryRoot, 'src');

async function collectFiles(directory, predicate) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(path, predicate)));
    } else if (predicate(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

const isSource = (name) => /\.(ts|tsx)$/.test(name);

test('no operational data escapes the unified persistence layer', async () => {
  const files = await collectFiles(sourceRoot, isSource);
  const offenders = [];

  for (const file of files) {
    const relative = file.replace(repositoryRoot, '');
    // The platform layer owns the browser APIs; everything else must go through it.
    if (relative.includes('/platform/')) continue;
    const content = await readFile(file, 'utf8');
    const code = content
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('*') && !line.trimStart().startsWith('//'))
      .join('\n');

    if (/\bwindow\.localStorage\b|\bsessionStorage\b|\bindexedDB\b/.test(code)) {
      offenders.push(relative);
    }
  }

  assert.deepEqual(offenders, []);
});

test('every money-changing workflow runs through an atomic command', async () => {
  const workflows = await readdir(join(sourceRoot, 'features/workflows'));
  const required = [
    'reservationCommands.ts',
    'paymentCommands.ts',
    'deliveryReturnCommands.ts',
    'salesCommands.ts',
    'expenseCommands.ts',
    'dailyCloseCommands.ts',
    'serviceCommands.ts',
  ];

  for (const file of required) {
    assert.ok(workflows.includes(file), `${file} must exist`);
    const content = await readFile(join(sourceRoot, 'features/workflows', file), 'utf8');
    assert.match(content, /runCommand\(/, `${file} must use the atomic command runner`);
    assert.match(content, /commandBoundary\(/, `${file} must mark a write boundary for forced-failure tests`);
  }
});

test('administrative UI writes run through audited atomic commands', async () => {
  const workflow = await readFile(
    join(sourceRoot, 'features/workflows/administrationCommands.ts'),
    'utf8',
  );
  assert.match(workflow, /runCommand\(/, 'synchronous administration must use the atomic command runner');
  assert.match(workflow, /runCommandAsync\(/, 'asynchronous administration must use the async atomic command runner');
  assert.match(workflow, /commandBoundary\(/, 'administration must expose forced-failure boundaries');

  const guardedScreens = [
    ['features/dresses/AddDressModal.tsx', /\baddDressCommand\b/],
    ['features/dresses/DressDetailsPage.tsx', /\b(?:archive|delete)DressCommand\b/],
    ['features/customers/AddCustomerModal.tsx', /\baddCustomerCommand\b/],
    ['features/customers/CustomersPage.tsx', /\b(?:archive|delete)CustomerCommand\b/],
    ['features/customers/MeasurementsPanel.tsx', /\bupdateCustomerCommand\b/],
    ['features/customers/CustomerConductPanel.tsx', /\b(?:add|remove)ConductNoteCommand\b/],
    ['features/waitlist/AddWaitlistModal.tsx', /\baddWaitlistEntryCommand\b/],
    ['features/waitlist/WaitlistPage.tsx', /\b(?:closeWaitlistEntry|markWaitlistNotified)Command\b/],
    ['features/stocktake/StocktakePage.tsx', /\b(?:start|complete|cancel)StocktakeSessionCommand\b/],
    ['features/preferences/PreferencesPage.tsx', /\b(?:importDatabaseBackup|resetApplicationData|saveAppPreferences|migrateImages)Command\b/],
    ['features/preferences/ShowroomProfileEditor.tsx', /\b(?:save|reset)ShowroomProfileCommand\b/],
    ['features/preferences/PrintSettingsEditor.tsx', /\b(?:save|reset)PrintSettingsCommand\b/],
  ];

  for (const [relative, commandPattern] of guardedScreens) {
    const content = await readFile(join(sourceRoot, relative), 'utf8');
    assert.match(
      content,
      commandPattern,
      `${relative} must write through an administration command`,
    );
    assert.match(content, /from ['"]\.\.\/workflows['"]/, `${relative} must use the workflow facade`);
  }
});

test('the audit trail is written inside the workflow services, not bolted on afterwards', async () => {
  const audited = [
    'features/reservations/reservation.service.ts',
    'features/payments/payment.service.ts',
    'features/delivery-return/deliveryReturn.operations.ts',
    'features/dresses/salesLedger.service.ts',
    'features/expenses/expense.service.ts',
    'features/reports/report.service.ts',
    'features/service/service.service.ts',
    'features/dresses/dress.service.ts',
    'features/customers/customer.service.ts',
  ];

  for (const relative of audited) {
    const content = await readFile(join(sourceRoot, relative), 'utf8');
    assert.match(content, /recordAudit\(/, `${relative} must record audit entries`);
  }
});

test('no entity with history can be hard-deleted', async () => {
  const dress = await readFile(join(sourceRoot, 'features/dresses/dress.service.ts'), 'utf8');
  const customer = await readFile(join(sourceRoot, 'features/customers/customer.service.ts'), 'utf8');

  for (const [name, content] of [['dress', dress], ['customer', customer]]) {
    assert.match(content, /Blockers\(/, `${name} deletion must consult blockers`);
    assert.match(content, /استخدمي الأرشفة بدل الحذف/, `${name} deletion must explain the archive path in Arabic`);
    assert.match(content, /archive/i, `${name} must offer archiving`);
  }
});

test('inventory codes are allocated monotonically and never from the array length', async () => {
  const dress = await readFile(join(sourceRoot, 'features/dresses/dress.service.ts'), 'utf8');
  assert.match(dress, /allocateInventoryCode\(\)/);
  assert.doesNotMatch(dress, /length \+ 1/, 'codes must never be derived from the current item count');

  const allocator = await readFile(join(sourceRoot, 'engines/persistence/codeAllocator.ts'), 'utf8');
  assert.match(allocator, /reconcileCounter/, 'the counter must be reconciled after restore');
});

test('a refundable deposit is never treated as revenue', async () => {
  const finance = await readFile(join(sourceRoot, 'features/finance/finance.service.ts'), 'utf8');
  assert.match(finance, /depositLiabilityCollected/);
  assert.match(finance, /depositRetained/);
  assert.match(finance, /recognisedIncome/);
  // Recognised income must be built from realised money, not from gross collections.
  assert.match(finance, /const recognisedIncome = netRentalRevenue \+ saleRevenue \+ totalFees \+ adjustments/);
  assert.doesNotMatch(finance, /const recognisedIncome = [^;]*depositRetained/, 'retained cash must not duplicate its settlement fee');
});

test('reports project the finance layer instead of recomputing their own money', async () => {
  const report = await readFile(join(sourceRoot, 'features/reports/report.service.ts'), 'utf8');
  assert.match(report, /getFinanceTotals\(/);
  assert.match(report, /getItemFinance\(/);
});

test('a returned item can never go straight back to available', async () => {
  const deliveryReturn = await readFile(join(sourceRoot, 'features/workflows/deliveryReturnCommands.ts'), 'utf8');
  assert.match(deliveryReturn, /'inspection', 'laundry', 'maintenance', 'damaged'/);
  assert.doesNotMatch(deliveryReturn, /ALLOWED_RETURN_STATUSES = \[[^\]]*'available'/);

  const salesLedger = await readFile(join(sourceRoot, 'features/dresses/salesLedger.service.ts'), 'utf8');
  assert.match(salesLedger, /updateDressStatus\(line\.dressCode, 'inspection'\)/, 'a sale return must pass inspection too');
});

test('the sale invoice is the only sale path', async () => {
  const sellModal = await readFile(join(sourceRoot, 'features/dresses/SellDressModal.tsx'), 'utf8');
  assert.match(sellModal, /quickSaleCommand/, 'the quick sale must create a canonical invoice');
  assert.doesNotMatch(sellModal, /\baddSale\(/, 'no separate sale path may remain in the UI');
});

test('availability is derived from dates, not stored on the item', async () => {
  const calendar = await readFile(join(sourceRoot, 'features/reservations/reservationCalendar.model.ts'), 'utf8');
  assert.match(calendar, /export function isItemOccupiedOn/);

  const constants = await readFile(join(sourceRoot, 'shared/domain/dressConstants.ts'), 'utf8');
  const optionsBlock = constants.slice(constants.indexOf('DRESS_STATUS_OPTIONS'));
  assert.doesNotMatch(
    optionsBlock.slice(0, optionsBlock.indexOf(']')),
    /'reserved'/,
    '`reserved` must not be a selectable physical state',
  );
});

test('demo data does not seed a physical reserved state', async () => {
  const demo = await readFile(join(sourceRoot, 'engines/persistence/demoDataRecords.ts'), 'utf8');
  const inventoryBlock = demo.slice(0, demo.indexOf('mockReservations'));
  assert.doesNotMatch(inventoryBlock, /status: 'reserved'/);
});

test('the React Router RSC advisory remains outside this DOM-only application', async () => {
  const files = await collectFiles(sourceRoot, isSource);
  const rscApiPattern = /\b(?:RSCHydratedRouter|RSCStaticRouter|routeRSCServerRequest|matchRSCServerRequest|unstable_RSC)\b/;
  const offenders = [];

  for (const file of files) {
    const content = await readFile(file, 'utf8');
    if (rscApiPattern.test(content)) offenders.push(file.replace(repositoryRoot, ''));
  }

  assert.deepEqual(offenders, [], 'GHSA-qwww-vcr4-c8h2 becomes applicable if an unstable RSC API is introduced');
});

test('the release documentation set exists and records outstanding work honestly', async () => {
  const runtimeQa = await readFile(join(repositoryRoot, 'docs/RUNTIME_QA.md'), 'utf8');
  assert.match(runtimeQa, /Outstanding/);
  assert.match(runtimeQa, /Tauri Windows/);
  assert.match(runtimeQa, /not.*treated as build evidence/i, 'tauri --info must not be claimed as a build');

  const release = await readFile(join(repositoryRoot, 'docs/RELEASE_NOTES_V1.md'), 'utf8');
  assert.match(release, /Known limitations|القيود المعروفة/);

  await readFile(join(repositoryRoot, 'docs/OPERATIONS_GUIDE.md'), 'utf8');
});
