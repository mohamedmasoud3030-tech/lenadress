import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DRESS_STATUS_LABELS,
  DRESS_STATUS_OPTIONS,
  DRESS_STATUS_STYLES,
} from '../src/shared/domain/dressConstants.ts';
import {
  RESERVATION_STATUS_LABELS,
  RESERVATION_STATUS_STYLES,
} from '../src/shared/domain/reservationConstants.ts';
import {
  BASIC_PAYMENT_METHOD_LABELS,
  MANUAL_PAYMENT_TYPES,
  PAYMENT_DIRECTION_FILTER_OPTIONS,
  PAYMENT_DIRECTION_LABELS,
  PAYMENT_METHOD_FILTER_OPTIONS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  PAYMENT_TYPE_FILTER_OPTIONS,
  PAYMENT_TYPE_LABELS,
} from '../src/features/payments/payment.constants.ts';
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_FILTER_OPTIONS,
  EXPENSE_CATEGORY_LABELS,
  EXPENSE_PAYMENT_METHOD_FILTER_OPTIONS,
  EXPENSE_PAYMENT_METHOD_LABELS,
  EXPENSE_PAYMENT_METHODS,
} from '../src/features/expenses/expense.constants.ts';

function sortedValues(values) {
  return [...values].sort();
}

function assertSameMembers(actual, expected) {
  assert.deepEqual(sortedValues(actual), sortedValues(expected));
}

function assertFilterMatchesLabels(filterOptions, labels) {
  assert.deepEqual(filterOptions[0], { value: 'all', label: filterOptions[0].label });
  assertSameMembers(
    filterOptions.slice(1).map((option) => option.value),
    Object.keys(labels),
  );
  filterOptions.slice(1).forEach((option) => {
    assert.equal(option.label, labels[option.value]);
  });
}

test('dress status domain constants expose labels and styles for every status', () => {
  // Labels and styles must cover every status that can appear in stored data,
  // including the legacy `reserved` value.
  assertSameMembers(Object.keys(DRESS_STATUS_LABELS), Object.keys(DRESS_STATUS_STYLES));

  // Selectable options must be a subset: availability is date-derived, so
  // `reserved` is renderable but must never be offered as a physical state.
  DRESS_STATUS_OPTIONS.forEach((status) => {
    assert.equal(typeof DRESS_STATUS_LABELS[status], 'string');
    assert.equal(typeof DRESS_STATUS_STYLES[status], 'string');
  });
  assert.equal(DRESS_STATUS_OPTIONS.includes('reserved'), false);
  assert.equal(typeof DRESS_STATUS_LABELS.reserved, 'string', 'legacy records must still render');

  const nonSelectable = Object.keys(DRESS_STATUS_LABELS).filter((status) => !DRESS_STATUS_OPTIONS.includes(status));
  assert.deepEqual(nonSelectable, ['reserved'], 'only the legacy reserved status may be non-selectable');
});

test('reservation status labels and styles stay in lockstep', () => {
  assertSameMembers(Object.keys(RESERVATION_STATUS_LABELS), Object.keys(RESERVATION_STATUS_STYLES));
});

test('payment constants keep labels, method arrays, and filter options consistent', () => {
  assertSameMembers(PAYMENT_METHODS, Object.keys(PAYMENT_METHOD_LABELS));
  assertSameMembers(PAYMENT_METHODS, Object.keys(BASIC_PAYMENT_METHOD_LABELS));
  assertSameMembers(MANUAL_PAYMENT_TYPES, ['adjustment', 'deposit', 'penalty', 'refund', 'rental']);
  assertFilterMatchesLabels(PAYMENT_TYPE_FILTER_OPTIONS, PAYMENT_TYPE_LABELS);
  assertFilterMatchesLabels(PAYMENT_METHOD_FILTER_OPTIONS, PAYMENT_METHOD_LABELS);
  assertFilterMatchesLabels(PAYMENT_DIRECTION_FILTER_OPTIONS, PAYMENT_DIRECTION_LABELS);
});

test('expense constants keep labels, arrays, and filter options consistent', () => {
  assertSameMembers(EXPENSE_CATEGORIES, Object.keys(EXPENSE_CATEGORY_LABELS));
  assertSameMembers(EXPENSE_PAYMENT_METHODS, Object.keys(EXPENSE_PAYMENT_METHOD_LABELS));
  assertFilterMatchesLabels(EXPENSE_CATEGORY_FILTER_OPTIONS, EXPENSE_CATEGORY_LABELS);
  assertFilterMatchesLabels(EXPENSE_PAYMENT_METHOD_FILTER_OPTIONS, EXPENSE_PAYMENT_METHOD_LABELS);
});
