import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

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

const isComponent = (name) => name.endsWith('.tsx');

test('the document shell is Arabic-first and RTL', async () => {
  const html = await readFile(join(repositoryRoot, 'index.html'), 'utf8');
  assert.match(html, /<html lang="ar" dir="rtl">/);
  assert.match(html, /width=device-width, initial-scale=1\.0/);

  const shell = await readFile(join(sourceRoot, 'app/shell/AppShell.tsx'), 'utf8');
  assert.match(shell, /dir="rtl"/);
});

test('global styles guard against horizontal overflow on small phones', async () => {
  const css = await readFile(join(sourceRoot, 'styles/global.css'), 'utf8');
  assert.match(css, /min-width:\s*320px/);
  assert.match(css, /overflow-x:\s*hidden/);
  assert.match(css, /overflow-wrap:\s*anywhere/, 'long codes and notes must wrap instead of widening the page');
});

test('the app shell reserves space for the mobile bottom navigation and the safe area', async () => {
  const shell = await readFile(join(sourceRoot, 'app/shell/AppShell.tsx'), 'utf8');
  assert.match(shell, /min-w-0/, 'flex/grid children must not force horizontal overflow');
  assert.match(shell, /safe-area-inset-bottom/);

  const mobileNav = await readFile(join(sourceRoot, 'app/shell/MobileNavigation.tsx'), 'utf8');
  assert.match(mobileNav, /fixed inset-x-0 bottom-0/);
  assert.match(mobileNav, /lg:hidden/);
  assert.match(mobileNav, /safe-area-inset-bottom/);
  assert.match(mobileNav, /min-h-14/, 'tap targets must stay comfortable on phones');
  assert.match(mobileNav, /aria-label=/);
});

test('the modal scrolls its body, traps focus and is labelled', async () => {
  const modal = await readFile(join(sourceRoot, 'components/shared/Modal.tsx'), 'utf8');
  assert.match(modal, /role="dialog"/);
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /aria-labelledby=/);
  assert.match(modal, /event\.key === 'Escape'/);
  assert.match(modal, /event\.key !== 'Tab'/, 'the dialog must trap Tab focus');
  assert.match(modal, /overflow-y-auto overscroll-contain/, 'the body scrolls without scrolling the page behind');
});

test('the modal follows the visual viewport instead of fighting the keyboard', async () => {
  const modal = await readFile(join(sourceRoot, 'components/shared/Modal.tsx'), 'utf8');

  assert.match(modal, /visualViewport/, 'the sheet must resize with the software keyboard');
  assert.match(modal, /--modal-viewport-height/, 'the dialog height must follow the visual viewport');
  // A fixed-position body lock made the page jump on every focus/blur.
  assert.doesNotMatch(modal, /position\s*=\s*'fixed'/, 'the body lock must not use position: fixed');
  assert.match(modal, /lockCount/, 'nested dialogs must not unlock the page early');
  assert.match(modal, /previouslyFocused/, 'focus must return to the control that opened the dialog');
});

test('unified Empty, Loading and Error states exist and are Arabic', async () => {
  const states = await readFile(join(sourceRoot, 'components/shared/StateViews.tsx'), 'utf8');
  assert.match(states, /export function EmptyState/);
  assert.match(states, /export function LoadingState/);
  assert.match(states, /export function ErrorState/);
  assert.match(states, /role="status"/);
  assert.match(states, /aria-live="polite"/);
  assert.match(states, /role="alert"/);
  assert.match(states, /جارٍ التحميل/);
  assert.match(states, /إعادة المحاولة/);
});

test('no English placeholder scaffolding is shipped to the showroom', async () => {
  const components = await collectFiles(sourceRoot, isComponent);
  const offenders = [];
  for (const file of components) {
    const content = await readFile(file, 'utf8');
    if (/In progress<\/p>|This page is part of the approved roadmap/.test(content)) {
      offenders.push(file.replace(repositoryRoot, ''));
    }
  }
  assert.deepEqual(offenders, []);
});

