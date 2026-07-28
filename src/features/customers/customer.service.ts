import { generateId, readCollection, writeCollection } from '../../services/localDatabase';
import { recordAudit } from '../audit/audit.service';
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
