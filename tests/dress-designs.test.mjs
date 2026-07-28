import test from 'node:test';
import assert from 'node:assert/strict';
import { installStorage, uninstallStorage, todayISO } from './helpers/storage.mjs';
import {
  REGISTERED_COLLECTIONS,
  exportDatabaseBackup,
  importDatabaseBackup,
  readCollection,
  resetCountersForTesting,
  resetDatabase,
  writeCollection,
} from '../src/engines/persistence/index.ts';
import { setCommandFailurePoint, DuplicateCommandError } from '../src/engines/workflows/index.ts';
import { addCustomer } from '../src/features/customers/customer.service.ts';
import { addDress, getDresses, filterDresses } from '../src/features/dresses/dress.service.ts';
import {
  addDesignVariants,
  addDressDesign,
  archiveDressDesign,
  assignPieceToDesign,
  getBookablePieces,
  getDesignPieces,
  getDressDesigns,
  summarizeDesignVariants,
  summarizeAllDesigns,
} from '../src/features/dresses/design.service.ts';
import { addDesignWithVariantsCommand } from '../src/features/workflows/designCommands.ts';
import { createReservationCommand } from '../src/features/workflows/reservationCommands.ts';
import { DEFAULT_APP_PREFERENCES, saveAppPreferences } from '../src/features/preferences/preferences.service.ts';
import { addDaysISO } from '../src/shared/utils/date.ts';

function cleanup() {
  setCommandFailurePoint(null);
  resetCountersForTesting();
  uninstallStorage();
}

const today = todayISO();

function seed() {
  saveAppPreferences({ ...DEFAULT_APP_PREFERENCES, preparationDaysBeforePickup: 0, cleaningDaysAfterReturn: 0 });
  return { customer: addCustomer({ name: 'مريم', phone: '90000040', status: 'normal' }) };
}

function makeDesign(overrides = {}) {
  return addDressDesign({
    name: 'فستان زفاف حورية',
    category: 'زفاف',
    defaultRentalPrice: 100,
    defaultSalePrice: 500,
    defaultDepositAmount: 50,
    ...overrides,
  });
}

test('the design collection is registered so it travels with every backup', () => {
  assert.ok(REGISTERED_COLLECTIONS.includes('dress-designs'));
});

test('a design gets its own monotonic code, distinct from item codes', () => {
  installStorage();
  try {
    const first = makeDesign();
    const second = makeDesign({ name: 'فستان خطوبة' });

    assert.match(first.code, /^DSG-\d{3}$/);
    assert.notEqual(first.code, second.code);
    // Design codes and piece codes must never be confused for each other.
    const piece = addDesignVariants(first.id, [{ size: 'M', color: 'أبيض' }])[0];
    assert.match(piece.code, /^D-\d{3}$/);
  } finally {
    cleanup();
  }
});

test('each variant piece is a real inventory item with its own code and barcode', () => {
  installStorage();
  try {
    const design = makeDesign();
    const pieces = addDesignVariants(design.id, [
      { size: 'S', color: 'أبيض' },
      { size: 'M', color: 'أبيض' },
      { size: 'M', color: 'شمبانيا' },
    ]);

    assert.equal(pieces.length, 3);
    const codes = pieces.map((piece) => piece.code);
    assert.equal(new Set(codes).size, 3, 'no two pieces may share a code');
    pieces.forEach((piece) => {
      assert.equal(piece.barcode, piece.code, 'the barcode is derived from the piece code');
      assert.equal(piece.designId, design.id);
      assert.equal(piece.designCode, design.code);
      assert.equal(piece.rentalPrice, 100, 'the design default is inherited');
    });
  } finally {
    cleanup();
  }
});

test('quantity creates that many independent pieces of the same size and colour', () => {
  installStorage();
  try {
    const design = makeDesign();
    const pieces = addDesignVariants(design.id, [{ size: 'L', color: 'أبيض', quantity: 3 }]);

    assert.equal(pieces.length, 3);
    assert.equal(new Set(pieces.map((piece) => piece.code)).size, 3);
    // Three physical copies, one variant.
    const variants = summarizeDesignVariants(design.id);
    assert.equal(variants.length, 1);
    assert.equal(variants[0].total, 3);
    assert.equal(variants[0].available, 3);
  } finally {
    cleanup();
  }
});

