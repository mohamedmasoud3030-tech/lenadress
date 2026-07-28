import test from 'node:test';
import assert from 'node:assert/strict';
import { printSaleInvoice, PrintSaleInvoiceError } from '../src/features/dresses/printSaleInvoice.ts';

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

test('printSaleInvoice writes escaped invoice markup and triggers print flow', () => {
  const calls = [];
  const popup = {
    document: {
      markup: '',
      write(markup) {
        this.markup += markup;
        calls.push('write');
      },
      close() {
        calls.push('close');
      },
    },
    focus() {
      calls.push('focus');
    },
    print() {
      calls.push('print');
    },
  };

  globalThis.window = {
    open: (...args) => {
      calls.push(['open', ...args]);
      return popup;
    },
  };

  try {
    printSaleInvoice(createInvoice());

    assert.deepEqual(calls, [
      ['open', '', '_blank', 'width=880,height=760'],
      'write',
      'close',
      'focus',
      'print',
    ]);
    assert.match(popup.document.markup, /<html dir="rtl" lang="ar">/);
    assert.match(popup.document.markup, /INV-&lt;1&gt;&amp;&quot;/);
    assert.match(popup.document.markup, /Lena &amp; Co &lt;VIP&gt;/);
    assert.match(popup.document.markup, /DR-&lt;01&gt;/);
    assert.match(popup.document.markup, /فستان &quot;لامع&quot; &amp; فاخر/);
    assert.match(popup.document.markup, /٤٢٫٥٠٠/);
    assert.match(popup.document.markup, /ر\.ع\./);
    assert.doesNotMatch(popup.document.markup, /Lena & Co <VIP>/);
  } finally {
    delete globalThis.window;
  }
});

test('printSaleInvoice reports blocked popup windows as a print-specific error', () => {
  globalThis.window = {
    open: () => null,
  };

  try {
    assert.throws(
      () => printSaleInvoice(createInvoice()),
      (error) => {
        assert.equal(error instanceof PrintSaleInvoiceError, true);
        assert.equal(error.name, 'PrintSaleInvoiceError');
        assert.match(error.message, /تعذر فتح نافذة الطباعة/);
        return true;
      },
    );
  } finally {
    delete globalThis.window;
  }
});
