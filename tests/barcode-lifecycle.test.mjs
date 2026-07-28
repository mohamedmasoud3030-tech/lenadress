import test from 'node:test';
import assert from 'node:assert/strict';
import {
  dressMatchesBarcode,
  generateDressBarcodeValue,
  normalizeDressBarcodeValue,
} from '../src/features/dresses/barcode.utils.ts';
import { addDress } from '../src/features/dresses/dress.service.ts';
import { buildBarcodeLabelHtml, printBarcodeLabel } from '../src/features/dresses/printBarcodeLabel.ts';
import { getDressLifecycleRecommendations } from '../src/features/dresses/dressLifecycle.utils.ts';
import { resetCountersForTesting } from '../src/engines/persistence/index.ts';
import { PrintDocumentError } from '../src/platform/printing/index.ts';
import { getPrintFrameDocument, getPrintOverlay, installDom, uninstallDom } from './helpers/dom.mjs';

function installStorage() {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      get length() { return store.size; },
      getItem(key) { return store.has(key) ? store.get(key) : null; },
      setItem(key, value) { store.set(key, String(value)); },
      removeItem(key) { store.delete(key); },
      key(index) { return Array.from(store.keys())[index] ?? null; },
      clear() { store.clear(); },
    },
  };
  return store;
}

function cleanup() {
  resetCountersForTesting();
  uninstallDom();
  delete globalThis.window;
}

const baseDressInput = {
  name: 'فستان اختبار',
  description: '',
  itemType: 'dress',
  category: 'سهرة',
  color: 'كحلي',
  size: 'M',
  purchasePrice: 100,
  rentalPrice: 20,
  salePrice: 150,
  depositAmount: 30,
  status: 'available',
  isForRent: true,
  isForSale: true,
  images: [],
  barcode: 'UNSTABLE-CLIENT-VALUE',
};

test('persisted barcode identity is stable and derived from the never-reused item code', () => {
  installStorage();
  try {
    const first = addDress({ ...baseDressInput, name: 'قطعة أولى' });
    const second = addDress({ ...baseDressInput, name: 'قطعة ثانية' });

    assert.equal(first.barcode, generateDressBarcodeValue(first.code));
    assert.equal(second.barcode, generateDressBarcodeValue(second.code));
    assert.notEqual(first.barcode, second.barcode);
    assert.notEqual(first.barcode, baseDressInput.barcode);
  } finally {
    cleanup();
  }
});

test('barcode lookup uses the same normalisation for scanner, code and stored value', () => {
  assert.equal(normalizeDressBarcodeValue(' d- 001 '), 'D-001');
  assert.equal(dressMatchesBarcode({ code: 'D-001', barcode: 'D-001' }, ' d-001 '), true);
  assert.equal(dressMatchesBarcode({ code: 'D-001', barcode: 'LEGACY-99' }, 'legacy-99'), true);
  assert.equal(dressMatchesBarcode({ code: 'D-001', barcode: 'LEGACY-99' }, 'D-999'), false);
});

test('barcode label values are escaped while generated SVG markup remains printable', () => {
  const html = buildBarcodeLabelHtml({
    value: 'D-001<script>',
    itemName: 'فستان <img>',
    itemCode: 'D-001&',
    svgMarkup: '<svg role="img"><rect /></svg>',
  });

  assert.match(html, /D-001&lt;script&gt;/);
  assert.match(html, /فستان &lt;img&gt;/);
  assert.match(html, /D-001&amp;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /<svg role="img"><rect \/><\/svg>/);
});

test('barcode label printing renders in a dismissible in-app view, not a trapping popup', () => {
  installStorage();
  installDom();
  try {
    printBarcodeLabel({ value: 'D-001', itemCode: 'D-001', itemName: 'فستان', svgMarkup: '<svg />' });

    const overlay = getPrintOverlay();
    assert.ok(overlay, 'the label must render inside the app so the operator can get back');
    assert.match(getPrintFrameDocument().written[0], /D-001/);
    assert.equal(getPrintFrameDocument().printCount, 1);
  } finally {
    cleanup();
  }
});

test('a platform that cannot host the print frame reports an actionable Arabic error', () => {
  installStorage();
  installDom();
  try {
    const originalCreate = globalThis.document.createElement;
    globalThis.document.createElement = (tagName) => {
      const element = originalCreate(tagName);
      if (element.tagName === 'IFRAME') {
        element.contentDocument = null;
        element.contentWindow = null;
      }
      return element;
    };

    assert.throws(
      () => printBarcodeLabel({ value: 'D-001', itemCode: 'D-001', itemName: 'فستان', svgMarkup: '<svg />' }),
      (error) => {
        assert.equal(error instanceof PrintDocumentError, true);
        assert.match(error.message, /تعذر تجهيز المستند للطباعة/);
        return true;
      },
    );
    globalThis.document.createElement = originalCreate;
  } finally {
    cleanup();
  }
});

test('lifecycle guidance reads canonical realised performance without recomputing money', () => {
  const recommendations = getDressLifecycleRecommendations({
    id: 'dress-1',
    code: 'D-001',
    name: 'فستان',
    timesRented: 2,
    status: 'available',
    purchasePrice: 100,
    rentalRevenue: 80,
    salesRevenue: 0,
    relatedExpenses: 40,
    totalRevenue: 80,
    netResult: -60,
    roiPercent: -60,
    recoveredPurchaseCost: false,
    maintenanceCostRatio: 50,
    lastMovementDate: '2026-01-01',
    inactivityDays: 120,
    requiresReview: true,
  });

  assert.ok(recommendations.some((item) => item.message.includes('120')));
  assert.ok(recommendations.some((item) => item.message.includes('تكلفة الخدمة')));
  assert.ok(recommendations.some((item) => item.message.includes('سالبة')));
});
