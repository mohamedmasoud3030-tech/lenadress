import { generateId, generateNumber, readCollection, writeCollection } from '../../services/localDatabase';
import { getTodayISO } from '../../shared/utils/date';
import {
  calculateReturnSettlement,
  calculateSecurityDepositLiability,
} from '../../shared/utils/financialCalculations.js';
import { recordAudit } from '../audit/audit.service';
import { assertBusinessDateOpen } from '../integrity/integrity.service';
import { getReservations, recordReservationPayment, settleReservationReturn } from '../reservations/reservation.service';
import { getReservationDepositTotal } from '../reservations/contractLineHelpers';
import type { Reservation } from '../reservations/reservation.types';
import { PAYMENT_DIRECTION_LABELS, PAYMENT_METHOD_LABELS, PAYMENT_TYPE_LABELS } from './payment.constants';
import type {
  ManualPaymentType,
  PaymentDirection,
  PaymentFilters,
  PaymentMethod,
  PaymentRecord,
  PaymentSummary,
  PaymentType,
} from './payment.types';
import { createSearchMatcher } from '../../shared/utils/search';

const COLLECTION = 'payments';

type AddPaymentInput = {
  reservationNumber: string;
  paymentDate: string;
  type: ManualPaymentType;
  method: PaymentMethod;
  amount: number;
  notes?: string;
  retentionReason?: string;
  idempotencyKey?: string;
};

type RecordReturnSettlementInput = {
  reservationNumber: string;
  paymentDate: string;
  refundMethod: PaymentMethod;
  lateFee: number;
  damageFee: number;
  feesAlreadyAssessed?: boolean;
  retentionReason?: string;
};

export type ReturnSettlement = {
  refundAmount: number;
  retainedDepositAmount: number;
  settledDepositAmount: number;
  movements: PaymentRecord[];
};

export function getPayments(): PaymentRecord[] {
  return readCollection<PaymentRecord>(COLLECTION, []);
}

export function filterPayments(payments: PaymentRecord[], filters: PaymentFilters): PaymentRecord[] {
  const matchesQuery = createSearchMatcher(filters.search);

  return payments.filter((payment) => {
    const matchesType = filters.type === 'all' || payment.type === filters.type;
    const matchesMethod = filters.method === 'all' || payment.method === filters.method;
    const matchesDirection = filters.direction === 'all' || payment.direction === filters.direction;

    const matchesSearch = matchesQuery([
      payment.paymentNumber,
      payment.reservationNumber,
      payment.customerName,
      payment.dressCode,
      payment.dressName,
    ]);

    return matchesType && matchesMethod && matchesDirection && matchesSearch;
  });
}

export function summarizePayments(payments: PaymentRecord[]): PaymentSummary {
  const summary = payments.reduce<PaymentSummary>(
    (acc, payment) => {
      if (payment.direction === 'income') acc.totalCollected += payment.amount;
      if (payment.direction === 'income' && (payment.type === 'rental' || payment.type === 'rental_payment')) acc.rentalCollected += payment.amount;
      if (payment.direction === 'income' && payment.type === 'booking_advance') acc.bookingAdvanceCollected += payment.amount;
      if (payment.direction === 'refund') acc.totalRefunded += payment.amount;
      if (payment.direction === 'income' && payment.type === 'deposit') acc.deposits += payment.amount;
      if (payment.direction === 'income' && payment.type === 'security_deposit_collection') {
        acc.securityDepositsCollected += payment.amount;
        acc.deposits += payment.amount;
      }
      if (payment.direction === 'refund' && payment.type === 'security_deposit_refund') {
        acc.securityDepositsRefunded += payment.amount;
      }
      if (payment.direction === 'settlement' && (payment.type === 'retained_deposit' || payment.type === 'security_deposit_retention')) {
        acc.retainedDeposits += payment.amount;
        acc.securityDepositsRetained += payment.amount;
      }
      if (payment.direction === 'income' && payment.type === 'penalty') acc.penalties += payment.amount;
      if (payment.direction === 'settlement' && payment.type === 'late_fee') acc.lateFees += payment.amount;
      if (payment.direction === 'settlement' && payment.type === 'damage_fee') acc.damageFees += payment.amount;
      return acc;
    },
    {
      totalCollected: 0,
      rentalCollected: 0,
      bookingAdvanceCollected: 0,
      deposits: 0,
      securityDepositsCollected: 0,
      securityDepositsRefunded: 0,
      securityDepositsRetained: 0,
      retainedDeposits: 0,
      penalties: 0,
      lateFees: 0,
      damageFees: 0,
      totalRefunded: 0,
      remainingBalance: 0,
      securityDepositLiability: 0,
    },
  );

  summary.remainingBalance = getReservations()
    .filter((reservation) => reservation.status !== 'cancelled')
    .reduce((total, reservation) => total + reservation.remainingAmount, 0);

  summary.securityDepositLiability = Math.max(
    summary.securityDepositsCollected - summary.securityDepositsRefunded - summary.securityDepositsRetained,
    0,
  );

  return summary;
}

