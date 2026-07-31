import test from 'node:test';
import assert from 'node:assert/strict';
import {
  installStorage,
  uninstallStorage,
  futureDate,
  todayISO,
} from './helpers/storage.mjs';
import { resetCountersForTesting } from '../src/engines/persistence/index.ts';
import { getAuditLog } from '../src/features/audit/audit.service.ts';
import { addCustomer } from '../src/features/customers/customer.service.ts';
import {
  addDress,
  getDresses,
  updateDress,
} from '../src/features/dresses/dress.service.ts';
import { getSaleableDresses } from '../src/features/dresses/sale.service.ts';
import { createReservationCommand } from '../src/features/workflows/reservationCommands.ts';
import { createSaleInvoiceCommand } from '../src/features/workflows/salesCommands.ts';
import {
  bookAppointmentCommand,
  updateAppointmentStatusCommand,
} from '../src/features/workflows/appointmentCommands.ts';
import {
  DEFAULT_APP_PREFERENCES,
  saveAppPreferences,
} from '../src/features/preferences/preferences.service.ts';

const dressInput = {
  name: 'فستان كتالوج',
  description: '',
  itemType: 'dress',
  category: 'سهرة',
  color: 'أسود',
  size: 'M',
  purchasePrice: 100,
  rentalPrice: 40,
  salePrice: 200,
  depositAmount: 20,
  status: 'available',
  isForRent: true,
  isForSale: true,
  images: [],
  barcode: '',
};

function cleanup() {
  resetCountersForTesting();
  uninstallStorage();
}

function seedCatalog() {
  saveAppPreferences({
    ...DEFAULT_APP_PREFERENCES,
    preparationDaysBeforePickup: 0,
    cleaningDaysAfterReturn: 0,
  });
  const customer = addCustomer({
    name: 'عميلة الكتالوج',
    phone: '90000234',
    status: 'normal',
  });
  const first = addDress({ ...dressInput, name: 'القطعة الأساسية' });
  const second = addDress({ ...dressInput, name: 'القطعة الثانية' });
  return { customer, first, second };
}

test('every reserved contract line is excluded from sale, not only the first line', () => {
  installStorage();
  try {
    const { customer, first, second } = seedCatalog();
    createReservationCommand({
      customerId: customer.id,
      pickupDate: futureDate(2),
      returnDate: futureDate(4),
      depositAmount: 0,
      lines: [
        { dressId: first.id, rentalPrice: 40, depositAmount: 20 },
        { dressId: second.id, rentalPrice: 40, depositAmount: 20 },
      ],
      idempotencyKey: 'diagnosis-sale-reservation',
    });

    const saleableCodes = new Set(getSaleableDresses().map((dress) => dress.code));
    assert.equal(saleableCodes.has(first.code), false);
    assert.equal(saleableCodes.has(second.code), false);
    assert.throws(
      () => createSaleInvoiceCommand({
        saleDate: todayISO(),
        customerName: 'مشتري آخر',
        paymentMethod: 'cash',
        lines: [{ dressCode: second.code, amount: second.salePrice }],
        idempotencyKey: 'diagnosis-sell-reserved-second-line',
      }),
      /غير متاحة للبيع|غير متاح للبيع/,
    );
  } finally {
    cleanup();
  }
});

test('inventory identity cannot be changed through a generic update', () => {
  installStorage();
  try {
    const { first } = seedCatalog();
    const updated = updateDress(first.code, {
      id: 'forged-id',
      code: 'D-999999',
      barcode: 'FORGED-BARCODE',
      timesRented: 999,
      name: 'اسم معدل فقط',
    });

    assert.equal(updated?.id, first.id);
    assert.equal(updated?.code, first.code);
    assert.equal(updated?.barcode, first.barcode);
    assert.equal(updated?.timesRented, first.timesRented);
    assert.equal(updated?.name, 'اسم معدل فقط');
  } finally {
    cleanup();
  }
});

test('inventory service rejects impossible money and an unusable item', () => {
  installStorage();
  try {
    assert.throws(
      () => addDress({ ...dressInput, purchasePrice: -1 }),
      /سعر الشراء|سالب/,
    );
    assert.throws(
      () => addDress({
        ...dressInput,
        isForRent: false,
        isForSale: false,
        rentalPrice: 0,
        salePrice: 0,
      }),
      /للبيع أو للإيجار/,
    );
    assert.equal(getDresses().length, 0);
  } finally {
    cleanup();
  }
});

test('an Omani local phone and its +968 form are the same customer identity', () => {
  installStorage();
  try {
    addCustomer({ name: 'سارة', phone: '9000 1234', status: 'normal' });
    assert.throws(
      () => addCustomer({ name: 'سارة مكررة', phone: '+968 9000 1234', status: 'normal' }),
      /بنفس رقم الهاتف/,
    );
  } finally {
    cleanup();
  }
});

test('appointment service rejects a past appointment even outside the form', () => {
  installStorage();
  try {
    assert.throws(
      () => bookAppointmentCommand({
        customerId: '',
        customerName: 'عميلة موعد',
        phone: '90000000',
        appointmentDate: futureDate(-1),
        startTime: '10:00',
        endTime: '11:00',
        status: 'pending',
        idempotencyKey: 'diagnosis-past-appointment',
      }),
      /الماضي/,
    );
  } finally {
    cleanup();
  }
});

test('appointment status changes are auditable business transitions', () => {
  installStorage();
  try {
    const appointment = bookAppointmentCommand({
      customerId: '',
      customerName: 'عميلة موعد',
      phone: '90000000',
      appointmentDate: futureDate(1),
      startTime: '10:00',
      endTime: '11:00',
      status: 'pending',
      idempotencyKey: 'diagnosis-appointment-create',
    });
    updateAppointmentStatusCommand(
      appointment.id,
      'confirmed',
      'diagnosis-appointment-confirm',
    );

    const statusAudit = getAuditLog().find((entry) => (
      entry.entityType === 'appointment'
      && entry.entityId === appointment.id
      && entry.action === 'status-change'
    ));
    assert.ok(statusAudit);
    assert.equal(statusAudit.previousValues?.status, 'pending');
    assert.equal(statusAudit.nextValues?.status, 'confirmed');
  } finally {
    cleanup();
  }
});
