import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { installStorage, uninstallStorage, futureDate } from './helpers/storage.mjs';
import { countLateDays, suggestLateFee } from '../src/features/delivery-return/lateFee.ts';
import {
  DEFAULT_APP_PREFERENCES,
  getAppPreferences,
  saveAppPreferences,
} from '../src/features/preferences/preferences.service.ts';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = join(repositoryRoot, 'src');

const fixedPolicy = {
  mode: 'fixed_per_day',
  amountPerDay: 5,
  percentPerDay: 0,
  graceDays: 0,
  maxPercentOfRental: 0,
};

const percentPolicy = {
  mode: 'percent_of_rental_per_day',
  amountPerDay: 0,
  percentPerDay: 10,
  graceDays: 0,
  maxPercentOfRental: 0,
};

test('countLateDays returns zero for an on-time return', () => {
  assert.equal(countLateDays('2026-09-20', '2026-09-20T18:00'), 0);
});

test('countLateDays returns zero for an early return rather than a negative', () => {
  assert.equal(countLateDays('2026-09-20', '2026-09-18T18:00'), 0);
});

test('countLateDays counts whole calendar days late', () => {
  assert.equal(countLateDays('2026-09-20', '2026-09-23T09:00'), 3);
});

test('countLateDays is unaffected by the time of day', () => {
  // Whole-day settlement is deliberate: an hourly fee invites an argument about
  // the exact minute the customer walked in.
  assert.equal(countLateDays('2026-09-20', '2026-09-21T00:05'), 1);
  assert.equal(countLateDays('2026-09-20', '2026-09-21T23:55'), 1);
});

test('countLateDays crosses a month boundary correctly', () => {
  assert.equal(countLateDays('2026-09-29', '2026-10-02T10:00'), 3);
});

test('an on-time return suggests nothing at all', () => {
  const result = suggestLateFee({ returnDate: '2026-09-20', rentalPrice: 100 }, '2026-09-20T18:00', fixedPolicy);
  assert.equal(result.amount, 0);
  assert.equal(result.lateDays, 0);
});

test('a fixed policy multiplies the daily amount by the late days', () => {
  const result = suggestLateFee({ returnDate: '2026-09-20', rentalPrice: 100 }, '2026-09-23T10:00', fixedPolicy);
  assert.equal(result.lateDays, 3);
  assert.equal(result.chargeableDays, 3);
  assert.equal(result.amount, 15);
});

test('a percentage policy is computed against the agreed rental, not the list price', () => {
  // The agreed price is what the customer actually owes; charging a percentage
  // of an undiscounted catalogue price would overcharge every discounted booking.
  const result = suggestLateFee({ returnDate: '2026-09-20', rentalPrice: 80 }, '2026-09-22T10:00', percentPolicy);
  assert.equal(result.amount, 16);
});

test('percentage arithmetic is rounded to the rial subdivision', () => {
  const result = suggestLateFee(
    { returnDate: '2026-09-20', rentalPrice: 33.333 },
    '2026-09-21T10:00',
    { ...percentPolicy, percentPerDay: 7 },
  );
  // A figure like 2.3333100000000003 on a printed invoice undermines the
  // operator even when it is arithmetically correct.
  const decimals = String(result.amount).split('.')[1]?.length ?? 0;
  assert.ok(decimals <= 3, `expected at most 3 decimals, got ${result.amount}`);
  assert.equal(result.amount, 2.333);
});

test('grace days are subtracted before anything is charged', () => {
  const result = suggestLateFee(
    { returnDate: '2026-09-20', rentalPrice: 100 },
    '2026-09-23T10:00',
    { ...fixedPolicy, graceDays: 2 },
  );
  assert.equal(result.lateDays, 3);
  assert.equal(result.chargeableDays, 1);
  assert.equal(result.amount, 5);
});

test('a delay entirely inside the grace window charges nothing but is still reported', () => {
  const result = suggestLateFee(
    { returnDate: '2026-09-20', rentalPrice: 100 },
    '2026-09-21T10:00',
    { ...fixedPolicy, graceDays: 2 },
  );
  assert.equal(result.amount, 0);
  assert.equal(result.lateDays, 1, 'the operator must still see that it was late');
  assert.match(result.explanation, /مهلة السماح/);
});

test('the cap limits a long delay to a percentage of the rental', () => {
  const result = suggestLateFee(
    { returnDate: '2026-09-20', rentalPrice: 100 },
    '2026-11-20T10:00',
    { ...fixedPolicy, maxPercentOfRental: 50 },
  );
  assert.equal(result.amount, 50);
  assert.equal(result.capped, true);
  assert.match(result.explanation, /الحد الأقصى/);
});

test('a zero cap means uncapped rather than zero fee', () => {
  const result = suggestLateFee(
    { returnDate: '2026-09-20', rentalPrice: 100 },
    '2026-09-30T10:00',
    { ...fixedPolicy, maxPercentOfRental: 0 },
  );
  assert.equal(result.amount, 50);
  assert.equal(result.capped, false);
});

test('the disabled policy reports the delay without proposing money', () => {
  const result = suggestLateFee(
    { returnDate: '2026-09-20', rentalPrice: 100 },
    '2026-09-25T10:00',
    { ...fixedPolicy, mode: 'none' },
  );
  assert.equal(result.amount, 0);
  assert.equal(result.lateDays, 5, 'lateness is a fact even when the showroom does not charge for it');
  assert.match(result.explanation, /لم يتم تفعيل/);
});