test('a variant may override the design price', () => {
  installStorage();
  try {
    const design = makeDesign();
    const [standard, premium] = addDesignVariants(design.id, [
      { size: 'M', color: 'أبيض' },
      { size: 'XL', color: 'ذهبي', rentalPrice: 180, depositAmount: 90 },
    ]);

    assert.equal(standard.rentalPrice, 100);
    assert.equal(premium.rentalPrice, 180);
    assert.equal(premium.depositAmount, 90);
  } finally {
    cleanup();
  }
});

test('variants are grouped by size and colour with their stocked counts', () => {
  installStorage();
  try {
    const design = makeDesign();
    addDesignVariants(design.id, [
      { size: 'M', color: 'أبيض', quantity: 2 },
      { size: 'L', color: 'أبيض' },
      { size: 'L', color: 'شمبانيا' },
    ]);

    const variants = summarizeDesignVariants(design.id);
    assert.equal(variants.length, 3);
    assert.deepEqual(
      variants.map((variant) => `${variant.size}/${variant.color}:${variant.total}`),
      ['L/أبيض:1', 'L/شمبانيا:1', 'M/أبيض:2'],
    );
  } finally {
    cleanup();
  }
});

test('booking one size leaves the other sizes of the same design available', () => {
  installStorage();
  try {
    const { customer } = seed();
    const design = makeDesign();
    const [small, medium] = addDesignVariants(design.id, [
      { size: 'S', color: 'أبيض' },
      { size: 'M', color: 'أبيض' },
    ]);

    const period = { pickupDate: addDaysISO(today, 3), returnDate: addDaysISO(today, 5) };
    createReservationCommand({
      customerId: customer.id,
      dressId: small.id,
      pickupDate: period.pickupDate,
      returnDate: period.returnDate,
      depositAmount: 0,
      idempotencyKey: 'book-small',
    });

    const variants = summarizeDesignVariants(design.id, period);
    const smallVariant = variants.find((variant) => variant.size === 'S');
    const mediumVariant = variants.find((variant) => variant.size === 'M');

    assert.equal(smallVariant.freeInPeriod, 0, 'the booked size is taken');
    assert.equal(mediumVariant.freeInPeriod, 1, 'a different size of the same design stays free');

    const bookable = getBookablePieces(design.id, period);
    assert.deepEqual(bookable.map((piece) => piece.id), [medium.id]);
  } finally {
    cleanup();
  }
});

test('a second copy of the same size stays bookable when the first is taken', () => {
  installStorage();
  try {
    const { customer } = seed();
    const design = makeDesign();
    const pieces = addDesignVariants(design.id, [{ size: 'M', color: 'أبيض', quantity: 2 }]);

    const period = { pickupDate: addDaysISO(today, 3), returnDate: addDaysISO(today, 5) };
    createReservationCommand({
      customerId: customer.id,
      dressId: pieces[0].id,
      pickupDate: period.pickupDate,
      returnDate: period.returnDate,
      depositAmount: 0,
      idempotencyKey: 'book-copy-1',
    });

    // This is the whole point of the model: two identical pieces, one booked.
    const variants = summarizeDesignVariants(design.id, period);
    assert.equal(variants[0].total, 2);
    assert.equal(variants[0].freeInPeriod, 1);
    assert.deepEqual(getBookablePieces(design.id, period).map((piece) => piece.id), [pieces[1].id]);
  } finally {
    cleanup();
  }
});

test('availability is answered per period, not as a stored flag', () => {
  installStorage();
  try {
    const { customer } = seed();
    const design = makeDesign();
    const [piece] = addDesignVariants(design.id, [{ size: 'M', color: 'أبيض' }]);

    createReservationCommand({
      customerId: customer.id,
      dressId: piece.id,
      pickupDate: addDaysISO(today, 10),
      returnDate: addDaysISO(today, 12),
      depositAmount: 0,
      idempotencyKey: 'period-book',
    });

    const busy = { pickupDate: addDaysISO(today, 11), returnDate: addDaysISO(today, 13) };
    const free = { pickupDate: addDaysISO(today, 20), returnDate: addDaysISO(today, 22) };

    assert.equal(getBookablePieces(design.id, busy).length, 0);
    assert.equal(getBookablePieces(design.id, free).length, 1, 'a different period is still open');
  } finally {
    cleanup();
  }
});

