import test from 'node:test';
import assert from 'node:assert/strict';
import { installStorage, uninstallStorage } from './helpers/storage.mjs';
import {
  createSearchMatcher,
  matchesSearchQuery,
  normalizeDigits,
  normalizePhoneForSearch,
  normalizeSearchText,
} from '../src/shared/utils/search.ts';
import { addCustomer, filterCustomers, getCustomers } from '../src/features/customers/customer.service.ts';
import { addDress, filterDresses } from '../src/features/dresses/dress.service.ts';

function setup() {
  installStorage();
}

test('normalizeSearchText folds every alef seat onto the bare alef', () => {
  const forms = ['أحمد', 'إحمد', 'آحمد', 'احمد'];
  const normalized = new Set(forms.map(normalizeSearchText));
  assert.equal(normalized.size, 1, 'all hamza seats must collapse to one comparable form');
});

test('normalizeSearchText treats ta marbuta and ha as the same letter', () => {
  assert.equal(normalizeSearchText('فاطمة'), normalizeSearchText('فاطمه'));
  assert.equal(normalizeSearchText('عائشة'), normalizeSearchText('عائشه'));
});

test('normalizeSearchText treats alef maqsura and ya as the same letter', () => {
  assert.equal(normalizeSearchText('ليلى'), normalizeSearchText('ليلي'));
  assert.equal(normalizeSearchText('مصطفى'), normalizeSearchText('مصطفي'));
});

test('normalizeSearchText strips tashkeel and tatweel', () => {
  assert.equal(normalizeSearchText('فُسْتَان'), normalizeSearchText('فستان'));
  assert.equal(normalizeSearchText('فســـتان'), normalizeSearchText('فستان'));
});

test('normalizeSearchText collapses whitespace and lowercases latin text', () => {
  assert.equal(normalizeSearchText('  Lena   SHOWROOM '), 'lena showroom');
});

test('normalizeDigits converts Arabic-Indic digits to ASCII', () => {
  assert.equal(normalizeDigits('٩١٩١٨١٨٦'), '91918186');
  assert.equal(normalizeDigits('۹۱۹۱۸۱۸۶'), '91918186');
});

test('normalizePhoneForSearch drops formatting and the Omani country code', () => {
  assert.equal(normalizePhoneForSearch('+968 9191 8186'), '91918186');
  assert.equal(normalizePhoneForSearch('968-9191-8186'), '91918186');
  assert.equal(normalizePhoneForSearch('91918186'), '91918186');
});

test('normalizePhoneForSearch leaves non-Omani numbers intact', () => {
  // Stripping a leading "966" or "20" would make unrelated foreign numbers
  // collide with local ones, so only the 11-digit Omani shape is trimmed.
  assert.equal(normalizePhoneForSearch('+966 50 868 8213'), '966508688213');
  assert.equal(normalizePhoneForSearch('+20 121 210 1073'), '201212101073');
});

test('matchesSearchQuery returns every row for an empty query', () => {
  assert.equal(matchesSearchQuery('', ['أي شيء']), true);
  assert.equal(matchesSearchQuery('   ', ['أي شيء']), true);
});

test('matchesSearchQuery ignores undefined and null fields', () => {
  assert.equal(matchesSearchQuery('لينا', ['لينا', undefined, null]), true);
  assert.equal(matchesSearchQuery('لينا', [undefined, null]), false);
});

test('matchesSearchQuery finds a formatted phone from an unformatted query', () => {
  assert.equal(matchesSearchQuery('91918186', ['نورة', '+968 9191 8186']), true);
});

test('matchesSearchQuery finds a formatted phone from an Arabic-Indic query', () => {
  assert.equal(matchesSearchQuery('٩١٩١٨١٨٦', ['نورة', '+968 9191 8186']), true);
});

test('matchesSearchQuery matches the tail of a reference number', () => {
  assert.equal(matchesSearchQuery('1042', ['RSV-001042']), true);
});