test('the explanation always states how the figure was reached', () => {
  const result = suggestLateFee({ returnDate: '2026-09-20', rentalPrice: 100 }, '2026-09-22T10:00', fixedPolicy);
  assert.match(result.explanation, /تأخير 2 يوم/);
  assert.match(result.explanation, /يمكنك تعديل القيمة/, 'the operator must be told the figure is editable');
});

test('a zero rental price cannot produce a percentage charge', () => {
  const result = suggestLateFee({ returnDate: '2026-09-20', rentalPrice: 0 }, '2026-09-25T10:00', percentPolicy);
  assert.equal(result.amount, 0);
});

test('the default policy ships disabled so no unagreed charge ever appears', () => {
  // Inventing a rate on the showroom's behalf would put a number on a real
  // invoice that neither party agreed to.
  assert.equal(DEFAULT_APP_PREFERENCES.lateFeePolicy.mode, 'none');
});

test('a stored policy round-trips through preferences', () => {
  installStorage();
  try {
    saveAppPreferences({
      ...DEFAULT_APP_PREFERENCES,
      lateFeePolicy: { mode: 'fixed_per_day', amountPerDay: 7.5, percentPerDay: 0, graceDays: 1, maxPercentOfRental: 200 },
    });
    const stored = getAppPreferences().lateFeePolicy;
    assert.equal(stored.mode, 'fixed_per_day');
    assert.equal(stored.amountPerDay, 7.5);
    assert.equal(stored.graceDays, 1);
  } finally {
    uninstallStorage();
  }
});

test('installations created before the policy existed get the safe default', () => {
  installStorage();
  try {
    // No lateFeePolicy key at all, as an older install would have.
    const preferences = getAppPreferences();
    assert.equal(preferences.lateFeePolicy.mode, 'none');
    assert.equal(preferences.lateFeePolicy.graceDays, 0);
  } finally {
    uninstallStorage();
  }
});

test('enabling a mode without a rate is refused rather than silently charging zero', () => {
  installStorage();
  try {
    assert.throws(
      () => saveAppPreferences({
        ...DEFAULT_APP_PREFERENCES,
        lateFeePolicy: { mode: 'fixed_per_day', amountPerDay: 0, percentPerDay: 0, graceDays: 0, maxPercentOfRental: 0 },
      }),
      /قيمة رسوم التأخير/,
    );
  } finally {
    uninstallStorage();
  }
});

test('an out-of-range stored policy is clamped rather than trusted', () => {
  installStorage();
  try {
    saveAppPreferences({
      ...DEFAULT_APP_PREFERENCES,
      lateFeePolicy: { mode: 'percent_of_rental_per_day', amountPerDay: 0, percentPerDay: 500, graceDays: 999, maxPercentOfRental: 5000 },
    });
    const stored = getAppPreferences().lateFeePolicy;
    assert.equal(stored.percentPerDay, 100, 'a daily rate above 100% of the rental is not a rate');
    assert.equal(stored.graceDays, 30);
    assert.equal(stored.maxPercentOfRental, 1000);
  } finally {
    uninstallStorage();
  }
});

test('the return form suggests the fee and lets the operator apply or ignore it', async () => {
  const modal = await readFile(join(sourceRoot, 'features/delivery-return/DeliveryReturnModal.tsx'), 'utf8');
  assert.match(modal, /suggestLateFee/, 'the return form must compute a proposal');
  assert.match(modal, /lateFeeSuggestion/, 'the proposal must reach the UI');
  assert.match(modal, /تطبيق/, 'applying the proposal must be an explicit action');
  // The field must remain freely editable: an automatic uneditable charge would
  // remove a legitimate commercial decision from the showroom.
  assert.match(modal, /value=\{form\.lateFee\}/, 'the fee stays a controlled editable field');
});

test('the policy is configurable from settings, not hard-coded', async () => {
  const page = await readFile(join(sourceRoot, 'features/preferences/PreferencesPage.tsx'), 'utf8');
  assert.match(page, /lateFeePolicy/, 'the showroom must be able to set its own policy');
  assert.match(page, /مهلة السماح/, 'the grace allowance must be configurable');
});

test('the suggestion never fires without a real return event', async () => {
  const modal = await readFile(join(sourceRoot, 'features/delivery-return/DeliveryReturnModal.tsx'), 'utf8');
  // The app projects a booking to `overdue` from the calendar alone, but money
  // must only move on a witnessed handover.
  assert.match(modal, /form\.operation === 'return' && selectedReservation/, 'no proposal outside a return');
});

test('an unknown stored mode falls back to no charge', () => {
  installStorage();
  try {
    const result = suggestLateFee(
      { returnDate: futureDate(-5), rentalPrice: 100 },
      `${futureDate(0)}T10:00`,
      { mode: 'nonsense', amountPerDay: 5, percentPerDay: 5, graceDays: 0, maxPercentOfRental: 0 },
    );
    assert.equal(result.amount, 0, 'an unrecognised policy must never invent a charge');
  } finally {
    uninstallStorage();
  }
});
