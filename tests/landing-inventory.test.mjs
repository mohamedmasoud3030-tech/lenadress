import test from 'node:test';
import assert from 'node:assert/strict';
import { URL } from 'node:url';
import {
  fetchAvailableDressesFromSupabase,
  loadLandingInventory,
} from '../src/pages/landing/landingDress.repository.ts';

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

test('fails closed instead of showing stale browser inventory when Supabase fails', async () => {
  const localDresses = [makeDress('fallback')];

  await assert.rejects(
    loadLandingInventory({
      isSupabaseConfigured: () => true,
      fetchAvailableDressesFromSupabase: async () => {
        throw new Error('تعذر تحميل المعروض الحالي من الخادم.');
      },
      getAvailableDressesFromLocalStorage: () => localDresses,
    }),
    /تعذر تحميل المعروض الحالي من الخادم/,
  );
});

test('normalizes non-Error Supabase failures without exposing stale data', async () => {
  const localDresses = [makeDress('fallback')];

  await assert.rejects(
    loadLandingInventory({
      isSupabaseConfigured: () => true,
      fetchAvailableDressesFromSupabase: () => Promise.reject({ code: 'offline' }),
      getAvailableDressesFromLocalStorage: () => localDresses,
    }),
    /تعذر تحميل المعروض الحالي من الخادم/,
  );
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

test('public catalogue uses a direct anonymous REST request and maps the narrow projection', async () => {
  let request;
  const dresses = await fetchAvailableDressesFromSupabase({
    getConfig: () => ({ url: 'https://project.supabase.co', publishableKey: 'public-key' }),
    fetcher: async (input, init) => {
      request = { url: String(input), headers: init.headers };
      return {
        ok: true,
        status: 200,
        json: async () => [{
        id: 'remote',
        code: 'D-remote',
        name: 'فستان مباشر',
        description: null,
        category: 'سهرة',
        color: 'أسود',
        size: 'M',
        item_type: 'dress',
        rental_price: 25,
        sale_price: null,
        security_deposit_amount: 10,
        status: 'available',
        is_for_rent: true,
        is_for_sale: false,
          images: [],
        }],
      };
    },
  });

  const url = new URL(request.url);
  assert.equal(url.pathname, '/rest/v1/catalogue_items');
  assert.equal(url.searchParams.get('status'), 'eq.available');
  assert.equal(url.searchParams.get('order'), 'updated_at.desc');
  assert.match(url.searchParams.get('select'), /security_deposit_amount/);
  assert.equal(request.headers.apikey, 'public-key');
  assert.equal(request.headers.Authorization, 'Bearer public-key');
  assert.equal(dresses.length, 1);
  assert.equal(dresses[0].name, 'فستان مباشر');
  assert.equal(dresses[0].status, 'available');
});

test('public catalogue fails closed when REST returns an error status', async () => {
  await assert.rejects(
    fetchAvailableDressesFromSupabase({
      getConfig: () => ({ url: 'https://project.supabase.co', publishableKey: 'public-key' }),
      fetcher: async () => ({ ok: false, status: 403 }),
    }),
    /تعذر تحميل المعروض الحالي من الخادم/,
  );
});
