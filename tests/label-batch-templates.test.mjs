import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { installStorage, uninstallStorage, futureDate } from './helpers/storage.mjs';
import { REGISTERED_COLLECTIONS, resetCountersForTesting } from '../src/engines/persistence/index.ts';
import { buildBarcodeLabelHtml, buildBarcodeLabelSheetHtml } from '../src/features/dresses/printBarcodeLabel.ts';
import {
  DEFAULT_MESSAGE_TEMPLATES,
  MAX_TEMPLATE_LENGTH,
  TEMPLATE_PLACEHOLDERS,
  buildTemplateVariables,
  getMessageTemplates,
  renderTemplate,
  resetMessageTemplates,
  saveMessageTemplates,
} from '../src/features/reminders/messageTemplates.ts';
import { addCustomer } from '../src/features/customers/customer.service.ts';
import { addDress } from '../src/features/dresses/dress.service.ts';
import { createReservation } from '../src/features/reservations/reservation.service.ts';
import { getReminders } from '../src/features/reminders/reminder.service.ts';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = join(repositoryRoot, 'src');

const svg = '<svg><rect /></svg>';

function label(code) {
  return { value: `BC-${code}`, svgMarkup: svg, itemName: `فستان ${code}`, itemCode: code };
}

function setup() {
  installStorage();
  resetCountersForTesting();
}

// ---------------------------------------------------------------- label batch

test('an empty batch is refused rather than printing a blank page', () => {
  assert.throws(() => buildBarcodeLabelSheetHtml([]), /لا توجد ملصقات/);
});

test('a batch renders one section per label', () => {
  const html = buildBarcodeLabelSheetHtml([label('DRS-001'), label('DRS-002'), label('DRS-003')]);
  assert.equal(html.split('<section class="barcode-label').length - 1, 3);
});

test('every label but the last forces a page break', () => {
  // Label stock is a continuous roll of fixed-size stickers, so each label must
  // land on its own sticker rather than being tiled onto a sheet.
  const html = buildBarcodeLabelSheetHtml([label('A'), label('B'), label('C')]);
  assert.equal(html.split('barcode-label--break').length - 1, 3, 'two classes plus the CSS rule');
  assert.match(html, /page-break-after:always/);
});

test('a single-label batch does not force a trailing blank sticker', () => {
  const html = buildBarcodeLabelSheetHtml([label('ONLY')]);
  // Only the CSS rule mentions the class; no section carries it.
  assert.doesNotMatch(html, /<section class="barcode-label barcode-label--break"/);
});

test('the style block is emitted once, not per label', () => {
  const html = buildBarcodeLabelSheetHtml([label('A'), label('B'), label('C'), label('D')]);
  assert.equal(html.split('<style>').length - 1, 1);
});

test('the sheet keeps the label paper size rather than the document paper size', () => {
  const html = buildBarcodeLabelSheetHtml([label('A')]);
  assert.match(html, /@page\{size:80mm 45mm/);
});

test('label values are escaped so an item name cannot inject markup', () => {
  const html = buildBarcodeLabelSheetHtml([
    { value: 'V', svgMarkup: svg, itemName: '<img src=x onerror=alert(1)>', itemCode: 'C&C' },
  ]);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img/);
  assert.match(html, /C&amp;C/);
});

test('the single-label builder still works unchanged', () => {
  const html = buildBarcodeLabelHtml(label('DRS-009'));
  assert.match(html, /DRS-009/);
  assert.equal(html.split('<section class="barcode-label').length - 1, 1);
});

test('the batch is driven by the visible filter, not a second selection', async () => {
  const page = await readFile(join(sourceRoot, 'features/dresses/DressesPage.tsx'), 'utf8');
  // The operator has already narrowed to the new delivery; a checkbox column on
  // top would be the same choice made twice.
  assert.match(page, /printLabelsForItems/, 'the page must offer batch printing');
  assert.match(page, /filteredDresses\.map/, 'the filtered set is the selection');
});

