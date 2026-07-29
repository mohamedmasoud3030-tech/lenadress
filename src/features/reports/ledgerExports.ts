import { buildCsv, toCsvFileName } from '../../shared/utils/csv';
import { getTodayISO } from '../../shared/utils/date';
import {
  PAYMENT_DIRECTION_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_TYPE_LABELS,
} from '../payments/payment.constants';
import { EXPENSE_CATEGORY_LABELS } from '../expenses/expense.constants';
import type { PaymentRecord } from '../payments/payment.types';
import type { ExpenseRecord } from '../expenses/expense.types';
import type { Reservation } from '../reservations/reservation.types';
import type { Customer } from '../customers/customer.types';
import type { AuditLogEntry } from '../audit/audit.types';
import { getReservationLines } from '../reservations/contractLineHelpers';

/**
 * Ledger exports.
 *
 * Only the inventory-performance report could be exported. Everything the
 * accountant actually asks for at month end — the payment ledger, the expense
 * ledger, the booking list, outstanding customer balances — could only be read
 * on screen, so the numbers were retyped by hand into a spreadsheet. Retyping
 * money is how reconciliation errors are born.
 *
 * Every export goes through `buildCsv`, which prefixes the UTF-8 BOM (without
 * it Excel renders the whole Arabic file as mojibake) and neutralises leading
 * formula characters so a customer named "=cmd" cannot become an executable
 * cell.
 *
 * Dates are emitted as plain ISO strings rather than localised text: the
 * accountant sorts and filters on them, and a localised Arabic date sorts
 * alphabetically into nonsense.
 */

export const PAYMENTS_CSV_HEADERS = [
  'رقم الدفعة',
  'التاريخ',
  'رقم الحجز',
  'العميلة',
  'كود القطعة',
  'اسم القطعة',
  'النوع',
  'الاتجاه',
  'الوسيلة',
  'المبلغ',
  'ملاحظات',
];

export function buildPaymentsCsv(payments: PaymentRecord[]): string {
  return buildCsv(PAYMENTS_CSV_HEADERS, payments.map((payment) => [
    payment.paymentNumber,
    payment.paymentDate,
    payment.reservationNumber,
    payment.customerName,
    payment.dressCode,
    payment.dressName,
    PAYMENT_TYPE_LABELS[payment.type] ?? payment.type,
    PAYMENT_DIRECTION_LABELS[payment.direction] ?? payment.direction,
    PAYMENT_METHOD_LABELS[payment.method] ?? payment.method,
    payment.amount,
    payment.notes ?? '',
  ]));
}

export const EXPENSES_CSV_HEADERS = [
  'رقم المصروف',
  'التاريخ',
  'البند',
  'التصنيف',
  'الوسيلة',
  'المبلغ',
  'كود القطعة',
  'اسم القطعة',
  'ملاحظات',
];

export function buildExpensesCsv(expenses: ExpenseRecord[]): string {
  return buildCsv(EXPENSES_CSV_HEADERS, expenses.map((expense) => [
    expense.expenseNumber,
    expense.expenseDate,
    expense.title,
    EXPENSE_CATEGORY_LABELS[expense.category] ?? expense.category,
    PAYMENT_METHOD_LABELS[expense.paymentMethod] ?? expense.paymentMethod,
    expense.amount,
    expense.relatedDressCode ?? expense.relatedAccessoryCode ?? '',
    expense.relatedDressName ?? '',
    expense.notes ?? '',
  ]));
}

export const RESERVATIONS_CSV_HEADERS = [
  'رقم الحجز',
  'الحالة',
  'العميلة',
  'الهاتف',
  'كود القطعة',
  'اسم القطعة',
  'تاريخ الاستلام',
  'تاريخ الإرجاع',
  'سعر الإيجار',
  'سعر القائمة',
  'الخصم',
  'العربون',
  'الإجمالي',
  'المدفوع',
  'المتبقي',
  'عدد البنود',
];