test('the preparation and cleaning windows are honoured for design availability', () => {
  installStorage();
  try {
    const { customer } = seed();
    saveAppPreferences({ ...DEFAULT_APP_PREFERENCES, preparationDaysBeforePickup: 2, cleaningDaysAfterReturn: 2 });
    const design = makeDesign();
    const [piece] = addDesignVariants(design.id, [{ size: 'M', color: 'أبيض' }]);

    createReservationCommand({
      customerId: customer.id,
      dressId: piece.id,
      pickupDate: addDaysISO(today, 10),
      returnDate: addDaysISO(today, 12),
      depositAmount: 0,
      idempotencyKey: 'buffer-book',
    });

    // One day after the return is still inside the cleaning window.
    assert.equal(getBookablePieces(design.id, { pickupDate: addDaysISO(today, 13), returnDate: addDaysISO(today, 14) }).length, 0);
    assert.equal(getBookablePieces(design.id, { pickupDate: addDaysISO(today, 15), returnDate: addDaysISO(today, 16) }).length, 1);
  } finally {
    cleanup();
  }
});

test('a damaged or sold piece is never offered, whatever the period', () => {
  installStorage();
  try {
    const design = makeDesign();
    const pieces = addDesignVariants(design.id, [{ size: 'M', color: 'أبيض', quantity: 2 }]);

    const dresses = getDresses();
    writeCollection('dresses', dresses.map((dress) => (dress.id === pieces[0].id ? { ...dress, status: 'damaged' } : dress)));

    const period = { pickupDate: addDaysISO(today, 3), returnDate: addDaysISO(today, 5) };
    assert.deepEqual(getBookablePieces(design.id, period).map((piece) => piece.id), [pieces[1].id]);
  } finally {
    cleanup();
  }
});

test('an existing standalone piece can join a design without losing its identity', () => {
  installStorage();
  try {
    const design = makeDesign();
    const standalone = addDress({
      name: 'قطعة قديمة',
      description: '',
      itemType: 'dress',
      category: 'زفاف',
      color: 'أبيض',
      size: 'M',
      purchasePrice: 100,
      rentalPrice: 90,
      salePrice: 400,
      depositAmount: 40,
      status: 'available',
      isForRent: true,
      isForSale: true,
      images: [],
      barcode: '',
    });

    const linked = assignPieceToDesign(standalone.code, design.id);

    assert.equal(linked.designId, design.id);
    assert.equal(linked.code, standalone.code, 'the stock code never changes');
    assert.equal(linked.barcode, standalone.barcode, 'the barcode never changes');
    assert.equal(linked.rentalPrice, 90, 'its own price is preserved');
    assert.equal(getDesignPieces(design.id).length, 1);
  } finally {
    cleanup();
  }
});

test('pieces created before designs existed keep working with no design', () => {
  installStorage();
  try {
    const standalone = addDress({
      name: 'قطعة مستقلة',
      description: '',
      itemType: 'dress',
      category: 'سهرة',
      color: 'أزرق',
      size: 'S',
      purchasePrice: 50,
      rentalPrice: 40,
      salePrice: 200,
      depositAmount: 20,
      status: 'available',
      isForRent: true,
      isForSale: true,
      images: [],
      barcode: '',
    });

    // No migration is required: the link is simply absent.
    assert.equal(standalone.designId, undefined);
    assert.equal(getDresses().length, 1);
    assert.equal(summarizeAllDesigns().length, 0);
  } finally {
    cleanup();
  }
});

test('inventory filters can narrow to a design, a size or a colour', () => {
  installStorage();
  try {
    const design = makeDesign();
    addDesignVariants(design.id, [
      { size: 'S', color: 'أبيض' },
      { size: 'M', color: 'شمبانيا' },
    ]);
    const other = makeDesign({ name: 'تصميم آخر' });
    addDesignVariants(other.id, [{ size: 'M', color: 'أحمر' }]);

    assert.equal(filterDresses({ designId: design.id }).length, 2);
    assert.equal(filterDresses({ size: 'M' }).length, 2);
    assert.equal(filterDresses({ color: 'أبيض' }).length, 1);
    assert.equal(filterDresses({ designId: design.id, size: 'M' }).length, 1);
    // The design code is searchable, so scanning a design tag finds its pieces.
    assert.equal(filterDresses({ search: design.code }).length, 2);
  } finally {
    cleanup();
  }
});

