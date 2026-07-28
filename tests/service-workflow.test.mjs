import test from 'node:test';
import assert from 'node:assert/strict';
import { setCommandFailurePoint } from '../src/engines/workflows/index.ts';
import {
  openServiceTaskCommand,
  startServiceTaskCommand,
  completeServiceTaskCommand,
  cancelServiceTaskCommand,
} from '../src/features/workflows/serviceCommands.ts';
import { getServiceConflictBlockers, getServiceTasks, summarizeServiceQueue } from '../src/features/service/service.service.ts';
import { createReservationCommand } from '../src/features/workflows/reservationCommands.ts';
import { addDress, getDresses } from '../src/features/dresses/dress.service.ts';
import { addCustomer } from '../src/features/customers/customer.service.ts';
import { getExpenses } from '../src/features/expenses/expense.service.ts';
import { getItemFinance } from '../src/features/finance/finance.service.ts';

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

const today = new Date().toISOString().slice(0, 10);

function futureDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

const itemInput = {
  name: 'فستان خدمة',
  description: '',
  itemType: 'dress',
  category: 'سهرة',
  color: 'أبيض',
  size: 'M',
  purchasePrice: 100,
  rentalPrice: 40,
  salePrice: 0,
  depositAmount: 50,
  status: 'inspection',
  isForRent: true,
  isForSale: false,
  images: [],
  barcode: '',
};

function itemStatus(code) {
  return getDresses().find((item) => item.code === code).status;
}

test('opening a service task moves the item into the matching service state', () => {
  installStorage();
  try {
    const dress = addDress(itemInput);
    const task = openServiceTaskCommand({ dressCode: dress.code, type: 'laundry', startDate: today, idempotencyKey: 'srv-1' });

    assert.equal(task.status, 'open');
    assert.equal(task.inventoryItemId, dress.id, 'the task keeps a stable item reference');
    assert.equal(itemStatus(dress.code), 'laundry');
  } finally {
    cleanup();
  }
});

test('an item cannot have two open service tasks at once', () => {
  installStorage();
  try {
    const dress = addDress(itemInput);
    openServiceTaskCommand({ dressCode: dress.code, type: 'laundry', startDate: today, idempotencyKey: 'srv-a' });
    assert.throws(
      () => openServiceTaskCommand({ dressCode: dress.code, type: 'maintenance', startDate: today, idempotencyKey: 'srv-b' }),
      /مفتوح/,
    );
    assert.equal(getServiceTasks().length, 1);
  } finally {
    cleanup();
  }
});

test('service work is blocked when it collides with a confirmed booking plus the preparation buffer', () => {
  installStorage();
  try {
    const customer = addCustomer({ name: 'مريم', phone: '90000001', status: 'normal' });
    const dress = addDress({ ...itemInput, status: 'available' });
    createReservationCommand({
      customerId: customer.id,
      dressId: dress.id,
      pickupDate: futureDate(3),
      returnDate: futureDate(5),
      depositAmount: 50,
      idempotencyKey: 'rsv-conflict',
    });

    const blockers = getServiceConflictBlockers(dress.code, futureDate(3), futureDate(4));
    assert.ok(blockers.length > 0);
    assert.throws(
      () => openServiceTaskCommand({
        dressCode: dress.code,
        type: 'maintenance',
        startDate: futureDate(3),
        expectedCompletionDate: futureDate(4),
        idempotencyKey: 'srv-conflict',
      }),
      /يتعارض/,
    );

    // Far enough from the booking, the same work is allowed.
    const ok = openServiceTaskCommand({
      dressCode: dress.code,
      type: 'maintenance',
      startDate: futureDate(20),
      expectedCompletionDate: futureDate(21),
      idempotencyKey: 'srv-ok',
    });
    assert.equal(ok.status, 'open');
  } finally {
    cleanup();
  }
});

test('a rented or sold item cannot enter the service queue', () => {
  installStorage();
  try {
    const rented = addDress({ ...itemInput, status: 'rented' });
    const sold = addDress({ ...itemInput, name: 'مباع', status: 'sold' });
    assert.throws(() => openServiceTaskCommand({ dressCode: rented.code, type: 'laundry', startDate: today }), /مؤجر/);
    assert.throws(() => openServiceTaskCommand({ dressCode: sold.code, type: 'laundry', startDate: today }), /مباع/);
  } finally {
    cleanup();
  }
});

