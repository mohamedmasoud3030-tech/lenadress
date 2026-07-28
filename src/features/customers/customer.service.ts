import { generateId, readCollection, writeCollection } from '../../services/localDatabase';
import { recordAudit } from '../audit/audit.service';
import { getCustomerHardDeleteBlockers } from '../integrity/integrity.service';
import type { Reservation } from '../reservations/reservation.types';
import type { Customer, CustomerFilters, CustomerSummary } from './customer.types';

const COLLECTION = 'customers';
const RESERVATION_COLLECTION = 'reservations';
const activeReservationStatuses = new Set<Reservation['status']>(['pending', 'confirmed', 'delivered', 'overdue']);

type AddCustomerInput = {
  name: string;
  phone: string;
  address?: string;
  measurements?: string;
  notes?: string;
  status: Customer['status'];
};

function normalizePhone(value: string): string {
  return value.replace(/\D/g, '');
}

function hydrateCustomer(customer: Customer, reservations: Reservation[]): Customer {
  const customerPhone = normalizePhone(customer.phone);
  const relatedReservations = reservations.filter((reservation) => (
    reservation.customerId ? reservation.customerId === customer.id : normalizePhone(reservation.customerPhone) === customerPhone
  ));

  return {
    ...customer,
    totalReservations: relatedReservations.length,
    activeReservations: relatedReservations.filter((reservation) => activeReservationStatuses.has(reservation.status)).length,
    totalPaid: relatedReservations.reduce((total, reservation) => total + reservation.paidAmount, 0),
    remainingBalance: relatedReservations
      .filter((reservation) => reservation.status !== 'cancelled')
      .reduce((total, reservation) => total + reservation.remainingAmount, 0),
    lastReservationDate: relatedReservations
      .map((reservation) => reservation.pickupDate)
      .sort((a, b) => b.localeCompare(a))[0],
  };
}

export function getCustomers(): Customer[] {
  const customers = readCollection<Customer>(COLLECTION, []);
  const reservations = readCollection<Reservation>(RESERVATION_COLLECTION, []);
  return customers.map((customer) => hydrateCustomer(customer, reservations));
}

export function filterCustomers(customers: Customer[], filters: CustomerFilters): Customer[] {
  const search = filters.search.trim().toLowerCase();

  return customers.filter((customer) => {
    const matchesSearch =
      !search ||
      customer.name.toLowerCase().includes(search) ||
      customer.phone.toLowerCase().includes(search) ||
      customer.address.toLowerCase().includes(search);

    const matchesStatus = filters.status === 'all' || customer.status === filters.status;
    const matchesBalance =
      filters.balance === 'all' ||
      (filters.balance === 'with_balance' && customer.remainingBalance > 0) ||
      (filters.balance === 'clear' && customer.remainingBalance === 0);

    return matchesSearch && matchesStatus && matchesBalance;
  });
}

export function summarizeCustomers(customers: Customer[]): CustomerSummary {
  return {
    total: customers.length,
    trusted: customers.filter((customer) => customer.status === 'trusted').length,
    withBalance: customers.filter((customer) => customer.remainingBalance > 0).length,
    blockedOrWarning: customers.filter((customer) => customer.status === 'warning' || customer.status === 'blocked').length,
  };
}

export function addCustomer(input: AddCustomerInput): Customer {
  const customers = getCustomers();
  const name = input.name.trim();
  const phone = input.phone.trim();
  const normalizedPhone = normalizePhone(phone);

  if (!name) throw new Error('اسم العميلة مطلوب.');
  if (normalizedPhone.length < 7) throw new Error('رقم الهاتف غير صالح.');
  if (customers.some((customer) => normalizePhone(customer.phone) === normalizedPhone)) {
    throw new Error('يوجد سجل عميلة بنفس رقم الهاتف.');
  }

  const customer: Customer = {
    id: generateId(),
    name,
    phone,
    address: input.address?.trim() || '',
    measurements: input.measurements?.trim() || '',
    notes: input.notes?.trim() || undefined,
    status: input.status,
    totalReservations: 0,
    activeReservations: 0,
    totalPaid: 0,
    remainingBalance: 0,
  };

  writeCollection(COLLECTION, [customer, ...customers]);
  recordAudit({
    action: 'create',
    entityType: 'customer',
    entityId: customer.id,
    summary: `تمت إضافة العميلة ${customer.name}.`,
    nextValues: { name: customer.name, phone: customer.phone, status: customer.status },
  });
  return customer;
}

export function getCustomerDeletionBlockers(id: string): string[] {
  const customer = readCollection<Customer>(COLLECTION, []).find((item) => item.id === id);
  if (!customer) return ['العميلة غير موجودة.'];
  return getCustomerHardDeleteBlockers(customer.id, customer.phone);
}

/**
 * Archives a customer instead of deleting her. The record stays available so
 * reservations, payments and reports keep resolving her history.
 */
export function archiveCustomer(id: string): Customer | null {
  const customers = readCollection<Customer>(COLLECTION, []);
  const customer = customers.find((item) => item.id === id);
  if (!customer) return null;

  const activeReservations = readCollection<Reservation>(RESERVATION_COLLECTION, []).filter(
    (reservation) => (reservation.customerId ? reservation.customerId === customer.id : normalizePhone(reservation.customerPhone) === normalizePhone(customer.phone))
      && activeReservationStatuses.has(reservation.status),
  );
  if (activeReservations.length > 0) {
    throw new Error('لا يمكن أرشفة عميلة لديها حجوزات نشطة. أغلقي الحجوزات أولاً.');
  }

  const archived: Customer = { ...customer, status: 'blocked', archivedAt: new Date().toISOString() };
  writeCollection(COLLECTION, customers.map((item) => (item.id === id ? archived : item)));
  recordAudit({
    action: 'archive',
    entityType: 'customer',
    entityId: customer.id,
    summary: `تمت أرشفة العميلة ${customer.name} بدلاً من حذفها للحفاظ على تاريخها.`,
    previousValues: { status: customer.status },
    nextValues: { status: archived.status },
  });
  return archived;
}

/**
 * Hard delete is only permitted for a customer with no history at all.
 */
export function deleteCustomer(id: string): boolean {
  const customers = readCollection<Customer>(COLLECTION, []);
  const customer = customers.find((item) => item.id === id);
  if (!customer) return false;

  const blockers = getCustomerHardDeleteBlockers(customer.id, customer.phone);
  if (blockers.length > 0) {
    throw new Error(`${blockers.join(' ')} استخدمي الأرشفة بدل الحذف.`);
  }

  writeCollection(COLLECTION, customers.filter((item) => item.id !== id));
  recordAudit({
    action: 'delete',
    entityType: 'customer',
    entityId: customer.id,
    summary: `تم حذف سجل العميلة ${customer.name} لعدم وجود أي تاريخ مرتبط بها.`,
    previousValues: { name: customer.name, phone: customer.phone },
  });
  return true;
}
