import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLandingInventory } from '../src/pages/landing/landingDress.repository.ts';

function makeDress(id) {
  return {
    id,
    code: `D-${id}`,
    name: `فستان ${id}`,
    description: '',
    itemType: 'dress',
    category: 'سهرة',
    color: 'أسود',
    size: 'M',
    purchasePrice: 0,
    rentalPrice: 25,
    salePrice: 0,
    depositAmount: 10,
    status: 'available',
    isForRent: true,
    isForSale: false,
    images: [],
    barcode: `D-${id}`,
    timesRented: 0,
  };
}

test('uses local inventory directly when Supabase is not configured', async () => {
  const localDresses = [makeDress('local')];
  let remoteCalls = 0;

  const result = await loadLandingInventory({
    isSupabaseConfigured: () => false,
    fetchAvailableDressesFromSupabase: async () => {
      remoteCalls += 1;
      return [makeDress('remote')];
    },
    getAvailableDressesFromLocalStorage: () => localDresses,
  });

  assert.deepEqual(result, { dresses: localDresses, source: 'local' });
  assert.equal(remoteCalls, 0);
});

test('returns Supabase inventory when the configured request succeeds', async () => {
  const remoteDresses = [makeDress('remote')];
  let localCalls = 0;

  const result = await loadLandingInventory({
    isSupabaseConfigured: () => true,
    fetchAvailableDressesFromSupabase: async () => remoteDresses,
    getAvailableDressesFromLocalStorage: () => {
      localCalls += 1;
      return [makeDress('local')];
    },
  });

  assert.deepEqual(result, { dresses: remoteDresses, source: 'supabase' });
  assert.equal(localCalls, 0);
});

test('falls back to local inventory and preserves an Error message when Supabase fails', async () => {
  const localDresses = [makeDress('fallback')];

  const result = await loadLandingInventory({
    isSupabaseConfigured: () => true,
    fetchAvailableDressesFromSupabase: async () => {
      throw new Error('تعذر تحميل المعروض الحالي من الخادم.');
    },
    getAvailableDressesFromLocalStorage: () => localDresses,
  });

  assert.deepEqual(result, {
    dresses: localDresses,
    source: 'local',
    warning: 'تعذر تحميل المعروض الحالي من الخادم.',
  });
});

test('uses the generic warning when Supabase rejects with a non-Error value', async () => {
  const localDresses = [makeDress('fallback')];

  const result = await loadLandingInventory({
    isSupabaseConfigured: () => true,
    fetchAvailableDressesFromSupabase: () => Promise.reject({ code: 'offline' }),
    getAvailableDressesFromLocalStorage: () => localDresses,
  });

  assert.deepEqual(result, {
    dresses: localDresses,
    source: 'local',
    warning: 'تعذر الاتصال بالخادم، تم عرض البيانات المحلية إن وُجدت.',
  });
});

test('treats an empty Supabase response as a successful shared inventory result', async () => {
  let localCalls = 0;

  const result = await loadLandingInventory({
    isSupabaseConfigured: () => true,
    fetchAvailableDressesFromSupabase: async () => [],
    getAvailableDressesFromLocalStorage: () => {
      localCalls += 1;
      return [makeDress('local')];
    },
  });

  assert.deepEqual(result, { dresses: [], source: 'supabase' });
  assert.equal(localCalls, 0);
});