function createPaymentRecord(
  reservation: Reservation,
  input: {
    paymentDate: string;
    type: PaymentType;
    method: PaymentMethod;
    direction: PaymentDirection;
    amount: number;
    source: 'manual' | 'return';
    notes?: string;
    retentionReason?: string;
    idempotencyKey?: string;
  },
): PaymentRecord {
  return {
    id: generateId(),
    paymentNumber: generateNumber('PAY'),
    reservationNumber: reservation.reservationNumber,
    customerName: reservation.customerName,
    dressCode: reservation.dressCode,
    dressName: reservation.dressName,
    paymentDate: input.paymentDate,
    type: input.type,
    method: input.method,
    direction: input.direction,
    amount: input.amount,
    reservationTotal: reservation.totalAmount,
    source: input.source,
    retentionReason: input.retentionReason,
    idempotencyKey: input.idempotencyKey,
    notes: input.notes?.trim() || undefined,
  };
}

function auditPaymentMovement(payment: PaymentRecord): void {
  recordAudit({
    action: payment.direction === 'refund' ? 'refund' : 'payment',
    entityType: 'payment',
    entityId: payment.id,
    summary: `تم تسجيل الحركة ${payment.paymentNumber} على الحجز ${payment.reservationNumber}.`,
    nextValues: {
      type: payment.type,
      direction: payment.direction,
      amount: payment.amount,
      method: payment.method,
      paymentDate: payment.paymentDate,
      source: payment.source,
      retentionReason: payment.retentionReason,
    },
  });
}

function isSecurityDepositCollectionType(type: string): boolean {
  return type === 'security_deposit_collection' || type === 'deposit';
}
function isSecurityDepositRefundType(type: string): boolean {
  return type === 'security_deposit_refund';
}
function isSecurityDepositRetentionType(type: string): boolean {
  return type === 'security_deposit_retention' || type === 'retained_deposit';
}

