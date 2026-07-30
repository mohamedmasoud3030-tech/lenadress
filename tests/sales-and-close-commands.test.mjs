import test from 'node:test';
import assert from 'node:assert/strict';
import { setCommandFailurePoint, DuplicateCommandError } from '../src/engines/workflows/index.ts';
import { quickSaleCommand, createSaleInvoiceCommand, recordSaleReturnCommand } from '../src/features/workflows/salesCommands.ts';
import { postExpenseCommand } from '../src/features/workflows/expenseCommands.ts';
import { closeDayCommand } from '../src/features/workflows/dailyCloseCommands.ts';
import { addDress, getDresses } from '../src/features/dresses/dress.service.ts';
import { getSaleInvoices, getSaleReturns } from '../src/features/dresses/salesLedger.service.ts';
import { getSales } from '../src/features/dresses/sale.service.ts';
import { getExpenses } from '../src/features/expenses/expense.service.ts';
import { readCollection, writeCollection, getCollectionKey } from '../src/engines/persistence/index.ts';
import { getTodayISO } from '../src/shared/utils/date.ts';

function installStorage() {
  const store = new Map();
  globalThis.window = {
    localStorage: {
      get length() {
        return store.size;
      },
      getItem(key) {
        return store.has(key) ? store.get(key) : null;
      },
      setItem(key, value) {
        store.set(key, String(value));
      },
      removeItem(key) {
        store.delete(key);
      },
      key(index) {
        return Array.from(store.keys())[index] ?? null;
      },
      clear() {
        store.clear();
      },
    },
  };
  return store;
}

function cleanup() {
  setCommandFailurePoint(null);
  delete globalThis.window;
}

const today = getTodayISO();

const dressInput = {
  name: 'فستان للبيع',
  description: '',
  itemType: 'dress',
  category: 'سهرة',
  color: 'ذهبي',
  size: 'L',
  purchasePrice: 80,
  rentalPrice: 30,
  salePrice: 200,
  depositAmount: 40,
  status: 'available',
  isForRent: false,
  isForSale: true,
  images: [],
  barcode: '',
};

test('a quick sale produces a canonical one-line invoice, not a separate sale path', () => {
  installStorage();
  try {
    const dress = addDress(dressInput);
    const invoice = quickSaleCommand({
      saleDate: today,
      customerName: 'مريم',
      paymentMethod: 'cash',
      dressCode: dress.code,
      amount: 200,
      idempotencyKey: 'quick-1',
    });

    assert.equal(getSaleInvoices().length, 1);
    assert.equal(invoice.lines.length, 1);
    assert.equal(invoice.totalAmount, 200);
    // The sale ledger row is linked back to the invoice so both views agree.
    assert.equal(getSales()[0].invoiceNumber, invoice.invoiceNumber);
    assert.equal(getDresses().find((item) => item.code === dress.code).status, 'sold');
  } finally {
    cleanup();
  }
});

test('a duplicate sale submit does not sell the item twice', () => {
  installStorage();
  try {
    const dress = addDress(dressInput);
    const input = {
      saleDate: today,
      customerName: 'مريم',
      paymentMethod: 'cash',
      dressCode: dress.code,
      amount: 200,
      idempotencyKey: 'quick-dup',
    };
    quickSaleCommand(input);
    assert.throws(() => quickSaleCommand(input), DuplicateCommandError);
    assert.equal(getSaleInvoices().length, 1);
    assert.equal(getSales().length, 1);
  } finally {
    cleanup();
  }
});

test('forced failure during a sale leaves no invoice, no ledger row and no sold item', () => {
  installStorage();
  try {
    const dress = addDress(dressInput);
    setCommandFailurePoint('sale.create-invoice:after-write');
    assert.throws(
      () => createSaleInvoiceCommand({
        saleDate: today,
        customerName: 'مريم',
        paymentMethod: 'cash',
        lines: [{ dressCode: dress.code, amount: 200 }],
        idempotencyKey: 'sale-fail',
      }),
      /forced failure/,
    );

    assert.equal(getSaleInvoices().length, 0);
    assert.equal(getSales().length, 0);
    assert.equal(getDresses().find((item) => item.code === dress.code).status, 'available');
  } finally {
    cleanup();
  }
});