test('every icon-only control carries an accessible Arabic label', async () => {
  const components = await collectFiles(sourceRoot, isComponent);
  const offenders = [];

  for (const file of components) {
    const content = await readFile(file, 'utf8');
    // Buttons whose only child is an icon element must be labelled.
    const iconOnlyButtons = content.match(/<button[^>]*>\s*<[A-Z][A-Za-z]*\s[^>]*\/>\s*<\/button>/g) ?? [];
    for (const button of iconOnlyButtons) {
      if (!/aria-label=|aria-labelledby=/.test(button)) {
        offenders.push(`${file.replace(repositoryRoot, '')}: ${button.slice(0, 80)}`);
      }
    }
  }

  assert.deepEqual(offenders, []);
});

test('destructive and money-changing submits are guarded against double submit', async () => {
  // Every modal that writes money or stock. A second tap on any of these used to
  // create a duplicate record; the expense, invoice and appointment forms were
  // completely unguarded until this was enforced here.
  const guarded = [
    'features/payments/AddPaymentModal.tsx',
    'features/delivery-return/DeliveryReturnModal.tsx',
    'features/dresses/SellDressModal.tsx',
    'features/dresses/CreateSaleInvoiceModal.tsx',
    'features/service/OpenServiceTaskModal.tsx',
    'features/service/CompleteServiceTaskModal.tsx',
    'features/expenses/AddExpenseModal.tsx',
    'features/accessories/AddAccessoryModal.tsx',
    'features/appointments/AddAppointmentModal.tsx',
  ];

  for (const relative of guarded) {
    const content = await readFile(join(sourceRoot, relative), 'utf8');
    assert.match(content, /isSubmitting/, `${relative} must track submission state`);
    assert.match(content, /isSubmitting\) return;/, `${relative} must ignore a second submit`);
    assert.match(content, /idempotencyKey/, `${relative} must send an idempotency key`);
    const disablesSubmit = /disabled=\{[^}]*isSubmitting/.test(content) || /<FormActions[\s\S]*?isSubmitting=/.test(content);
    assert.ok(disablesSubmit, `${relative} must disable its submit button while saving`);
  }
});

test('no persisted identifier is generated from Math.random', async () => {
  const files = await collectFiles(sourceRoot, (name) => /\.(ts|tsx)$/.test(name));
  const offenders = [];

  for (const file of files) {
    const content = await readFile(file, 'utf8');
    // Strip comments so an explanation of the old defect does not count as one.
    const code = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    if (/Math\.random\(\)/.test(code)) offenders.push(file.replace(repositoryRoot, ''));
  }

  // Ids must come from the crypto-backed generator so they cannot collide.
  assert.deepEqual(offenders, []);
});

test('the reservation calendar is usable on a phone and labelled for assistive tech', async () => {
  const calendar = await readFile(join(sourceRoot, 'features/reservations/ReservationCalendar.tsx'), 'utf8');

  assert.match(calendar, /aria-label="تقويم الحجوزات"/);
  assert.match(calendar, /aria-label="الفترة السابقة"/);
  assert.match(calendar, /aria-label="الفترة التالية"/);
  assert.match(calendar, /aria-pressed=/, 'view and status toggles must expose their pressed state');
  assert.match(calendar, /lg:hidden/, 'phones must get the stacked agenda instead of a seven-column grid');
  assert.match(calendar, /hidden lg:block/, 'the seven-column grid is desktop-only');
  assert.match(calendar, /min-h-11|min-h-9/, 'calendar controls must stay tappable');

  const model = await readFile(join(sourceRoot, 'features/reservations/reservationCalendar.ts'), 'utf8');
  assert.match(model, /parseLocalDate|addDaysISO/, 'calendar dates must use the local-time helpers');
  assert.doesNotMatch(model, /new Date\(`\$\{[^}]+\}T00:00:00`\)/, 'no ad-hoc date parsing inside the calendar');
});

