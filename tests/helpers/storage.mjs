/**
 * Shared in-memory storage double for the Node test runner.
 *
 * Every suite used to inline the same localStorage stub; keeping one copy makes
 * the storage contract identical across tests and removes the risk of two
 * slightly different doubles hiding a real defect.
 */
export function installStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
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

export function uninstallStorage() {
  delete globalThis.window;
}

/** ISO date `days` ahead of today, in local time. */
export function futureDate(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

export function todayISO() {
  return futureDate(0);
}

/** A local `datetime-local` value for "now", accepted by the operations layer. */
export function nowDateTimeLocal() {
  const date = new Date();
  const offset = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offset.toISOString().slice(0, 16);
}
