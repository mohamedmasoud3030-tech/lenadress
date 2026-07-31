import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { installStorage, uninstallStorage, futureDate, nowDateTimeLocal } from './helpers/storage.mjs';
import { resetCountersForTesting, readCollection, writeCollection } from '../src/engines/persistence/index.ts';
import { addCustomer } from '../src/features/customers/customer.service.ts';
import { addDress } from '../src/features/dresses/dress.service.ts';
import { createReservation } from '../src/features/reservations/reservation.service.ts';
import { completeDeliveryCommand, completeReturnCommand } from '../src/features/workflows/deliveryReturnCommands.ts';
import { getDeliveryReturnRecords } from '../src/features/delivery-return/deliveryReturn.service.ts';
import { getAuditLog } from '../src/features/audit/audit.service.ts';
import {
  DEFAULT_MAX_DIMENSION,
  estimateDataUrlBytes,
  scaleToFit,
} from '../src/platform/images/imageCompression.ts';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const sourceRoot = join(repositoryRoot, 'src');

/** A 1x1 transparent PNG, the smallest valid image data URL. */
const TINY_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function photo(id, note) {
  return { id, dataUrl: TINY_PNG, capturedAt: new Date().toISOString(), note };
}

function setup() {
  installStorage();
  resetCountersForTesting();
}

function seedDeliveredReservation() {
  const customer = addCustomer({ name: 'نورة', phone: '+968 9191 8186', status: 'active' });
  const dress = addDress({
    name: 'فستان زفاف',
    description: '',
    category: 'زفاف',
    color: 'أبيض',
    size: '42',
    purchasePrice: 300,
    rentalPrice: 80,
    salePrice: 600,
    depositAmount: 50,
    status: 'available',
    isForRent: true,
    isForSale: false,
    images: [],
    barcode: '',
  });
  const reservation = createReservation({
    customerId: customer.id,
    dressId: dress.id,
    pickupDate: futureDate(1),
    returnDate: futureDate(3),
    depositAmount: 50,
  });

  // The delivery path refuses a future timestamp, so the booking is back-dated
  // to today before the handover is recorded.
  const stored = readCollection('reservations', []);
  writeCollection('reservations', stored.map((item) => ({
    ...item,
    pickupDate: futureDate(0),
    returnDate: futureDate(2),
  })));

  return reservation;
}

test('scaleToFit never upscales an image that is already small', () => {
  assert.deepEqual(scaleToFit(800, 600, DEFAULT_MAX_DIMENSION), { width: 800, height: 600 });
});

test('scaleToFit clamps the longest edge and preserves the aspect ratio', () => {
  const result = scaleToFit(4000, 3000, 1280);
  assert.equal(result.width, 1280);
  assert.equal(result.height, 960);
});

test('scaleToFit clamps a portrait photo on its height', () => {
  const result = scaleToFit(3000, 4000, 1280);
  assert.equal(result.height, 1280);
  assert.equal(result.width, 960);
});

test('scaleToFit never returns a zero dimension for an extreme panorama', () => {
  const result = scaleToFit(10_000, 3, 1280);
  assert.ok(result.height >= 1, 'a rounded-down dimension must not become zero');
});

test('estimateDataUrlBytes reports the decoded size, not the base64 length', () => {
  const bytes = estimateDataUrlBytes(TINY_PNG);
  assert.ok(bytes > 0);
  assert.ok(bytes < TINY_PNG.length, 'base64 is larger than the bytes it encodes');
});

test('a delivery stores the condition photographs on the record', () => {
  setup();
  try {
    const reservation = seedDeliveredReservation();
    completeDeliveryCommand({
      paymentOverrideReason: 'تجاوز سداد مخصص لسيناريو الاختبار',
      reservationNumber: reservation.reservationNumber,
      deliveryDateTime: nowDateTimeLocal(),
      deliveryCondition: 'حالة ممتازة',
      deliveryPhotos: [photo('p1'), photo('p2')],
    });

    const record = getDeliveryReturnRecords()[0];
    assert.equal(record.deliveryPhotos.length, 2);
    assert.ok(record.deliveryPhotos[0].dataUrl.startsWith('data:image/'));
  } finally {
    uninstallStorage();
  }
});

test('a return stores its own photographs without overwriting the delivery ones', () => {
  setup();
  try {
    const reservation = seedDeliveredReservation();
    completeDeliveryCommand({
      paymentOverrideReason: 'تجاوز سداد مخصص لسيناريو الاختبار',
      reservationNumber: reservation.reservationNumber,
      deliveryDateTime: nowDateTimeLocal(),
      deliveryPhotos: [photo('out-1')],
    });
    completeReturnCommand({
      reservationNumber: reservation.reservationNumber,
      returnDateTime: nowDateTimeLocal(),
      returnCondition: 'بقعة عند الذيل',
      returnPhotos: [photo('back-1'), photo('back-2')],
      lateFee: 0,
      damageFee: 0,
      refundMethod: 'cash',
      nextItemStatus: 'laundry',
    });

    const record = getDeliveryReturnRecords()[0];
    assert.equal(record.deliveryPhotos.length, 1, 'the before evidence must survive the return');
    assert.equal(record.returnPhotos.length, 2);
    assert.equal(record.deliveryPhotos[0].id, 'out-1');
  } finally {
    uninstallStorage();
  }
});