test('completing a task requires an explicit resulting state and posts the cost as an item expense', () => {
  installStorage();
  try {
    const dress = addDress(itemInput);
    const task = openServiceTaskCommand({ dressCode: dress.code, type: 'tailoring', startDate: today, idempotencyKey: 'srv-c' });
    startServiceTaskCommand(task.id);

    const completed = completeServiceTaskCommand({
      taskId: task.id,
      completedDate: today,
      cost: 12,
      resultingItemStatus: 'available',
      idempotencyKey: 'srv-c-done',
    });

    assert.equal(completed.status, 'completed');
    assert.equal(completed.resultingItemStatus, 'available');
    assert.equal(itemStatus(dress.code), 'available');

    // The cost became a real expense tied to the item and its profitability.
    assert.equal(getExpenses().length, 1);
    assert.equal(getExpenses()[0].relatedDressCode, dress.code);
    assert.equal(completed.relatedExpenseNumber, getExpenses()[0].expenseNumber);
    assert.equal(getItemFinance(dress.code).expenses, 12);
  } finally {
    cleanup();
  }
});

test('an item never becomes available without a completion decision', () => {
  installStorage();
  try {
    const dress = addDress(itemInput);
    const task = openServiceTaskCommand({ dressCode: dress.code, type: 'inspection', startDate: today, idempotencyKey: 'srv-d' });
    startServiceTaskCommand(task.id);
    assert.equal(itemStatus(dress.code), 'inspection');

    // A completion that decides more work keeps the item out of circulation.
    completeServiceTaskCommand({
      taskId: task.id,
      completedDate: today,
      cost: 0,
      resultingItemStatus: 'maintenance',
      idempotencyKey: 'srv-d-done',
    });
    assert.equal(itemStatus(dress.code), 'maintenance');
  } finally {
    cleanup();
  }
});

test('a failed completion posts no expense and leaves the task open', () => {
  installStorage();
  try {
    const dress = addDress(itemInput);
    const task = openServiceTaskCommand({ dressCode: dress.code, type: 'laundry', startDate: today, idempotencyKey: 'srv-e' });

    setCommandFailurePoint('service.complete:after-write');
    assert.throws(
      () => completeServiceTaskCommand({
        taskId: task.id,
        completedDate: today,
        cost: 20,
        resultingItemStatus: 'available',
        idempotencyKey: 'srv-e-done',
      }),
      /forced failure/,
    );

    assert.equal(getExpenses().length, 0, 'no cost may survive a failed completion');
    assert.equal(getServiceTasks()[0].status, 'open');
    assert.equal(itemStatus(dress.code), 'laundry');
  } finally {
    cleanup();
  }
});

test('cancelling a task requires a reason and is recorded', () => {
  installStorage();
  try {
    const dress = addDress(itemInput);
    const task = openServiceTaskCommand({ dressCode: dress.code, type: 'repair', startDate: today, idempotencyKey: 'srv-f' });
    assert.throws(() => cancelServiceTaskCommand(task.id, '   '), /سبب/);

    const cancelled = cancelServiceTaskCommand(task.id, 'لا حاجة للإصلاح');
    assert.equal(cancelled.status, 'cancelled');
    assert.equal(summarizeServiceQueue(getServiceTasks()).open, 0);
  } finally {
    cleanup();
  }
});

test('the queue summary reports open, in-progress, completed and overdue work', () => {
  installStorage();
  try {
    const first = addDress(itemInput);
    const second = addDress({ ...itemInput, name: 'قطعة ثانية' });

    openServiceTaskCommand({
      dressCode: first.code,
      type: 'laundry',
      startDate: '2020-01-01',
      expectedCompletionDate: '2020-01-02',
      idempotencyKey: 'srv-g',
    });
    const running = openServiceTaskCommand({ dressCode: second.code, type: 'maintenance', startDate: today, idempotencyKey: 'srv-h' });
    startServiceTaskCommand(running.id);

    const summary = summarizeServiceQueue(getServiceTasks());
    assert.equal(summary.open, 1);
    assert.equal(summary.inProgress, 1);
    assert.equal(summary.overdue, 1);
  } finally {
    cleanup();
  }
});