test('creating a design with its pieces is atomic and duplicate-protected', () => {
  installStorage();
  try {
    const input = {
      design: { name: 'تصميم ذري', category: 'زفاف', defaultRentalPrice: 100, defaultSalePrice: 400, defaultDepositAmount: 50 },
      variants: [{ size: 'M', color: 'أبيض', quantity: 2 }],
      idempotencyKey: 'design-once',
    };

    const result = addDesignWithVariantsCommand(input);
    assert.equal(result.pieces.length, 2);

    assert.throws(() => addDesignWithVariantsCommand(input), DuplicateCommandError);
    assert.equal(getDressDesigns().length, 1, 'a double tap must not create a second design');
    assert.equal(getDresses().length, 2);
  } finally {
    cleanup();
  }
});

test('a forced failure leaves neither the design nor any orphan piece behind', () => {
  installStorage();
  try {
    setCommandFailurePoint('design.create:after-write');
    assert.throws(
      () => addDesignWithVariantsCommand({
        design: { name: 'تصميم فاشل', category: 'زفاف', defaultRentalPrice: 100, defaultSalePrice: 400, defaultDepositAmount: 50 },
        variants: [{ size: 'M', color: 'أبيض', quantity: 2 }],
        idempotencyKey: 'design-fail',
      }),
      /forced failure/,
    );

    assert.equal(getDressDesigns().length, 0);
    assert.equal(getDresses().length, 0, 'no piece may survive holding a retired code');
  } finally {
    cleanup();
  }
});

test('a design cannot be archived while its pieces are still out', () => {
  installStorage();
  try {
    const design = makeDesign();
    const pieces = addDesignVariants(design.id, [{ size: 'M', color: 'أبيض' }]);
    writeCollection('dresses', getDresses().map((dress) => (dress.id === pieces[0].id ? { ...dress, status: 'rented' } : dress)));

    assert.throws(() => archiveDressDesign(design.id), /ما زالت خارج المحل/);

    writeCollection('dresses', getDresses().map((dress) => (dress.id === pieces[0].id ? { ...dress, status: 'available' } : dress)));
    const archived = archiveDressDesign(design.id);
    assert.ok(archived.archivedAt);
    assert.equal(summarizeAllDesigns().length, 0, 'an archived design leaves the working set');
  } finally {
    cleanup();
  }
});

test('designs and their piece links survive a backup and restore round trip', () => {
  installStorage();
  try {
    const design = makeDesign();
    addDesignVariants(design.id, [{ size: 'M', color: 'أبيض', quantity: 2 }]);

    const backup = exportDatabaseBackup();
    assert.equal(backup.collections['dress-designs'].length, 1);

    resetDatabase();
    assert.equal(getDressDesigns().length, 0);

    importDatabaseBackup(backup);

    const restored = getDressDesigns();
    assert.equal(restored.length, 1);
    assert.equal(restored[0].code, design.code);
    const pieces = getDesignPieces(restored[0].id);
    assert.equal(pieces.length, 2, 'the piece links must survive');
    pieces.forEach((piece) => assert.equal(piece.designCode, design.code));
    assert.equal(readCollection('dress-designs', []).length, 1, 'no duplication on restore');
  } finally {
    cleanup();
  }
});

test('the design code counter stays monotonic after a restore', () => {
  installStorage();
  try {
    makeDesign();
    const second = makeDesign({ name: 'ثانٍ' });
    const backup = exportDatabaseBackup();

    resetDatabase();
    importDatabaseBackup(backup);

    const next = makeDesign({ name: 'ثالث' });
    assert.ok(next.code > second.code, `${next.code} must follow ${second.code}`);
    assert.equal(new Set(getDressDesigns().map((design) => design.code)).size, 3);
  } finally {
    cleanup();
  }
});

test('invalid variant input is rejected before anything is written', () => {
  installStorage();
  try {
    const design = makeDesign();

    assert.throws(() => addDesignVariants(design.id, []), /مقاساً أو لوناً واحداً/);
    assert.throws(() => addDesignVariants(design.id, [{ size: '', color: 'أبيض' }]), /مقاس القطعة مطلوب/);
    assert.throws(() => addDesignVariants(design.id, [{ size: 'M', color: '' }]), /لون القطعة مطلوب/);
    assert.throws(() => addDesignVariants(design.id, [{ size: 'M', color: 'أبيض', quantity: 0 }]), /بين 1 و 50/);
    assert.throws(() => addDesignVariants(design.id, [{ size: 'M', color: 'أبيض', quantity: 99 }]), /بين 1 و 50/);
    assert.throws(() => addDesignVariants('missing-design', [{ size: 'M', color: 'أبيض' }]), /التصميم المحدد غير موجود/);

    assert.equal(getDresses().length, 0);
  } finally {
    cleanup();
  }
});