test('a handover without photographs stores no empty array', () => {
  setup();
  try {
    const reservation = seedDeliveredReservation();
    completeDeliveryCommand({
      paymentOverrideReason: 'تجاوز سداد مخصص لسيناريو الاختبار',
      reservationNumber: reservation.reservationNumber,
      deliveryDateTime: nowDateTimeLocal(),
    });
    const record = getDeliveryReturnRecords()[0];
    assert.equal(record.deliveryPhotos, undefined, 'absence must stay absent rather than become []');
  } finally {
    uninstallStorage();
  }
});

test('a non-image payload is rejected rather than stored as evidence', () => {
  setup();
  try {
    const reservation = seedDeliveredReservation();
    completeDeliveryCommand({
      paymentOverrideReason: 'تجاوز سداد مخصص لسيناريو الاختبار',
      reservationNumber: reservation.reservationNumber,
      deliveryDateTime: nowDateTimeLocal(),
      deliveryPhotos: [{ id: 'bad', dataUrl: 'javascript:alert(1)', capturedAt: new Date().toISOString() }],
    });
    const record = getDeliveryReturnRecords()[0];
    assert.equal(record.deliveryPhotos, undefined, 'only data:image payloads may be kept');
  } finally {
    uninstallStorage();
  }
});

test('more photographs than the cap are refused so backups stay usable', () => {
  setup();
  try {
    const reservation = seedDeliveredReservation();
    assert.throws(
      () => completeDeliveryCommand({
        paymentOverrideReason: 'تجاوز سداد مخصص لسيناريو الاختبار',
        reservationNumber: reservation.reservationNumber,
        deliveryDateTime: nowDateTimeLocal(),
        deliveryPhotos: [photo('1'), photo('2'), photo('3'), photo('4'), photo('5')],
      }),
      /أكثر من/,
    );
  } finally {
    uninstallStorage();
  }
});

test('the audit trail records how many photographs were attached', () => {
  setup();
  try {
    const reservation = seedDeliveredReservation();
    completeDeliveryCommand({
      paymentOverrideReason: 'تجاوز سداد مخصص لسيناريو الاختبار',
      reservationNumber: reservation.reservationNumber,
      deliveryDateTime: nowDateTimeLocal(),
      deliveryPhotos: [photo('p1'), photo('p2')],
    });
    const entry = getAuditLog().find((item) => item.action === 'deliver');
    assert.equal(entry.nextValues.deliveryPhotos, 2);
  } finally {
    uninstallStorage();
  }
});

test('condition evidence survives a backup export and import', async () => {
  setup();
  try {
    const { exportDatabaseBackup, importDatabaseBackup } = await import('../src/engines/persistence/index.ts');
    const reservation = seedDeliveredReservation();
    completeDeliveryCommand({
      paymentOverrideReason: 'تجاوز سداد مخصص لسيناريو الاختبار',
      reservationNumber: reservation.reservationNumber,
      deliveryDateTime: nowDateTimeLocal(),
      deliveryPhotos: [photo('keep-me')],
    });

    const backup = exportDatabaseBackup();
    uninstallStorage();
    setup();
    importDatabaseBackup(backup);

    const record = getDeliveryReturnRecords()[0];
    assert.equal(record.deliveryPhotos[0].id, 'keep-me', 'evidence must travel with the record it proves');
  } finally {
    uninstallStorage();
  }
});

test('uploads are compressed before they are stored, not stored raw', async () => {
  const upload = await readFile(join(sourceRoot, 'features/dresses/ImageUpload.tsx'), 'utf8');
  const capture = await readFile(join(sourceRoot, 'features/delivery-return/ConditionPhotoCapture.tsx'), 'utf8');

  // Storing raw camera output is what created the quota risk in the first place.
  assert.match(upload, /compressImageFiles/, 'catalogue photos must be compressed');
  assert.match(capture, /compressImageFiles/, 'condition evidence must be compressed');
  assert.doesNotMatch(upload, /readAsDataURL/, 'the raw-read path must be gone from the upload component');
});

test('image compression lives in the platform layer, not a feature', async () => {
  // Canvas, Image and FileReader are browser APIs; the architecture test bans
  // them outside src/platform, and this keeps the intent explicit.
  const capture = await readFile(join(sourceRoot, 'features/delivery-return/ConditionPhotoCapture.tsx'), 'utf8');
  assert.match(capture, /from '@platform\/images'/, 'the feature must reach compression through the platform port');
  assert.doesNotMatch(capture, /document\.createElement\('canvas'\)/, 'no direct canvas access in a feature');
});

test('the capture control opens the camera rather than the photo library', async () => {
  const capture = await readFile(join(sourceRoot, 'features/delivery-return/ConditionPhotoCapture.tsx'), 'utf8');
  // A library picker invites attaching an old photo, which is the exact
  // ambiguity this feature exists to remove.
  assert.match(capture, /capture="environment"/, 'the rear camera must be the default source');
});

test('stored evidence is shown on the record, not merely persisted', async () => {
  const page = await readFile(join(sourceRoot, 'features/delivery-return/DeliveryReturnPage.tsx'), 'utf8');
  assert.match(page, /deliveryPhotos/, 'delivery evidence must be visible');
  assert.match(page, /returnPhotos/, 'return evidence must be visible');
  assert.match(page, /<img/, 'the evidence must render as images');
});
