import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BrowserLocalStorageAdapter,
  getBrowserLocalStorage,
} from '../src/platform/storage/index.ts';
import { readCollection, writeCollection } from '../src/services/localDatabase.ts';

class FakeStorage {
  #values = new Map();

  get length() {
    return this.#values.size;
  }

  getItem(key) {
    return this.#values.get(key) ?? null;
  }

  setItem(key, value) {
    this.#values.set(key, String(value));
  }

  removeItem(key) {
    this.#values.delete(key);
  }

  key(index) {
    return [...this.#values.keys()][index] ?? null;
  }
}

function withWindow(value, callback) {
  const previousWindow = globalThis.window;
  globalThis.window = value;

  try {
    return callback();
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}

test('browser storage factory returns null when window is unavailable', () => {
  const previousWindow = globalThis.window;
  delete globalThis.window;

  try {
    assert.equal(getBrowserLocalStorage(), null);
  } finally {
    if (previousWindow !== undefined) globalThis.window = previousWindow;
  }
});

test('browser adapter delegates the Storage contract with bound methods', () => {
  const storage = new FakeStorage();
  const adapter = new BrowserLocalStorageAdapter(storage);

  adapter.setItem('alpha', 'one');
  adapter.setItem('beta', 'two');

  assert.equal(adapter.length, 2);
  assert.equal(adapter.getItem('alpha'), 'one');
  assert.equal(adapter.key(1), 'beta');

  adapter.removeItem('alpha');
  assert.equal(adapter.getItem('alpha'), null);
});

test('local database keeps the exact existing keys and JSON shape through the platform adapter', () => {
  const storage = new FakeStorage();

  withWindow({ localStorage: storage }, () => {
    writeCollection('customers', [{ id: 'customer-1', name: 'سارة' }]);

    assert.deepEqual(readCollection('customers'), [{ id: 'customer-1', name: 'سارة' }]);
    assert.equal(storage.key(0), 'dress-roomshow:metadata');
    assert.equal(storage.key(1), 'dress-roomshow:customers');
    assert.deepEqual(JSON.parse(storage.getItem('dress-roomshow:customers')), [
      { id: 'customer-1', name: 'سارة' },
    ]);

    const metadata = JSON.parse(storage.getItem('dress-roomshow:metadata'));
    assert.equal(metadata.applicationId, 'dress-roomshow');
    assert.equal(metadata.schemaVersion, 3);
    assert.equal(typeof metadata.updatedAt, 'string');
  });
});
