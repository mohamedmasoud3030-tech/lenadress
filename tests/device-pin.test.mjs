import test from 'node:test';
import assert from 'node:assert/strict';
import {
  changeDevicePin,
  configureDevicePin,
  hasDevicePin,
  removeDevicePin,
  verifyDevicePin,
} from '../src/platform/security/devicePin.ts';
import {
  exportDatabaseBackupAsync,
  importDatabaseBackupAsync,
  resetDatabase,
} from '../src/engines/persistence/persistenceEngine.ts';
import { installStorage, uninstallStorage } from './helpers/storage.mjs';

test('a device PIN is stored as a salted verifier, never as the entered PIN', async () => {
  const storage = installStorage();
  try {
    assert.ok(globalThis.crypto?.subtle, 'the supported runtime must provide Web Crypto');
    await configureDevicePin('482915');

    assert.equal(hasDevicePin(), true);
    assert.equal(await verifyDevicePin('482915'), true);
    assert.equal(await verifyDevicePin('482916'), false);

    const saved = storage.get('lena:device-security:pin:v1');
    assert.ok(saved);
    assert.doesNotMatch(saved, /482915/);
    assert.match(saved, /"salt":"[0-9a-f]+"/i);
    assert.match(saved, /"verifier":"[0-9a-f]+"/i);
  } finally {
    uninstallStorage();
  }
});

test('a device PIN rejects malformed values and requires the current PIN to change or remove it', async () => {
  installStorage();
  try {
    await assert.rejects(() => configureDevicePin('1234'), /6 أرقام/);
    await configureDevicePin('482915');

    await assert.rejects(() => changeDevicePin('000000', '592814'), /الحالي غير صحيح/);
    await changeDevicePin('482915', '592814');
    assert.equal(await verifyDevicePin('482915'), false);
    assert.equal(await verifyDevicePin('592814'), true);

    await assert.rejects(() => removeDevicePin('482915'), /الحالي غير صحيح/);
    await removeDevicePin('592814');
    assert.equal(hasDevicePin(), false);
  } finally {
    uninstallStorage();
  }
});

test('a malformed stored PIN never unlocks the application or crashes startup', async () => {
  const storage = installStorage({
    'lena:device-security:pin:v1': '{not-json',
  });
  try {
    assert.equal(hasDevicePin(), false);
    assert.equal(await verifyDevicePin('482915'), false);
    assert.equal(storage.get('lena:device-security:pin:v1'), '{not-json');
  } finally {
    uninstallStorage();
  }
});

test('showroom backup import and reset never copy or remove the physical device PIN', async () => {
  const storage = installStorage();
  try {
    await configureDevicePin('482915');
    const backup = await exportDatabaseBackupAsync();

    resetDatabase();
    assert.equal(await verifyDevicePin('482915'), true);
    assert.equal(storage.has('lena:device-security:pin:v1'), true);

    await importDatabaseBackupAsync(backup);
    assert.equal(await verifyDevicePin('482915'), true);
    assert.equal(storage.has('lena:device-security:pin:v1'), true);
  } finally {
    uninstallStorage();
  }
});