test('calendar and accessory colours come from the design system, not inline values', async () => {
  const calendar = await readFile(join(sourceRoot, 'features/reservations/ReservationCalendar.tsx'), 'utf8');
  assert.match(calendar, /RESERVATION_STATUS_STYLES/);
  assert.match(calendar, /RESERVATION_STATUS_DOT_STYLES/);
  assert.doesNotMatch(calendar, /#[0-9a-fA-F]{6}/, 'no hardcoded hex colours in the calendar');

  const accessories = await readFile(join(sourceRoot, 'features/accessories/AccessoriesPage.tsx'), 'utf8');
  assert.match(accessories, /ACCESSORY_STATUS_STYLES/);
  assert.doesNotMatch(accessories, /#[0-9a-fA-F]{6}/, 'no hardcoded hex colours on the accessories page');

  const constants = await readFile(join(sourceRoot, 'shared/domain/accessoryConstants.ts'), 'utf8');
  assert.match(constants, /satisfies Record<AccessoryStatus, string>/, 'every accessory status must have a label and a style');
});

test('accessory screens are Arabic, labelled and guarded against double submit', async () => {
  const modal = await readFile(join(sourceRoot, 'features/accessories/AddAccessoryModal.tsx'), 'utf8');
  assert.match(modal, /isSubmitting/);
  assert.match(modal, /isSubmitting\) return;/);
  assert.match(modal, /idempotencyKey/);
  assert.match(modal, /disabled=\{[^}]*isSubmitting/);

  const page = await readFile(join(sourceRoot, 'features/accessories/AccessoriesPage.tsx'), 'utf8');
  assert.match(page, /min-h-11/, 'primary accessory actions must stay tappable on phones');
  assert.match(page, /className="sr-only"/, 'every filter control needs a visible or screen-reader label');

  const checklist = await readFile(join(sourceRoot, 'features/delivery-return/DeliveryAccessoryChecklist.tsx'), 'utf8');
  assert.match(checklist, /htmlFor=\{rowId\}/, 'accessory rows must be label-linked to their checkbox');
  assert.match(checklist, /aria-label="ملحقات الحجز"/);
});

test('the accessory label print path escapes its values through the shared boundary', async () => {
  const label = await readFile(join(sourceRoot, 'features/accessories/printAccessoryLabel.ts'), 'utf8');
  assert.match(label, /from '@platform\/printing'/, 'printing must go through the shared boundary');
  assert.match(label, /escapeHtml\(/);
  assert.doesNotMatch(label, /window\.open/, 'no direct popup access outside the platform layer');
});

test('the inventory performance report is RTL-safe, mobile-safe and labelled', async () => {
  const page = await readFile(join(sourceRoot, 'features/reports/InventoryPerformancePage.tsx'), 'utf8');

  assert.match(page, /overflow-x-auto/, 'the detail table must scroll instead of widening the page');
  assert.match(page, /min-h-11/, 'primary actions must stay tappable on phones');
  assert.match(page, /className="sr-only"/, 'the table needs a caption for assistive tech');
  assert.match(page, /aria-label="ترتيب حسب/, 'sortable headers must announce what they sort by');
  assert.match(page, /aria-label=\{`فتح تفاصيل أداء/, 'row actions must name the item they open');
  assert.match(page, /no-print/, 'filters and buttons must be excluded from print output');
  assert.doesNotMatch(page, /#[0-9a-fA-F]{6}/, 'no hardcoded hex colours in the report page');

  const detail = await readFile(join(sourceRoot, 'features/reports/InventoryPerformanceDetailPanel.tsx'), 'utf8');
  assert.match(detail, /scope="col"/, 'detail tables must use proper header scopes');
  assert.match(detail, /Modal/, 'the detail view reuses the shared focus-trapping modal');

  const chart = await readFile(join(sourceRoot, 'features/reports/PerformanceTrendChart.tsx'), 'utf8');
  assert.match(chart, /aria-hidden="true"/, 'decorative bars must be hidden from screen readers');
  assert.match(chart, /sr-only/, 'every bar needs a readable text equivalent');
});

test('report exports keep Arabic intact and cannot be turned into a spreadsheet formula', async () => {
  const csv = await readFile(join(sourceRoot, 'shared/utils/csv.ts'), 'utf8');
  assert.match(csv, /\\uFEFF/, 'the UTF-8 BOM is required for Arabic in Excel');
  assert.match(csv, /FORMULA_TRIGGERS/, 'formula injection must be neutralised centrally');

  const exporter = await readFile(join(sourceRoot, 'features/reports/inventoryPerformanceExport.ts'), 'utf8');
  assert.match(exporter, /from '@platform\/printing'/, 'printing must go through the shared boundary');
  assert.match(exporter, /escapeHtml\(/);
  assert.doesNotMatch(exporter, /window\.open/, 'no direct popup access outside the platform layer');
});

test('shared form primitives make the accessible version the default', async () => {
  const field = await readFile(join(sourceRoot, 'components/shared/FormField.tsx'), 'utf8');

  assert.match(field, /htmlFor=\{id\}/, 'every label must be tied to its control');
  assert.match(field, /aria-invalid=/, 'a failed field must announce itself');
  assert.match(field, /role="alert"/, 'errors must be announced, not only shown');
  assert.match(field, /aria-describedby=\{describedBy\}/, 'errors and hints must be described');
  assert.match(field, /min-h-11/, 'controls must stay tappable on phones');
  assert.match(field, /inputMode="decimal"/, 'money fields must open a numeric keypad');
  assert.match(field, /aria-busy=/, 'a pending submit must expose its state');
});

test('the phone shell prevents iOS auto-zoom and sideways rubber-banding', async () => {
  const css = await readFile(join(sourceRoot, 'styles/global.css'), 'utf8');

  // iOS zooms any focused control rendered below 16px; that was the reported defect.
  assert.match(css, /pointer: coarse/, 'touch devices need their own control sizing');
  assert.match(css, /font-size:\s*16px/, 'form controls must render at 16px on touch devices');
  assert.match(css, /overscroll-behavior:\s*none/, 'both scroll axes must be pinned');
  assert.match(css, /touch-action:\s*manipulation/, 'a double tap must not zoom a control');

  const html = await readFile(join(repositoryRoot, 'index.html'), 'utf8');
  const viewportTag = /<meta name="viewport"[^>]*>/.exec(html)?.[0] ?? '';
  assert.match(viewportTag, /viewport-fit=cover/, 'safe-area insets need viewport-fit');
  // Locking zoom would "fix" the symptom by breaking accessibility.
  assert.doesNotMatch(viewportTag, /maximum-scale|user-scalable=no/, 'zoom must never be locked');
});

test('printing renders in a dismissible in-app view instead of a detached window', async () => {
  const printing = await readFile(join(sourceRoot, 'platform/printing/printDocument.ts'), 'utf8');

  assert.match(printing, /iframe/, 'the document renders in-app so the operator can return');
  assert.match(printing, /aria-modal/, 'the print view is a labelled dialog');
  assert.match(printing, /'إغلاق'/, 'there must be an explicit Arabic way out');
  assert.match(printing, /popstate/, 'a system back gesture must close the document');
  assert.match(printing, /Escape/, 'Escape must close the document');
  assert.doesNotMatch(printing.replace(/\/\*[\s\S]*?\*\//g, ''), /window\.open\s*\(/, 'no detached popup may remain');
});

test('the dashboard surfaces uncollected money and the day\'s work, not just counts', async () => {
  const page = await readFile(join(sourceRoot, 'features/dashboard/DashboardPage.tsx'), 'utf8');

  assert.match(page, /مبالغ غير محصّلة/, 'uncollected money must be visible on the board');
  assert.match(page, /role="alert"/, 'the money warning must be announced');
  assert.match(page, /تسليمات اليوم/);
  assert.match(page, /إرجاعات اليوم/);
  assert.match(page, /EmptyState/, 'a brand-new showroom must get onboarding, not blank cards');
  assert.doesNotMatch(page, /#[0-9a-fA-F]{6}/, 'no hardcoded hex colours on the dashboard');

  const service = await readFile(join(sourceRoot, 'features/dashboard/dashboard.service.ts'), 'utf8');
  assert.match(service, /getFinanceTotals/, 'money must come from the finance layer');
  assert.match(service, /getOutstandingRentalBalances/, 'owed money must come from the canonical source');
});

test('every list page uses the shared page header, cards, filters and empty state', async () => {
  // These pages each hand-rolled their own header, summary tiles, filter row and
  // "no results" block, and had drifted apart. The shared primitives keep the
  // rhythm identical and carry the accessibility with them.
  const listPages = [
    'features/payments/PaymentsPage.tsx',
    'features/expenses/ExpensesPage.tsx',
    'features/delivery-return/DeliveryReturnPage.tsx',
  ];

  for (const relative of listPages) {
    const content = await readFile(join(sourceRoot, relative), 'utf8');
    assert.match(content, /<PageHeader/, `${relative} must use the shared page header`);
    assert.match(content, /<SummaryCard/, `${relative} must use the shared summary card`);
    assert.match(content, /<FilterBar>/, `${relative} must use the shared filter bar`);
    assert.match(content, /<EmptyState/, `${relative} must use the unified empty state`);
    assert.match(content, /min-w-0/, `${relative} must not let content widen the page`);
    assert.match(content, /min-h-11/, `${relative} primary action must stay tappable`);
    // A raw <h1> means the page bypassed the shared header.
    assert.doesNotMatch(content, /<h1 /, `${relative} must not hand-roll its title`);
  }
});

test('filter controls are labelled, tappable and use focus-visible rings', async () => {
  const filterBarSource = await readFile(join(sourceRoot, 'components/shared/FilterBar.tsx'), 'utf8');
  // Strip comments so describing the old defect does not count as committing it.
  const filterBar = filterBarSource.replace(/\/\*[\s\S]*?\*\//g, '');

  assert.match(filterBar, /className="sr-only"/, 'every filter needs an accessible name');
  assert.match(filterBar, /aria-label=\{label\}/, 'selects must announce what they filter');
  assert.match(filterBar, /min-h-11/, 'filters must stay tappable on phones');
  // A plain `focus:` ring fires on mouse click too, which is visual noise.
  assert.match(filterBar, /focus-visible:ring/, 'rings must be keyboard-only');
  assert.doesNotMatch(filterBar, /(?<!-)\bfocus:ring/, 'no mouse-triggered focus rings');
});

test('no interactive control draws a focus ring on mouse click', async () => {
  const components = await collectFiles(sourceRoot, isComponent);
  const offenders = [];

  for (const file of components) {
    const content = (await readFile(file, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
    // `focus:` fires for pointer clicks too; only `focus-visible:` is keyboard-only.
    if (/(?<!-)\bfocus:ring/.test(content)) offenders.push(file.replace(repositoryRoot, ''));
  }

  assert.deepEqual(offenders, []);
});

test('summary tiles are 2-up on phones on every page that has them', async () => {
  const pages = await collectFiles(sourceRoot, isComponent);
  const offenders = [];

  for (const file of pages) {
    // The component's own definition is not a page that renders a grid of them.
    if (file.endsWith('SummaryCard.tsx')) continue;
    const content = await readFile(file, 'utf8');
    if (!content.includes('<SummaryCard')) continue;
    // A summary grid that is not 2-up collapses to one tall column on a phone.
    const grids = content.match(/className="grid[^"]*"/g) ?? [];
    const hasTwoUp = grids.some((grid) => /grid-cols-2/.test(grid));
    if (!hasTwoUp) offenders.push(file.replace(repositoryRoot, ''));
  }

  assert.deepEqual(offenders, []);
});

test('the visual system has real surfaces instead of white on white', async () => {
  const cardSource = await readFile(join(sourceRoot, 'components/shared/SummaryCard.tsx'), 'utf8');
  // Strip comments so describing the old defect does not count as committing it.
  const card = cardSource.replace(/\/\*[\s\S]*?\*\//g, '');
  // Fading every tone to white on a near-white page is what made screens look flat.
  assert.doesNotMatch(card, /to-white/, 'tiles must keep a tinted surface');
  assert.match(card, /ring-1/, 'tiles need a visible edge');
  assert.match(card, /truncate/, 'long money strings must not overflow a 2-up phone grid');

  const css = await readFile(join(sourceRoot, 'styles/global.css'), 'utf8');
  assert.doesNotMatch(css, /#f8fafc/, 'the canvas must not sit at the same value as the cards');

  const field = await readFile(join(sourceRoot, 'components/shared/FormField.tsx'), 'utf8');
  assert.match(field, /bg-stone-50/, 'a white input on a white card is invisible until tapped');
  assert.match(field, /focus-visible:bg-white/, 'the active field must stand out');
});

test('long lists are chosen with a searchable picker that can be cleared', async () => {
  const picker = await readFile(join(sourceRoot, 'components/shared/SearchableSelect.tsx'), 'utf8');

  assert.match(picker, /role="listbox"/);
  assert.match(picker, /aria-expanded=/);
  assert.match(picker, /aria-selected=/);
  assert.match(picker, /بحث داخل/, 'the filter box needs its own accessible name');
  assert.match(picker, /إزالة الاختيار/, 'a choice must be removable');
  assert.match(picker, /min-h-11/, 'options must stay tappable');
  assert.match(picker, /'Escape'/, 'Escape must close the list');

  // The reservation form is the one that must never be a raw select of every piece.
  const reservation = await readFile(join(sourceRoot, 'features/reservations/CreateReservationModal.tsx'), 'utf8');
  assert.match(reservation, /<SearchableSelect/);
  assert.match(reservation, /getBookablePieces/, 'offered pieces must be resolved for the period');
});

test('inventory offers grid and list views and design grouping', async () => {
  const page = await readFile(join(sourceRoot, 'features/dresses/DressesPage.tsx'), 'utf8');

  assert.match(page, /<ViewModeToggle/, 'a compact list is needed for scanning many codes');
  assert.match(page, /useViewMode/);
  assert.match(page, /groupByDesign/, 'pieces must be groupable by their design');
  assert.match(page, /aria-pressed=/, 'view switches must expose their state');

  const toggle = await readFile(join(sourceRoot, 'components/shared/ViewModeToggle.tsx'), 'utf8');
  assert.match(toggle, /aria-label="طريقة العرض"/);
  assert.match(toggle, /getBrowserLocalStorage/, 'storage must go through the platform port');
});

test('every long-list picker is searchable, not a native wheel', async () => {
  // A native select is fine for five options and unusable for four hundred on a
  // phone: no typing, and no way to undo a choice.
  const pickerScreens = [
    'features/reservations/CreateReservationModal.tsx',
    'features/payments/AddPaymentModal.tsx',
    'features/delivery-return/DeliveryReturnModal.tsx',
    'features/dresses/SellDressModal.tsx',
    'features/dresses/CreateSaleInvoiceModal.tsx',
  ];

  for (const relative of pickerScreens) {
    const content = await readFile(join(sourceRoot, relative), 'utf8');
    assert.match(content, /<SearchableSelect/, `${relative} must use the searchable picker`);
    // A raw option list for records is exactly what was replaced.
    assert.doesNotMatch(content, /<option value="">اختاري (الحجز|العنصر|العميلة)</, `${relative} must not keep a raw record select`);
  }
});

test('WhatsApp is a reviewed hand-off, not a silent automatic send', async () => {
  const messaging = await readFile(join(sourceRoot, 'platform/messaging/whatsapp.ts'), 'utf8');

  assert.match(messaging, /wa\.me/, 'a deep link needs no API key, account or subscription');
  assert.match(messaging, /noopener/, 'an opened tab must not reach back into the app');
  assert.match(messaging, /encodeURIComponent/, 'the message must survive newlines and ampersands');
  assert.match(messaging, /defaultCountryCode/, 'a bare local number would be misrouted');

  const page = await readFile(join(sourceRoot, 'features/reminders/RemindersPage.tsx'), 'utf8');
  assert.match(page, /reminder\.message/, 'the operator must see the exact text before it is sent');
  assert.match(page, /min-h-11/, 'follow-up actions must stay tappable');
  assert.doesNotMatch(page, /#[0-9a-fA-F]{6}/, 'no hardcoded hex colours');

  // Reminders are derived; storing them would create a second source of truth.
  const service = await readFile(join(sourceRoot, 'features/reminders/reminder.service.ts'), 'utf8');
  assert.match(service, /businessDate/, 'a dismissal must expire so an overdue item is chased again');
});

test('operator attribution is stamped centrally and never claimed as a login', async () => {
  const audit = await readFile(join(sourceRoot, 'features/audit/audit.service.ts'), 'utf8');
  // Stamped inside recordAudit so no caller can forget who acted.
  assert.match(audit, /performedBy: input\.performedBy \?\? getCurrentOperatorName\(\)/);

  const operator = await readFile(join(sourceRoot, 'features/operators/operator.service.ts'), 'utf8');
  assert.match(operator, /not\*\* authentication|not authentication/i, 'it must not be mistaken for a login');
  assert.match(operator, /getBrowserLocalStorage/, 'device preference goes through the platform port');

  const settings = await readFile(join(sourceRoot, 'features/preferences/OperatorSettings.tsx'), 'utf8');
  assert.match(settings, /ليس تسجيل دخول/, 'the UI must say plainly that this does not protect the app');
});

test('conduct warnings reach the operator before a booking is taken', async () => {
  const card = await readFile(join(sourceRoot, 'features/customers/CustomersPage.tsx'), 'utf8');
  assert.match(card, /conduct\.advisories/, 'a warning behind a click is a warning nobody reads');
  assert.match(card, /role="alert"/);

  const service = await readFile(join(sourceRoot, 'features/customers/customerConduct.service.ts'), 'utf8');
  assert.match(service, /getDeliveryReturnRecords/, 'incidents must be derived, not typed');
  assert.match(service, /recordedBy/, 'a judgement about a customer must not be anonymous');
});

test('the daily operations journey is reachable from the navigation', async () => {
  const navigation = await readFile(join(sourceRoot, 'app/shell/navigation.ts'), 'utf8');
  const routes = await readFile(join(sourceRoot, 'app/router/AppRoutes.tsx'), 'utf8');

  const required = [
    '/inventory',
    '/accessories',
    '/customers',
    '/reservations',
    '/delivery-return',
    '/sales',
    '/service',
    '/payments',
    '/expenses',
    '/daily-closing',
    '/reports',
    '/reminders',
    '/waitlist',
    '/availability',
    '/stocktake',
    '/inventory-performance',
    '/preferences',
  ];

  for (const route of required) {
    assert.ok(navigation.includes(`'${route}'`), `${route} must be reachable from the navigation`);
    assert.ok(
      routes.includes(`path="${route.slice(1)}"`) || route === '/',
      `${route} must have a route`,
    );
  }
});

test('availability search leads with the date and never hides why a piece is out', async () => {
  const page = await readFile(join(sourceRoot, 'features/availability/AvailabilitySearchPage.tsx'), 'utf8');

  // The whole point of the screen is the reverse query, so the period inputs
  // must be first-class controls rather than a filter buried in a drawer.
  assert.match(page, /type="date"/, 'the period must be chosen with real date inputs');
  assert.match(page, /<PageHeader/, 'the page must use the shared header');
  assert.match(page, /<SummaryCard/, 'the page must use the shared summary card');
  assert.match(page, /<FilterBar>/, 'the page must use the shared filter bar');
  assert.match(page, /<EmptyState/, 'an empty result must be explained, not left blank');
  assert.match(page, /min-h-11/, 'actions must stay tappable on a phone');
  assert.match(page, /grid-cols-2/, 'summary tiles must be 2-up on phones');
  assert.doesNotMatch(page, /<h1 /, 'the page must not hand-roll its title');

  // A bare "not available" sends the operator back to guessing. Every refusal
  // carries a reason, and a booked piece carries a date to counter-offer.
  assert.match(page, /REASON_LABELS/, 'unavailability must always state a reason');
  assert.match(page, /nextFreeDate/, 'a booked piece must offer the next free date');
  assert.match(page, /alternativePieceCodes/, 'free siblings of the same design must be suggested');
});

test('a piece found free can be booked without being searched for again', async () => {
  const page = await readFile(join(sourceRoot, 'features/availability/AvailabilitySearchPage.tsx'), 'utf8');
  const reservations = await readFile(join(sourceRoot, 'features/reservations/ReservationsPage.tsx'), 'utf8');
  const modal = await readFile(join(sourceRoot, 'features/reservations/CreateReservationModal.tsx'), 'utf8');

  assert.match(page, /reservations\?new=1&dress=/, 'the result must link straight into the booking form');
  assert.match(reservations, /createPrefill/, 'the reservations page must read the carried-over values');
  assert.match(modal, /prefill/, 'the booking form must accept the carried-over values');
  // The code is resolved against the live reservable list: booking the wrong
  // item silently would be worse than asking the operator to pick again.
  assert.match(modal, /reservable\.find\(\(dress\) => dress\.code === prefill\.dressCode\)/,
    'a prefilled code must be resolved, not trusted');
});

test('the stocktake loop stays hands-free and explains every absence', async () => {
  const page = await readFile(join(sourceRoot, 'features/stocktake/StocktakePage.tsx'), 'utf8');

  // Anything that forces the operator to put the phone down between pieces
  // turns a forty-item count into an hour, and an hour-long count never gets
  // done twice.
  assert.match(page, /autoFocus/, 'the scan field must stay focused for a physical scanner');
  assert.match(page, /onSubmit=\{\(event\) => \{/, 'Enter must submit a scan without a button press');
  assert.match(page, /BarcodeScanner/, 'the camera scanner must be available on a phone');

  assert.match(page, /<PageHeader/, 'the page must use the shared header');
  assert.match(page, /<SummaryCard/, 'the page must use the shared summary card');
  assert.match(page, /<EmptyState/, 'a showroom that never counted must be told why it matters');
  assert.match(page, /grid-cols-2/, 'summary tiles must be 2-up on phones');
  assert.match(page, /min-h-11/, 'actions must stay tappable');
  assert.doesNotMatch(page, /<h1 /, 'the page must not hand-roll its title');

  // A count that flags every rented dress is noise, and noise gets ignored.
  assert.match(page, /STOCKTAKE_ABSENCE_LABELS/, 'an explained absence must be labelled as such');
  assert.match(page, /غائبة بعذر/, 'legitimate absence must be separated from loss');
});

test('an app update waits for the operator and never reloads on its own', async () => {
  const notice = await readFile(join(sourceRoot, 'components/shared/AppUpdateNotice.tsx'), 'utf8');
  const shell = await readFile(join(sourceRoot, 'app/shell/AppShell.tsx'), 'utf8');

  assert.match(shell, /<AppUpdateNotice \/>/, 'the notice must be mounted in the shell');
  assert.match(notice, /applyPendingUpdate/, 'applying an update must be an explicit action');
  // The registration was changed from autoUpdate precisely so the operator
  // decides when it is safe to lose the current screen; a timer would undo it.
  assert.doesNotMatch(notice, /setTimeout|setInterval/, 'no timed automatic reload');
  assert.match(notice, /لاحقاً/, 'the operator must be able to defer');
  assert.match(notice, /min-h-11/, 'both actions must stay tappable');
  // The bottom tab bar is the operator's escape from any screen.
  assert.match(notice, /bottom-\[calc\(env\(safe-area-inset-bottom/, 'the banner must clear the mobile navigation');
});

test('the running build states its own version for support', async () => {
  const page = await readFile(join(sourceRoot, 'features/preferences/PreferencesPage.tsx'), 'utf8');
  const version = await readFile(join(sourceRoot, 'platform/app-update/appVersion.ts'), 'utf8');

  assert.match(page, /getAppBuildInfo/, 'settings must display the version');
  // Reading package.json at runtime would describe the repository, not the
  // bundle the showroom is actually running.
  assert.match(version, /__APP_VERSION__/, 'the version must be injected at build time');
});