test('the digit-joining branch requires at least three digits', () => {
  // Joining digits across separators is what lets "91918186" reach
  // "+968 9191 8186", but on a one or two digit query it would match almost
  // every record, so the branch is length-guarded. A plain substring match is
  // still allowed at any length — it is the join that is restricted.
  assert.equal(matchesSearchQuery('23', ['12 34']), false, 'two digits must not be joined across the separator');
  assert.equal(matchesSearchQuery('234', ['12 34']), true, 'three digits may be joined across the separator');
});

test('createSearchMatcher builds a reusable predicate with identical results', () => {
  const matches = createSearchMatcher('فاطمه');
  assert.equal(matches(['فاطمة الهنائية']), true);
  assert.equal(matches(['سالم البلوشي']), false);
});

test('createSearchMatcher with an empty query accepts everything', () => {
  const matches = createSearchMatcher('');
  assert.equal(matches(['أي شيء']), true);
  assert.equal(matches([]), true);
});

test('customer search finds a name written with a different ta marbuta', () => {
  setup();
  try {
    addCustomer({ name: 'فاطمة الهنائية', phone: '+968 9191 8186', status: 'active' });
    const found = filterCustomers(getCustomers(), { search: 'فاطمه', status: 'all', balance: 'all' });
    assert.equal(found.length, 1, 'the duplicate-creating miss must not happen again');
    assert.equal(found[0].name, 'فاطمة الهنائية');
  } finally {
    uninstallStorage();
  }
});

test('customer search finds a name written without hamza', () => {
  setup();
  try {
    addCustomer({ name: 'أسماء البلوشية', phone: '+968 9200 1122', status: 'active' });
    const found = filterCustomers(getCustomers(), { search: 'اسماء', status: 'all', balance: 'all' });
    assert.equal(found.length, 1);
  } finally {
    uninstallStorage();
  }
});

test('customer search finds a stored formatted phone from bare digits', () => {
  setup();
  try {
    addCustomer({ name: 'نورة', phone: '+968 9191 8186', status: 'active' });
    const found = filterCustomers(getCustomers(), { search: '91918186', status: 'all', balance: 'all' });
    assert.equal(found.length, 1, 'a bare-digit query must reach a formatted stored number');
  } finally {
    uninstallStorage();
  }
});

test('customer search still separates two different customers', () => {
  setup();
  try {
    addCustomer({ name: 'فاطمة الهنائية', phone: '+968 9191 8186', status: 'active' });
    addCustomer({ name: 'سالم البلوشي', phone: '+968 9200 3344', status: 'active' });
    const found = filterCustomers(getCustomers(), { search: 'سالم', status: 'all', balance: 'all' });
    assert.equal(found.length, 1);
    assert.equal(found[0].name, 'سالم البلوشي');
  } finally {
    uninstallStorage();
  }
});

test('customer search combines with the status filter rather than replacing it', () => {
  setup();
  try {
    addCustomer({ name: 'فاطمة الهنائية', phone: '+968 9191 8186', status: 'active' });
    addCustomer({ name: 'فاطمة السعدية', phone: '+968 9200 5566', status: 'blocked' });
    const found = filterCustomers(getCustomers(), { search: 'فاطمه', status: 'blocked', balance: 'all' });
    assert.equal(found.length, 1);
    assert.equal(found[0].status, 'blocked');
  } finally {
    uninstallStorage();
  }
});

test('inventory search folds Arabic variants in item names', () => {
  setup();
  try {
    addDress({
      name: 'فستان زفاف مطرّز',
      description: '',
      category: 'زفاف',
      color: 'أبيض',
      size: '42',
      purchasePrice: 100,
      rentalPrice: 50,
      salePrice: 200,
      depositAmount: 20,
      status: 'available',
      isForRent: true,
      isForSale: false,
      images: [],
      barcode: '',
    });
    assert.equal(filterDresses({ search: 'مطرز' }).length, 1, 'tashkeel must not block an inventory match');
    assert.equal(filterDresses({ search: 'ابيض' }).length, 1, 'a bare alef query must reach a hamza-seated colour');
  } finally {
    uninstallStorage();
  }
});
