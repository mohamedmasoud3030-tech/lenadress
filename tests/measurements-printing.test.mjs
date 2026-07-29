import test from 'node:test';
import assert from 'node:assert/strict';
import { installStorage, uninstallStorage } from './helpers/storage.mjs';
import { installDom, uninstallDom, getPrintFrameDocument } from './helpers/dom.mjs';
import { REGISTERED_COLLECTIONS, resetCountersForTesting } from '../src/engines/persistence/index.ts';
import { addCustomer, getCustomers, updateCustomer } from '../src/features/customers/customer.service.ts';
import {
  assessLength,
  assessPieceFit,
  hasAnyMeasurement,
  parseLegacyMeasurements,
  suggestSize,
} from '../src/features/customers/measurements.service.ts';
import {
  DEFAULT_PRINT_SETTINGS,
  buildPrintDocumentMarkup,
  buildPrintStyles,
  getPaperDefinition,
  isSectionVisible,
  normalizePrintSettings,
} from '../src/platform/printing/index.ts';
import { getPrintSettings, savePrintSettings } from '../src/features/preferences/printSettings.service.ts';
import { printRentalContract } from '../src/features/reservations/printRentalContract.ts';
import { landingShowroomProfile } from '../src/pages/landing/landingContent.ts';

function cleanup() {
  uninstallDom();
  resetCountersForTesting();
  uninstallStorage();
}

// --- Measurements ---------------------------------------------------------

test('a size is not guessed without the one measurement that decides it', () => {
  // The bust decides whether a bodice closes at all; without it there is nothing
  // honest to suggest.
  const withoutBust = suggestSize({ waist: 70, hips: 95 });
  assert.equal(withoutBust.suggestedSize, null);
  assert.match(withoutBust.reason, /محيط الصدر/);

  assert.equal(suggestSize(undefined).suggestedSize, null);
  assert.equal(suggestSize({}).suggestedSize, null);
});

test('a full set of measurements maps to its chart size', () => {
  assert.equal(suggestSize({ bust: 86, waist: 67, hips: 93 }).suggestedSize, 'S');
  assert.equal(suggestSize({ bust: 92, waist: 74, hips: 100 }).suggestedSize, 'M');
  assert.equal(suggestSize({ bust: 98, waist: 80, hips: 105 }).suggestedSize, 'L');
  assert.equal(suggestSize({ bust: 120, waist: 103, hips: 128 }).suggestedSize, 'XXXL');
});

test('the bust outweighs the waist when they disagree', () => {
  // A bodice that will not close is unwearable; a waist is usually alterable.
  const conflicting = suggestSize({ bust: 98, waist: 66, hips: 104 });
  assert.equal(conflicting.suggestedSize, 'L', 'the bust must win');
});

test('a partial suggestion says what is missing instead of pretending', () => {
  const partial = suggestSize({ bust: 92 });
  assert.equal(partial.suggestedSize, 'M');
  assert.ok(partial.missing.length > 0);
  assert.match(partial.reason, /تقريبي/);
});

test('a piece is matched, flagged as alterable, or refused', () => {
  const measurements = { bust: 92, waist: 74, hips: 100 }; // suggests M

  assert.equal(assessPieceFit({ code: 'D-1', size: 'M' }, measurements).level, 'exact');
  assert.equal(assessPieceFit({ code: 'D-2', size: 'L' }, measurements).level, 'close');
  assert.equal(assessPieceFit({ code: 'D-3', size: 'XL' }, measurements).level, 'alterable');
  // Smaller is riskier than larger: a gown cannot always be let out.
  assert.equal(assessPieceFit({ code: 'D-4', size: 'S' }, measurements).level, 'alterable');
  assert.equal(assessPieceFit({ code: 'D-5', size: 'XXXL' }, measurements).level, 'unsuitable');
});

test('a non-standard size label is reported as unknown, never guessed', () => {
  const measurements = { bust: 92, waist: 74, hips: 100 };
  const fit = assessPieceFit({ code: 'D-6', size: '42' }, measurements);

  assert.equal(fit.level, 'unknown', 'mapping 42 to a letter size would be a fabrication');
  assert.match(fit.note, /غير قياسي/);
});

test('fit is unknown when the customer has no measurements at all', () => {
  const fit = assessPieceFit({ code: 'D-7', size: 'M' }, undefined);
  assert.equal(fit.level, 'unknown');
  assert.equal(hasAnyMeasurement(undefined), false);
  assert.equal(hasAnyMeasurement({ notes: 'نص فقط' }), false, 'a note is not a measurement');
  assert.equal(hasAnyMeasurement({ bust: 90 }), true);
});

test('gown length accounts for the heel she will wear', () => {
  // 140 shoulder-to-hem + 8cm heel = 148 effective.
  assert.match(assessLength(148, { length: 140, heelHeight: 8 }), /مناسب/);
  assert.match(assessLength(155, { length: 140, heelHeight: 8 }), /أطول/);
  assert.match(assessLength(140, { length: 140, heelHeight: 8 }), /أقصر/);
  assert.equal(assessLength(undefined, { length: 140 }), null);
  assert.equal(assessLength(150, {}), null);
});