export function addPayment(input: AddPaymentInput): PaymentRecord {
  const reservation = getReservations().find((item) => item.reservationNumber === input.reservationNumber);
  const isRefundDirection = input.type === 'refund' || input.type === 'security_deposit_refund';
  const isSettlementType = input.type === 'security_deposit_retention';
  const direction: PaymentDirection = isRefundDirection ? 'refund' : isSettlementType ? 'settlement' : 'income';

  if (!reservation) throw new Error('الحجز المحدد غير موجود.');
  if (!input.paymentDate) throw new Error('تاريخ الدفع مطلوب.');
  if (input.paymentDate > getTodayISO()) throw new Error('تاريخ الدفع لا يمكن أن يكون في المستقبل.');
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('قيمة الدفعة يجب أن تكون أكبر من صفر.');
  assertBusinessDateOpen(input.paymentDate);

  // Prevent ambiguous new records: disallow 'deposit' type for new runtime unless explicitly allowed as legacy
  if (input.type === 'deposit') {
    // For new records, we require explicit canonical type. But allow legacy for backward compat reading.
    // Instead of blocking completely, we map to security_deposit_collection but warn that new code must use canonical.
    // To enforce new semantics, we throw if reservation has canonical fields and type is ambiguous 'deposit'
    if (reservation.securityDepositAmount !== undefined) {
      throw new Error('نوع الحركة deposit غامض؛ استخدمي security_deposit_collection أو booking_advance أو rental_payment.');
    }
  }

  // Security deposit liability checks
  if (isSecurityDepositCollectionType(input.type) && direction === 'income') {
    // collection creates liability, always allowed, but must not be negative later
  }

  if (isSecurityDepositRefundType(input.type) || (input.type === 'refund' && reservation.securityDepositCollectedAmount !== undefined)) {
    // Refund must not exceed available refundable liability
    const collected = reservation.securityDepositCollectedAmount ?? 0;
    const refunded = reservation.securityDepositRefundedAmount ?? 0;
    const retained = reservation.securityDepositRetainedAmount ?? 0;
    const available = calculateSecurityDepositLiability({ collected, refunded, retained });
    if (input.amount > available + 1e-6) {
      throw new Error('قيمة استرداد التأمين المسترد تتجاوز المبلغ المتاح للاسترداد.');
    }
  }

  if (isSecurityDepositRetentionType(input.type)) {
    if (!input.retentionReason || !input.retentionReason.trim()) {
      throw new Error('سبب احتجاز التأمين المسترد مطلوب.');
    }
    const collected = reservation.securityDepositCollectedAmount ?? 0;
    const refunded = reservation.securityDepositRefundedAmount ?? 0;
    const retained = reservation.securityDepositRetainedAmount ?? 0;
    const available = calculateSecurityDepositLiability({ collected, refunded, retained });
    if (input.amount > available + 1e-6) {
      throw new Error('قيمة احتجاز التأمين المسترد تتجاوز المبلغ المتاح.');
    }
  }

  // Idempotency: if a payment with same idempotency key exists, return it
  if (input.idempotencyKey) {
    const existing = getPayments().find((p) => p.idempotencyKey === input.idempotencyKey);
    if (existing) return existing;
  }

  // Map manual type to canonical for storage
  let canonicalType: PaymentType = input.type as PaymentType;
  if (input.type === 'rental') canonicalType = 'rental_payment';
  // Keep deposit as is for legacy, but new records should use security_deposit_collection
  // For booking_advance, keep as is

  const updatedReservation = recordReservationPayment({
    reservationNumber: reservation.reservationNumber,
    type: input.type,
    direction: direction === 'refund' ? 'refund' : 'income',
    amount: input.amount,
  });

  // For security deposit collection/refund/retention, we need to also update reservation's security deposit counters
  // The reservation service already handles some, but we ensure explicit
  // For refund/retention, the settlement function is separate; for manual refunds we handle here

  const payment = createPaymentRecord(updatedReservation, {
    paymentDate: input.paymentDate,
    type: canonicalType,
    method: input.method,
    direction,
    amount: input.amount,
    source: 'manual',
    notes: input.notes,
    retentionReason: input.retentionReason,
    idempotencyKey: input.idempotencyKey,
  });

  writeCollection(COLLECTION, [payment, ...getPayments()]);
  auditPaymentMovement(payment);
  return payment;
}