test('a sale return is tied to the invoice line, cannot repeat, and routes the item to inspection', () => {
  installStorage();
  try {
    const dress = addDress(dressInput);
    const invoice = quickSaleCommand({
      saleDate: today,
      customerName: 'مريم',
      paymentMethod: 'cash',
      dressCode: dress.code,
      amount: 200,
      idempotencyKey: 'sale-ret',
    });

    const saleReturn = recordSaleReturnCommand({
      invoiceNumber: invoice.invoiceNumber,
      dressCode: dress.code,
      returnDate: today,
      idempotencyKey: 'ret-1',
    });
    assert.equal(saleReturn.invoiceNumber, invoice.invoiceNumber);
    assert.equal(saleReturn.amount, 200);
    assert.equal(getDresses().find((item) => item.code === dress.code).status, 'inspection');

    // The same line cannot be returned twice, even with a fresh key.
    assert.throws(
      () => recordSaleReturnCommand({
        invoiceNumber: invoice.invoiceNumber,
        dressCode: dress.code,
        returnDate: today,
        idempotencyKey: 'ret-2',
      }),
      /بالفعل/,
    );
    assert.equal(getSaleReturns().length, 1);

    // The original invoice history is untouched.
    assert.equal(getSaleInvoices()[0].totalAmount, 200);
    assert.equal(getSaleInvoices()[0].lines.length, 1);
  } finally {
    cleanup();
  }
});

test('legacy sales-returns records are folded into the canonical collection exactly once', () => {
  const store = installStorage();
  try {
    store.set(
      getCollectionKey('sales-returns'),
      JSON.stringify([{ id: 'legacy-1', returnNumber: 'RET-L1', invoiceNumber: 'INV-L1', dressCode: 'D-001', amount: 50 }]),
    );

    assert.equal(getSaleReturns().length, 1);
    assert.equal(getSaleReturns()[0].id, 'legacy-1');
    // Reading again must not duplicate the migrated record.
    assert.equal(getSaleReturns().length, 1);
    assert.equal(readCollection('sales-returns', []).length, 0);
  } finally {
    cleanup();
  }
});

test('expenses post atomically and roll back exactly on failure', () => {
  installStorage();
  try {
    postExpenseCommand({
      expenseDate: today,
      title: 'غسيل',
      category: 'laundry',
      amount: 5,
      paymentMethod: 'cash',
      idempotencyKey: 'exp-1',
    });
    assert.equal(getExpenses().length, 1);

    setCommandFailurePoint('expense.post:after-write');
    assert.throws(
      () => postExpenseCommand({
        expenseDate: today,
        title: 'صيانة',
        category: 'maintenance',
        amount: 12,
        paymentMethod: 'cash',
        idempotencyKey: 'exp-fail',
      }),
      /forced failure/,
    );
    assert.equal(getExpenses().length, 1, 'the failed expense must leave no trace');
  } finally {
    cleanup();
  }
});

test('after the daily close, money-changing commands for that date are rejected', () => {
  installStorage();
  try {
    const dress = addDress(dressInput);
    closeDayCommand({ businessDate: today, openingCash: 0, actualCash: 0, idempotencyKey: 'close-1' });

    assert.throws(
      () => postExpenseCommand({
        expenseDate: today,
        title: 'مصروف بعد الإقفال',
        category: 'other',
        amount: 3,
        paymentMethod: 'cash',
        idempotencyKey: 'exp-after-close',
      }),
      /إقفال/,
    );

    assert.throws(
      () => quickSaleCommand({
        saleDate: today,
        customerName: 'مريم',
        paymentMethod: 'cash',
        dressCode: dress.code,
        amount: 200,
        idempotencyKey: 'sale-after-close',
      }),
      /إقفال/,
    );

    assert.equal(getExpenses().length, 0);
    assert.equal(getSaleInvoices().length, 0);
  } finally {
    cleanup();
  }
});

test('a failed close leaves the day open', () => {
  installStorage();
  try {
    writeCollection('daily-closings', []);
    setCommandFailurePoint('daily-close.close:after-write');
    assert.throws(
      () => closeDayCommand({ businessDate: today, openingCash: 0, actualCash: 0, idempotencyKey: 'close-fail' }),
      /forced failure/,
    );
    assert.equal(readCollection('daily-closings', []).length, 0);

    // The day is still open, so an expense posts normally.
    postExpenseCommand({
      expenseDate: today,
      title: 'مصروف بعد فشل الإقفال',
      category: 'other',
      amount: 4,
      paymentMethod: 'cash',
      idempotencyKey: 'exp-after-failed-close',
    });
    assert.equal(getExpenses().length, 1);
  } finally {
    cleanup();
  }
});