test('legacy free text is read for numbers and never discarded', () => {
  const parsed = parseLegacyMeasurements('الصدر 92 الخصر 74 الطول 165 وتفضل الأكمام الطويلة');

  assert.equal(parsed.bust, 92);
  assert.equal(parsed.waist, 74);
  assert.equal(parsed.height, 165);
  // Whatever could not be parsed must survive verbatim.
  assert.match(parsed.notes, /الأكمام الطويلة/);
  assert.deepEqual(parseLegacyMeasurements('   '), {});
});

test('structured measurements persist on the customer record', () => {
  installStorage();
  try {
    const customer = addCustomer({ name: 'مريم', phone: '90000080', status: 'normal' });
    updateCustomer(customer.id, { bodyMeasurements: { bust: 92, waist: 74, hips: 100, measuredAt: '2026-07-30' } });

    const stored = getCustomers().find((item) => item.id === customer.id);
    assert.equal(stored.bodyMeasurements.bust, 92);
    assert.equal(stored.bodyMeasurements.measuredAt, '2026-07-30');
    assert.equal(suggestSize(stored.bodyMeasurements).suggestedSize, 'M');
  } finally {
    cleanup();
  }
});

test('updating a customer cannot create a duplicate phone or blank name', () => {
  installStorage();
  try {
    const first = addCustomer({ name: 'مريم', phone: '90000081', status: 'normal' });
    addCustomer({ name: 'سارة', phone: '90000082', status: 'normal' });

    assert.throws(() => updateCustomer(first.id, { phone: '90000082' }), /نفس رقم الهاتف/);
    assert.throws(() => updateCustomer(first.id, { name: '  ' }), /مطلوب/);
    assert.throws(() => updateCustomer('missing', { name: 'x' }), /غير موجودة/);
  } finally {
    cleanup();
  }
});

// --- Print settings -------------------------------------------------------

test('the print settings collection is registered so it survives a backup', () => {
  assert.ok(REGISTERED_COLLECTIONS.includes('print-settings'));
});

test('each paper stock carries its own safe margins', () => {
  assert.equal(getPaperDefinition('A4').css, 'A4');
  assert.equal(getPaperDefinition('thermal80').continuous, true, 'roll paper has no fixed height');
  assert.equal(getPaperDefinition('label80x45').css, '80mm 45mm');
  // A 58mm receipt cannot carry A4 margins and keep any printable width.
  assert.ok(getPaperDefinition('thermal58').defaultMargins.left < getPaperDefinition('A4').defaultMargins.left);
});

test('invalid settings are clamped rather than trusted', () => {
  const normalized = normalizePrintSettings({
    paperSize: 'nonsense',
    margins: { top: 999, right: -5, bottom: 12, left: 3 },
    colorMode: 'rainbow',
    fontSize: 2,
    hiddenSections: ['terms', 'not-a-section'],
  });

  assert.equal(normalized.paperSize, 'A4');
  assert.equal(normalized.margins.top, 40, 'a 999mm margin would print nothing');
  assert.equal(normalized.margins.right, 0);
  assert.equal(normalized.colorMode, 'color');
  assert.equal(normalized.fontSize, 7, 'below 7pt Arabic becomes unreadable');
  assert.deepEqual(normalized.hiddenSections, ['terms']);
});

test('the stylesheet applies paper, margins, colour and font size', () => {
  const styles = buildPrintStyles({
    ...DEFAULT_PRINT_SETTINGS,
    paperSize: 'A5',
    margins: { top: 5, right: 6, bottom: 7, left: 8 },
    colorMode: 'grayscale',
    fontSize: 13,
  });

  assert.match(styles, /@page\{size:A5;margin:5mm 6mm 7mm 8mm\}/);
  assert.match(styles, /font-size:13pt/);
  assert.match(styles, /grayscale\(100%\)/);
  // Without this browsers strip backgrounds and every badge prints blank.
  assert.match(styles, /print-color-adjust:exact/);
  // A contract row split across a page break cannot be read.
  assert.match(styles, /break-inside:avoid/);
});

test('black and white uses a hard threshold, not a faint grey', () => {
  const styles = buildPrintStyles({ ...DEFAULT_PRINT_SETTINGS, colorMode: 'blackwhite' });
  assert.match(styles, /contrast\(1000%\)/);
});

test('continuous paper stacks the signatures instead of spreading them', () => {
  const roll = buildPrintStyles({ ...DEFAULT_PRINT_SETTINGS, paperSize: 'thermal80' });
  const sheet = buildPrintStyles({ ...DEFAULT_PRINT_SETTINGS, paperSize: 'A4' });

  assert.match(roll, /\.signatures\{display:block\}/);
  assert.doesNotMatch(sheet, /\.signatures\{display:block\}/);
});