const RESERVATION_STATUS_LABELS: Record<Reservation['status'], string> = {
  pending: 'قيد التأكيد',
  confirmed: 'مؤكد',
  delivered: 'مسلّم',
  returned: 'مسترجع',
  cancelled: 'ملغى',
  overdue: 'متأخر',
};

export function buildReservationsCsv(reservations: Reservation[]): string {
  const rows: unknown[][] = [];

  reservations.forEach((reservation) => {
    const lines = getReservationLines(reservation);
    const lineCount = lines.length;

    if (lineCount <= 1) {
      // Single-item reservation (legacy or single-line)
      const line = lines[0];
      const listPrice = line?.listRentalPrice ?? reservation.listRentalPrice ?? reservation.rentalPrice;
      rows.push([
        reservation.reservationNumber,
        RESERVATION_STATUS_LABELS[reservation.status] ?? reservation.status,
        reservation.customerName,
        reservation.customerPhone,
        line?.dressCodeSnapshot ?? reservation.dressCode,
        line?.dressNameSnapshot ?? reservation.dressName,
        line?.pickupDate ?? reservation.pickupDate,
        line?.returnDate ?? reservation.returnDate,
        line?.rentalPrice ?? reservation.rentalPrice,
        listPrice,
        Math.max(listPrice - (line?.rentalPrice ?? reservation.rentalPrice), 0),
        line?.depositAmount ?? reservation.depositAmount,
        reservation.totalAmount,
        reservation.paidAmount,
        reservation.remainingAmount,
        lineCount,
      ]);
    } else {
      // Multi-item reservation: one row per line
      lines.forEach((line, index) => {
        const listPrice = line.listRentalPrice ?? line.rentalPrice;
        rows.push([
          reservation.reservationNumber,
          RESERVATION_STATUS_LABELS[reservation.status] ?? reservation.status,
          reservation.customerName,
          reservation.customerPhone,
          line.dressCodeSnapshot,
          line.dressNameSnapshot,
          line.pickupDate,
          line.returnDate,
          line.rentalPrice,
          listPrice,
          Math.max(listPrice - line.rentalPrice, 0),
          line.depositAmount,
          // Only show totals on the first line row
          index === 0 ? reservation.totalAmount : '',
          index === 0 ? reservation.paidAmount : '',
          index === 0 ? reservation.remainingAmount : '',
          lineCount,
        ]);
      });
    }
  });

  return buildCsv(RESERVATIONS_CSV_HEADERS, rows);
}

export const CUSTOMERS_CSV_HEADERS = [
  'الاسم',
  'الهاتف',
  'العنوان',
  'الحالة',
  'عدد الحجوزات',
  'حجوزات نشطة',
  'إجمالي المدفوع',
  'الرصيد المتبقي',
];

export function buildCustomersCsv(customers: Customer[]): string {
  return buildCsv(CUSTOMERS_CSV_HEADERS, customers.map((customer) => [
    customer.name,
    // Kept as text: a phone number starting with + is a formula trigger, and an
    // unguarded one also loses its leading zero to Excel's number parsing.
    customer.phone,
    customer.address,
    customer.status,
    customer.totalReservations,
    customer.activeReservations,
    customer.totalPaid,
    customer.remainingBalance,
  ]));
}

export const AUDIT_CSV_HEADERS = [
  'الوقت',
  'الإجراء',
  'نوع السجل',
  'معرّف السجل',
  'الملخص',
  'الموظفة',
];

export function buildAuditCsv(entries: AuditLogEntry[]): string {
  return buildCsv(AUDIT_CSV_HEADERS, entries.map((entry) => [
    entry.timestamp,
    entry.action,
    entry.entityType,
    entry.entityId,
    entry.summary,
    entry.performedBy ?? '',
  ]));
}

/** Consistent, dated filenames so a month of exports sorts correctly. */
export function ledgerFileName(base: string): string {
  return toCsvFileName(base, getTodayISO());
}
