import test from 'node:test';
import assert from 'node:assert/strict';
import { printSaleInvoice, PrintSaleInvoiceError } from '../src/features/dresses/printSaleInvoice.ts';
import { getOverlayButton, getPrintFrameDocument, getPrintOverlay, installDom, uninstallDom } from './helpers/dom.mjs';

function createInvoice(overrides = {}) {
  return {
    id: 'invoice-1',
    invoiceNumber: 'INV-<1>&"',
    saleDate: '2026-06-25',
    customerName: 'Lena & Co <VIP>',
    paymentMethod: 'cash',
    lines: [
      { id: 'line-1', dressCode: 'DR-<01>', dressName: 'فستان "لامع" & فاخر', amount: 42.5 },
    ],
    totalAmount: 42.5,
    ...overrides,
  };
}

test('printSaleInvoice writes escaped invoice markup and triggers the print flow', () => {
  installDom();
  try {
    printSaleInvoice(createInvoice());

    const frameDocument = getPrintFrameDocument();
    assert.ok(frameDocument, 'the invoice must render inside the app');
    assert.equal(frameDocument.openCount, 1);
    assert.equal(frameDocument.closeCount, 1);
    assert.equal(frameDocument.printCount, 1);

    const markup = frameDocument.written.join('');
    assert.match(markup, /<html dir="rtl" lang="ar">/);
    assert.match(markup, /INV-&lt;1&gt;&amp;&quot;/);
    assert.match(markup, /Lena &amp; Co &lt;VIP&gt;/);
    assert.match(markup, /DR-&lt;01&gt;/);
    assert.match(markup, /فستان &quot;لامع&quot; &amp; فاخر/);
    assert.match(markup, /٤٢٫٥٠٠/);
    assert.match(markup, /ر\.ع\./);
    assert.doesNotMatch(markup, /Lena & Co <VIP>/);
  } finally {
    uninstallDom();
  }
});

test('the invoice view can always be dismissed back into the app', () => {
  installDom();
  try {
    printSaleInvoice(createInvoice());
    assert.ok(getPrintOverlay(), 'the invoice must not open a detached window');

    getOverlayButton('إغلاق').dispatch('click');
    assert.equal(getPrintOverlay(), null, 'closing returns the operator to the app');
  } finally {
    uninstallDom();
  }
});

test('printSaleInvoice reports a print failure as an invoice-specific error', () => {
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
      () => printSaleInvoice(createInvoice()),
      (error) => {
        assert.equal(error instanceof PrintSaleInvoiceError, true);
        assert.equal(error.name, 'PrintSaleInvoiceError');
        assert.match(error.message, /تعذر تجهيز المستند للطباعة/);
        return true;
      },
    );
    globalThis.document.createElement = originalCreate;
  } finally {
    uninstallDom();
  }
});