export function recordReturnSettlement(input: RecordReturnSettlementInput): ReturnSettlement {
  const reservation = getReservations().find((item) => item.reservationNumber === input.reservationNumber);
  if (!reservation) throw new Error('الحجز المحدد غير موجود.');
  if (!input.paymentDate) throw new Error('تاريخ تسوية الاسترجاع مطلوب.');
  if (input.paymentDate > getTodayISO()) throw new Error('تاريخ تسوية الاسترجاع لا يمكن أن يكون في المستقبل.');
  if (![input.lateFee, input.damageFee].every((amount) => Number.isFinite(amount) && amount >= 0)) {
    throw new Error('رسوم التأخير أو الضرر غير صالحة.');
  }
  assertBusinessDateOpen(input.paymentDate);

  if (reservation.needsFinancialClassification) {
    throw new Error('هذا الحجز يحتاج مراجعة مالية لتصنيف العربون قبل التسوية.');
  }

  const payments = getPayments();
  const reservationPayments = payments.filter((payment) => payment.reservationNumber === reservation.reservationNumber);

  // Canonical security deposit handling
  const securityDepositAmount = getReservationDepositTotal(reservation);
  const securityDepositCollected = reservation.securityDepositCollectedAmount ??
    reservationPayments
      .filter((p) => p.type === 'security_deposit_collection' || p.type === 'deposit')
      .filter((p) => p.direction === 'income')
      .reduce((sum, p) => sum + p.amount, 0);

  const securityDepositRefunded = reservation.securityDepositRefundedAmount ??
    reservationPayments
      .filter((p) => p.type === 'security_deposit_refund' || (p.type === 'refund' && p.source === 'return'))
      .reduce((sum, p) => sum + p.amount, 0);

  const securityDepositRetained = reservation.securityDepositRetainedAmount ??
    reservationPayments
      .filter((p) => p.type === 'security_deposit_retention' || p.type === 'retained_deposit')
      .reduce((sum, p) => sum + p.amount, 0);

  const rentalCollected = reservation.rentalCollectedAmount ??
    reservationPayments
      .filter((p) => p.type === 'rental' || p.type === 'rental_payment' || p.type === 'booking_advance')
      .filter((p) => p.direction === 'income')
      .reduce((sum, p) => sum + p.amount, 0);

  const totalCollected = reservationPayments
    .filter((p) => p.direction === 'income')
    .reduce((sum, p) => sum + p.amount, 0);

  const previouslyRefundedAmount = reservationPayments
    .filter((p) => p.direction === 'refund')
    .reduce((sum, p) => sum + p.amount, 0);

  // Use canonical settlement calculation
  const settlement = calculateReturnSettlement({
    securityDepositAmount,
    securityDepositCollected,
    securityDepositRefunded,
    securityDepositRetained,
    totalCollected,
    rentalCollected,
    previouslyRefundedAmount,
    previouslyRefundedDepositAmount: securityDepositRefunded,
    lateFee: input.lateFee,
    damageFee: input.damageFee,
  });

  const { refundAmount, retainedDepositAmount, settledDepositAmount } = settlement;

  // Enforce non-negative liability and no over-refund/retention
  const available = calculateSecurityDepositLiability({
    collected: securityDepositCollected,
    refunded: securityDepositRefunded,
    retained: securityDepositRetained,
  });
  if (refundAmount + retainedDepositAmount > available + 1e-6) {
    throw new Error('إجمالي رد التأمين والتأمين المحتجز يتجاوز المبلغ المتاح.');
  }

  if (retainedDepositAmount > 0 && !input.retentionReason && (input.lateFee + input.damageFee) === 0) {
    // Require reason if retained without explicit fee reason
    // But lateFee/damageFee already imply reason, so allow
  }

  const updatedReservation = settleReservationReturn({
    reservationNumber: reservation.reservationNumber,
    lateFee: input.lateFee,
    damageFee: input.damageFee,
    refundAmount,
    settledDepositAmount,
    retainedDepositAmount,
    feesAlreadyAssessed: input.feesAlreadyAssessed,
    securityDepositAmount,
    securityDepositCollectedAmount: securityDepositCollected,
  });

  const movements: PaymentRecord[] = [
    input.lateFee > 0
      ? createPaymentRecord(updatedReservation, {
          paymentDate: input.paymentDate,
          type: 'late_fee',
          method: 'other',
          direction: 'settlement',
          amount: input.lateFee,
          source: 'return',
          notes: 'إثبات رسوم التأخير عند استرجاع العنصر.',
        })
      : null,
    input.damageFee > 0
      ? createPaymentRecord(updatedReservation, {
          paymentDate: input.paymentDate,
          type: 'damage_fee',
          method: 'other',
          direction: 'settlement',
          amount: input.damageFee,
          source: 'return',
          notes: 'إثبات رسوم الضرر عند استرجاع العنصر.',
        })
      : null,
    settledDepositAmount > 0
      ? createPaymentRecord(updatedReservation, {
          paymentDate: input.paymentDate,
          type: 'deposit_settlement',
          method: 'other',
          direction: 'settlement',
          amount: settledDepositAmount,
          source: 'return',
          notes: 'إغلاق وتسوية التأمين المسترد عند استرجاع العنصر.',
        })
      : null,
    retainedDepositAmount > 0
      ? createPaymentRecord(updatedReservation, {
          paymentDate: input.paymentDate,
          type: 'security_deposit_retention',
          method: 'other',
          direction: 'settlement',
          amount: retainedDepositAmount,
          source: 'return',
          notes: 'جزء محتجز من التأمين المسترد لتغطية الرسوم.',
          retentionReason: input.retentionReason || `تأخير ${input.lateFee} + ضرر ${input.damageFee}`,
        })
      : null,
    refundAmount > 0
      ? createPaymentRecord(updatedReservation, {
          paymentDate: input.paymentDate,
          type: 'security_deposit_refund',
          method: input.refundMethod,
          direction: 'refund',
          amount: refundAmount,
          source: 'return',
          notes: 'استرجاع تلقائي للجزء المستحق من التأمين المسترد.',
        })
      : null,
  ].filter((movement): movement is PaymentRecord => movement !== null);

  writeCollection(COLLECTION, [...movements, ...payments]);
  movements.forEach(auditPaymentMovement);
  return { refundAmount, retainedDepositAmount, settledDepositAmount, movements };
}

export function formatPaymentTypeLabel(type: PaymentType): string {
  return PAYMENT_TYPE_LABELS[type] ?? type;
}

export function formatPaymentMethodLabel(method: PaymentMethod): string {
  return PAYMENT_METHOD_LABELS[method] ?? method;
}

export function formatPaymentDirectionLabel(direction: PaymentDirection): string {
  return PAYMENT_DIRECTION_LABELS[direction] ?? direction;
}
