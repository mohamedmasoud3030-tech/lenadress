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
  const guarded = [
    'features/payments/AddPaymentModal.tsx',
    'features/delivery-return/DeliveryReturnModal.tsx',
    'features/dresses/SellDressModal.tsx',
    'features/service/OpenServiceTaskModal.tsx',
    'features/service/CompleteServiceTaskModal.tsx',
  ];

  for (const relative of guarded) {
    const content = await readFile(join(sourceRoot, relative), 'utf8');
    assert.match(content, /isSubmitting/, `${relative} must track submission state`);
    assert.match(content, /isSubmitting\) return;/, `${relative} must ignore a second submit`);
    assert.match(content, /idempotencyKey/, `${relative} must send an idempotency key`);
    assert.match(content, /disabled=\{[^}]*isSubmitting/, `${relative} must disable its submit button`);
  }
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