test('barcodes are rendered detached so a large batch cannot freeze the list', async () => {
  const batch = await readFile(join(sourceRoot, 'features/dresses/barcodeLabelBatch.ts'), 'utf8');
  assert.match(batch, /createElementNS/, 'barcodes must be drawn into detached SVG elements');
  assert.doesNotMatch(batch, /appendChild\(/, 'nothing may be mounted just to be serialised');
});

test('one unencodable value does not abort the whole batch', async () => {
  const batch = await readFile(join(sourceRoot, 'features/dresses/barcodeLabelBatch.ts'), 'utf8');
  // The operator would have no way to tell which of forty items caused it.
  assert.match(batch, /skipped/, 'failures must be reported per item');
});

// ------------------------------------------------------------ message templates

test('the template collection is registered so custom wording survives a backup', () => {
  assert.ok(REGISTERED_COLLECTIONS.includes('message-templates'));
});

test('a fresh install gets the default wording', () => {
  setup();
  try {
    assert.deepEqual(getMessageTemplates(), DEFAULT_MESSAGE_TEMPLATES);
  } finally {
    uninstallStorage();
  }
});

test('every reminder kind has a default template', () => {
  const kinds = ['pickup_tomorrow', 'return_tomorrow', 'overdue_return', 'outstanding_balance'];
  kinds.forEach((kind) => {
    assert.ok(DEFAULT_MESSAGE_TEMPLATES[kind]?.trim(), `${kind} must have wording`);
  });
});

test('a custom template round-trips through storage', () => {
  setup();
  try {
    saveMessageTemplates({ pickup_tomorrow: 'أهلاً {{customerName}}' });
    assert.equal(getMessageTemplates().pickup_tomorrow, 'أهلاً {{customerName}}');
    // The others must be untouched.
    assert.equal(getMessageTemplates().return_tomorrow, DEFAULT_MESSAGE_TEMPLATES.return_tomorrow);
  } finally {
    uninstallStorage();
  }
});

test('an empty template falls back instead of sending a blank message', () => {
  setup();
  try {
    saveMessageTemplates({ pickup_tomorrow: '   ' });
    // A blank WhatsApp message under the showroom's name is worse than the
    // default wording.
    assert.equal(getMessageTemplates().pickup_tomorrow, DEFAULT_MESSAGE_TEMPLATES.pickup_tomorrow);
  } finally {
    uninstallStorage();
  }
});

test('an over-long template is refused', () => {
  setup();
  try {
    assert.throws(
      () => saveMessageTemplates({ pickup_tomorrow: 'x'.repeat(MAX_TEMPLATE_LENGTH + 1) }),
      /أطول من الحد/,
    );
  } finally {
    uninstallStorage();
  }
});

test('templates can be reset to the default wording', () => {
  setup();
  try {
    saveMessageTemplates({ overdue_return: 'مخصص' });
    resetMessageTemplates();
    assert.deepEqual(getMessageTemplates(), DEFAULT_MESSAGE_TEMPLATES);
  } finally {
    uninstallStorage();
  }
});

test('renderTemplate substitutes every known placeholder', () => {
  const output = renderTemplate('{{customerName}} / {{dressName}} / {{reservationNumber}}', {
    customerName: 'نورة',
    dressName: 'فستان',
    reservationNumber: 'RSV-1',
  });
  assert.equal(output, 'نورة / فستان / RSV-1');
});

test('renderTemplate tolerates spacing inside the braces', () => {
  assert.equal(renderTemplate('{{ customerName }}', { customerName: 'نورة' }), 'نورة');
});

test('an unknown placeholder is left visible rather than blanked', () => {
  // Blanking would hide the owner's typo behind a sentence with a hole in it;
  // leaving it visible makes the mistake obvious in the preview.
  assert.equal(renderTemplate('مرحباً {{dresName}}', { dressName: 'فستان' }), 'مرحباً {{dresName}}');
});

test('a template with no placeholders is returned unchanged', () => {
  assert.equal(renderTemplate('نص ثابت', { customerName: 'نورة' }), 'نص ثابت');
});

test('the accessory line disappears entirely when there are none', () => {
  const variables = buildTemplateVariables({
    customerName: 'نورة',
    dressName: 'فستان',
    reservationNumber: 'RSV-1',
    pickupDate: '2026-09-20',
    pickupTime: '10:00',
    returnDate: '2026-09-22',
    returnTime: '20:00',
    remainingAmount: 0,
    accessoryNames: [],
    brandName: 'LENA',
  });
  // An empty string with no newline, so the message has no blank line in it.
  assert.equal(variables.accessories, '');
});

test('the accessory line lists names and ends with its own newline', () => {
  const variables = buildTemplateVariables({
    customerName: 'نورة',
    dressName: 'فستان',
    reservationNumber: 'RSV-1',
    pickupDate: '2026-09-20',
    pickupTime: '10:00',
    returnDate: '2026-09-22',
    returnTime: '20:00',
    remainingAmount: 0,
    accessoryNames: ['طرحة', 'تاج'],
    brandName: 'LENA',
  });
  assert.match(variables.accessories, /طرحة، تاج/);
  assert.ok(variables.accessories.endsWith('\n'));
});

test('money is formatted, not printed as a bare number', () => {
  const variables = buildTemplateVariables({
    customerName: 'نورة',
    dressName: 'فستان',
    reservationNumber: 'RSV-1',
    pickupDate: '2026-09-20',
    pickupTime: '10:00',
    returnDate: '2026-09-22',
    returnTime: '20:00',
    remainingAmount: 45,
    accessoryNames: [],
    brandName: 'LENA',
  });
  assert.notEqual(variables.remainingAmount, '45');
  assert.match(variables.remainingAmount, /٤٥|45/);
});

test('every advertised placeholder is actually produced', () => {
  const variables = buildTemplateVariables({
    customerName: 'نورة',
    dressName: 'فستان',
    reservationNumber: 'RSV-1',
    pickupDate: '2026-09-20',
    pickupTime: '10:00',
    returnDate: '2026-09-22',
    returnTime: '20:00',
    remainingAmount: 10,
    accessoryNames: ['طرحة'],
    brandName: 'LENA',
  });
  // An advertised token that renders as literal text would look like a bug to
  // the owner using the editor.
  TEMPLATE_PLACEHOLDERS.forEach((placeholder) => {
    assert.notEqual(variables[placeholder.token], undefined, `${placeholder.token} must be produced`);
  });
});

test('a live reminder uses the showroom custom wording', () => {
  setup();
  try {
    saveMessageTemplates({ pickup_tomorrow: 'رسالتنا الخاصة لـ {{customerName}} — {{reservationNumber}}' });

    const customer = addCustomer({ name: 'نورة', phone: '+968 9191 8186', status: 'active' });
    const dress = addDress({
      name: 'فستان زفاف',
      description: '',
      category: 'زفاف',
      color: 'أبيض',
      size: '42',
      purchasePrice: 300,
      rentalPrice: 80,
      salePrice: 600,
      depositAmount: 50,
      status: 'available',
      isForRent: true,
      isForSale: false,
      images: [],
      barcode: '',
    });
    const reservation = createReservation({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: futureDate(1),
      returnDate: futureDate(3),
      depositAmount: 50,
    });

    const reminder = getReminders().find((item) => item.kind === 'pickup_tomorrow');
    assert.ok(reminder, 'a pickup tomorrow must raise a reminder');
    assert.equal(reminder.message, `رسالتنا الخاصة لـ نورة — ${reservation.reservationNumber}`);
  } finally {
    uninstallStorage();
  }
});

test('the editor previews the rendered message, not the raw template', async () => {
  const editor = await readFile(join(sourceRoot, 'features/preferences/MessageTemplatesEditor.tsx'), 'utf8');
  // Editing placeholder syntax blind is how a broken message reaches a real
  // customer under the showroom's name.
  assert.match(editor, /renderTemplate\(templates\[kind\], PREVIEW_VARIABLES\)/, 'a live preview is required');
  assert.match(editor, /TEMPLATE_PLACEHOLDERS/, 'the available tokens must be listed');
  assert.match(editor, /min-h-11/, 'actions must stay tappable');
});

test('templates use plain substitution, never an expression language', async () => {
  const templates = await readFile(join(sourceRoot, 'features/reminders/messageTemplates.ts'), 'utf8');
  // A template is content the owner edits, not code: an expression language
  // would turn a settings field into an injection surface.
  assert.doesNotMatch(templates, /new Function|eval\(/, 'no dynamic evaluation of owner-supplied text');
});
