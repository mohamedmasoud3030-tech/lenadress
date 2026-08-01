import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';

let importCounter = 0;

class MemoryStorage {
  #entries = new Map();

  get length() {
    return this.#entries.size;
  }

  getItem(key) {
    return this.#entries.has(key) ? this.#entries.get(key) : null;
  }

  key(index) {
    return Array.from(this.#entries.keys())[index] ?? null;
  }

  removeItem(key) {
    this.#entries.delete(key);
  }

  setItem(key, value) {
    this.#entries.set(key, String(value));
  }
}

function createDesktopHarness(invoke) {
  const listeners = new Map();
  const intervals = [];
  const storage = new MemoryStorage();
  const reloaded = { value: false };

  globalThis.window = {
    localStorage: storage,
    location: {
      reload: () => {
        reloaded.value = true;
      },
    },
    addEventListener: (eventName, listener) => {
      const eventListeners = listeners.get(eventName) ?? new Set();
      eventListeners.add(listener);
      listeners.set(eventName, eventListeners);
    },
    removeEventListener: (eventName, listener) => {
      listeners.get(eventName)?.delete(listener);
    },
    dispatchEvent: (event) => {
      listeners.get(event.type)?.forEach((listener) => listener(event));
      return true;
    },
    setInterval: (callback, delay) => {
      intervals.push({ callback, delay });
      return intervals.length;
    },
  };
  globalThis.__dressRoomshowDesktopInvokeForTests = invoke;

  return { intervals, reloaded, storage };
}

function cleanupDesktopHarness() {
  delete globalThis.window;
  delete globalThis.__dressRoomshowDesktopInvokeForTests;
}

async function importDesktopDatabase() {
  importCounter += 1;
  return import(`../src/platform/desktop/DesktopDatabase.ts?test=${importCounter}`);
}

async function waitForAsyncBootstrap() {
  await wait(0);
}

test('desktop database publishes typed desktop sync status events after bootstrap', async () => {
  const events = [];
  const calls = [];
  const harness = createDesktopHarness(async (command, payload) => {
    calls.push({ command, payload });
    if (command === 'load_desktop_snapshot') return null;
    return undefined;
  });

  try {
    harness.storage.setItem('dress-roomshow:customers', '[{"id":"customer-1"}]');
    harness.storage.setItem('other-app:key', 'ignored');
    globalThis.window.addEventListener('lena:persistence-status', (event) => {
      events.push(event.detail);
    });

    const desktopDatabase = await importDesktopDatabase();
    await waitForAsyncBootstrap();

    assert.equal(desktopDatabase.DESKTOP_SYNC_STATUS_EVENT, 'lena:persistence-status');
    assert.equal(events.length, 1);
    assert.equal(events[0].state, 'synced');
    assert.equal(events[0].message, 'مزامنة سطح المكتب تعمل.');
    assert.match(events[0].updatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(calls, [
      { command: 'load_desktop_snapshot', payload: undefined },
      {
        command: 'save_desktop_snapshot',
        payload: { entries: { 'dress-roomshow:customers': '[{"id":"customer-1"}]' } },
      },
    ]);
    assert.equal(harness.intervals.length, 1);
    assert.equal(harness.intervals[0].delay, 500);
    assert.deepEqual(desktopDatabase.getDesktopSyncStatus(), events[0]);
  } finally {
    cleanupDesktopHarness();
  }
});

test('desktop database falls back to browser storage when Tauri bootstrap fails', async () => {
  const events = [];
  const harness = createDesktopHarness(async () => {
    throw new Error('tauri unavailable');
  });

  try {
    globalThis.window.addEventListener('lena:persistence-status', (event) => {
      events.push(event.detail);
    });

    const desktopDatabase = await importDesktopDatabase();
    await waitForAsyncBootstrap();

    assert.equal(events.length, 1);
    assert.equal(events[0].state, 'local-only');
    assert.equal(events[0].message, 'يعمل التطبيق بتخزين المتصفح المحلي فقط.');
    assert.match(events[0].updatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(harness.intervals.length, 0);
    assert.deepEqual(desktopDatabase.getDesktopSyncStatus(), events[0]);
  } finally {
    cleanupDesktopHarness();
  }
});

test('desktop database emits an error status when save_desktop_snapshot fails after local changes', async () => {
  const events = [];
  const calls = [];
  const harness = createDesktopHarness(async (command, payload) => {
    calls.push({ command, payload });
    if (command === 'load_desktop_snapshot') return {};
    if (command === 'save_desktop_snapshot') throw new Error('disk full');
    return undefined;
  });

  try {
    globalThis.window.addEventListener('lena:persistence-status', (event) => {
      events.push(event.detail);
    });

    const desktopDatabase = await importDesktopDatabase();
    await waitForAsyncBootstrap();
    harness.storage.setItem('dress-roomshow:reservations', '[{"id":"reservation-1"}]');
    harness.intervals[0].callback();
    await waitForAsyncBootstrap();

    assert.equal(events.length, 2);
    assert.equal(events[0].state, 'synced');
    assert.equal(events[1].state, 'error');
    assert.equal(events[1].attempts, 1);
    assert.equal(
      events[1].message,
      'تعذر حفظ نسخة سطح المكتب. سيستمر التطبيق محلياً وسنحاول المزامنة مرة أخرى.',
    );
    assert.match(events[1].updatedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(calls, [
      { command: 'load_desktop_snapshot', payload: undefined },
      {
        command: 'save_desktop_snapshot',
        payload: { entries: { 'dress-roomshow:reservations': '[{"id":"reservation-1"}]' } },
      },
    ]);
    assert.deepEqual(desktopDatabase.getDesktopSyncStatus(), events[1]);
  } finally {
    cleanupDesktopHarness();
  }
});

test('desktop database returns to synced status after a failed mirror save succeeds', async () => {
  const events = [];
  const calls = [];
  let shouldFailNextSave = true;
  const harness = createDesktopHarness(async (command, payload) => {
    calls.push({ command, payload });
    if (command === 'load_desktop_snapshot') return {};
    if (command === 'save_desktop_snapshot' && shouldFailNextSave) {
      shouldFailNextSave = false;
      throw new Error('disk full');
    }
    return undefined;
  });

  try {
    globalThis.window.addEventListener('lena:persistence-status', (event) => {
      events.push(event.detail);
    });

    const desktopDatabase = await importDesktopDatabase();
    await waitForAsyncBootstrap();
    harness.storage.setItem('dress-roomshow:reservations', '[{"id":"reservation-1"}]');
    harness.intervals[0].callback();
    await waitForAsyncBootstrap();
    harness.intervals[0].callback();
    await waitForAsyncBootstrap();
    harness.storage.setItem('dress-roomshow:reservations', '[{"id":"reservation-2"}]');
    harness.intervals[0].callback();
    await waitForAsyncBootstrap();

    assert.equal(events.length, 4);
    assert.equal(events[0].state, 'synced');
    assert.equal(events[1].state, 'error');
    assert.equal(events[1].attempts, 1);
    assert.equal(events[2].state, 'synced');
    assert.equal(events[2].message, 'تمت مزامنة نسخة سطح المكتب.');
    assert.equal(events[3].state, 'synced');
    assert.equal(events[3].message, 'تمت مزامنة نسخة سطح المكتب.');
    assert.deepEqual(calls, [
      { command: 'load_desktop_snapshot', payload: undefined },
      {
        command: 'save_desktop_snapshot',
        payload: { entries: { 'dress-roomshow:reservations': '[{"id":"reservation-1"}]' } },
      },
      {
        command: 'save_desktop_snapshot',
        payload: { entries: { 'dress-roomshow:reservations': '[{"id":"reservation-1"}]' } },
      },
      {
        command: 'save_desktop_snapshot',
        payload: { entries: { 'dress-roomshow:reservations': '[{"id":"reservation-2"}]' } },
      },
    ]);
    assert.deepEqual(desktopDatabase.getDesktopSyncStatus(), events[3]);
  } finally {
    cleanupDesktopHarness();
  }
});
