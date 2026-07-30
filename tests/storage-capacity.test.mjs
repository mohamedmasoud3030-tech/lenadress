import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyStorageCapacity, formatStorageBytes } from '../src/platform/storage/storageCapacity.ts';

test('storage capacity classifies healthy, warning and critical levels before writes fail', () => {
  assert.equal(classifyStorageCapacity(10, 100)?.status, 'healthy');
  assert.equal(classifyStorageCapacity(80, 100)?.status, 'warning');
  assert.equal(classifyStorageCapacity(95, 100)?.status, 'critical');
  assert.equal(classifyStorageCapacity(1000, 100)?.usedPercent, 100);
});

test('invalid quota readings are treated as unavailable instead of inventing a safe result', () => {
  assert.equal(classifyStorageCapacity(0, 0), null);
  assert.equal(classifyStorageCapacity(-1, 100), null);
  assert.equal(classifyStorageCapacity(Number.NaN, 100), null);
});

test('capacity values use readable Arabic units', () => {
  assert.match(formatStorageBytes(1024 * 512), /كيلوبايت/);
  assert.match(formatStorageBytes(1024 * 1024), /ميجابايت/);
});