test('compact density reduces spacing without shrinking the text', () => {
  const compact = buildPrintStyles({ ...DEFAULT_PRINT_SETTINGS, density: 'compact', fontSize: 11 });
  const comfortable = buildPrintStyles({ ...DEFAULT_PRINT_SETTINGS, density: 'comfortable', fontSize: 11 });

  assert.match(compact, /font-size:11pt/, 'density must not change legibility');
  assert.match(comfortable, /--print-gap:16px/);
  assert.match(compact, /--print-gap:12px/);
});

test('settings round-trip through storage and drive the printed document', () => {
  installStorage();
  installDom();
  try {
    savePrintSettings({
      ...DEFAULT_PRINT_SETTINGS,
      paperSize: 'A5',
      margins: { top: 8, right: 8, bottom: 8, left: 8 },
      colorMode: 'grayscale',
    });
    assert.equal(getPrintSettings().paperSize, 'A5');

    printRentalContract({
      id: 'r1',
      reservationNumber: 'RSV-900',
      customerName: 'مريم',
      customerPhone: '90000090',
      dressCode: 'D-001',
      dressName: 'فستان',
      pickupDate: '2026-08-01',
      returnDate: '2026-08-03',
      status: 'confirmed',
      rentalPrice: 100,
      depositAmount: 50,
      totalAmount: 150,
      paidAmount: 0,
      remainingAmount: 150,
    });

    const markup = getPrintFrameDocument().written.join('');
    assert.match(markup, /@page\{size:A5;margin:8mm 8mm 8mm 8mm\}/, 'the stored settings must reach the paper');
    assert.match(markup, /grayscale/);
  } finally {
    cleanup();
  }
});

test('a hidden section is genuinely absent from the printed document', () => {
  installStorage();
  installDom();
  try {
    const reservation = {
      id: 'r2',
      reservationNumber: 'RSV-901',
      customerName: 'مريم',
      customerPhone: '90000091',
      dressCode: 'D-002',
      dressName: 'فستان',
      pickupDate: '2026-08-01',
      returnDate: '2026-08-03',
      status: 'confirmed',
      rentalPrice: 100,
      depositAmount: 50,
      totalAmount: 150,
      paidAmount: 0,
      remainingAmount: 150,
    };

    savePrintSettings({ ...DEFAULT_PRINT_SETTINGS, hiddenSections: [] });
    printRentalContract(reservation);
    assert.match(getPrintFrameDocument().written.join(''), /الشروط والأحكام/);

    uninstallDom();
    installDom();
    savePrintSettings({ ...DEFAULT_PRINT_SETTINGS, hiddenSections: ['terms', 'signatures'] });
    printRentalContract(reservation);

    const trimmed = getPrintFrameDocument().written.join('');
    assert.doesNotMatch(trimmed, /الشروط والأحكام/, 'a hidden section must not print');
    assert.doesNotMatch(trimmed, /توقيع المعرض/);
    // The document itself must still be intact.
    assert.match(trimmed, /RSV-901/);
  } finally {
    cleanup();
  }
});

test('section visibility is a pure, inspectable rule', () => {
  const settings = normalizePrintSettings({ hiddenSections: ['terms'] });
  assert.equal(isSectionVisible(settings, 'terms'), false);
  assert.equal(isSectionVisible(settings, 'signatures'), true);
});

test('the document markup falls back safely when no settings are given', () => {
  const markup = buildPrintDocumentMarkup('عنوان', '<p>محتوى</p>');
  assert.match(markup, /<html dir="rtl" lang="ar">/);
  assert.match(markup, /محتوى/);
});

// --- Contact details ------------------------------------------------------

test('the showroom contact carries every provided channel', () => {
  const { contact } = landingShowroomProfile;

  assert.equal(contact.phone, '+968 9191 8186');
  assert.ok(contact.alternatePhones.includes('+966 50 868 8213'));
  assert.ok(contact.alternatePhones.includes('+20 121 210 1073'));
  assert.equal(contact.email, 'Ahmedmasoud@outlook.com');
  assert.equal(contact.alternateEmail, 'MohamedMs.oud@outlook.com');
});

test('the printed contract carries the contact details', () => {
  installStorage();
  installDom();
  try {
    savePrintSettings({ ...DEFAULT_PRINT_SETTINGS, hiddenSections: [] });
    printRentalContract({
      id: 'r3',
      reservationNumber: 'RSV-902',
      customerName: 'مريم',
      customerPhone: '90000092',
      dressCode: 'D-003',
      dressName: 'فستان',
      pickupDate: '2026-08-01',
      returnDate: '2026-08-03',
      status: 'confirmed',
      rentalPrice: 100,
      depositAmount: 50,
      totalAmount: 150,
      paidAmount: 0,
      remainingAmount: 150,
    });

    const markup = getPrintFrameDocument().written.join('');
    assert.match(markup, /9191 8186/, 'a customer must be able to reach the showroom');
    assert.match(markup, /Ahmedmasoud@outlook\.com/);
  } finally {
    cleanup();
  }
});
