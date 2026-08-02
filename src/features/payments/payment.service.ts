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

function isSecurityDepositRefundType(type: string): boolean {
  return type === 'security_deposit_refund';
}
function isSecurityDepositRetentionType(type: string): boolean {
  return type === 'security_deposit_retention' || type === 'retained_deposit';
}
function isRentalRefundType(type: string): boolean {
  return type === 'refund';
}

/** Every value that can change financial timing, classification, or the audit trail. */
export function matchesIdempotentPaymentPayload(
  existing: PaymentRecord,
  input: Pick<AddPaymentInput, 'paymentDate' | 'type' | 'method' | 'amount' | 'notes' | 'retentionReason'>,
  direction: PaymentDirection,
): boolean {
  return existing.type === (input.type === 'rental' ? 'rental_payment' : input.type)
    && Math.abs(existing.amount - input.amount) < 1e-6
    && existing.method === input.method
    && existing.direction === direction
    && existing.paymentDate === input.paymentDate
    && (existing.retentionReason ?? '') === (input.retentionReason?.trim() ?? '')
    && (existing.notes ?? '') === (input.notes?.trim() ?? '')
    && existing.source === 'manual';
}

export function addPayment(input: AddPaymentInput): PaymentRecord {
  const reservation = getReservations().find((item) => item.reservationNumber === input.reservationNumber);

  // Strict separation of refund types per blocker #1 - do NOT use existence of securityDepositCollectedAmount to decide type
  const isRentalRefund = isRentalRefundType(input.type);
  const isDepositRefund = isSecurityDepositRefundType(input.type);
  const isRetention = isSecurityDepositRetentionType(input.type);
  let direction: PaymentDirection;
  if (isRentalRefund || isDepositRefund) direction = 'refund';
  else if (isRetention) direction = 'settlement';
  else direction = 'income';

  if (!reservation) throw new Error('الحجز المحدد غير موجود.');
  if (!input.paymentDate) throw new Error('تاريخ الدفع مطلوب.');
  if (input.paymentDate > getTodayISO()) throw new Error('تاريخ الدفع لا يمكن أن يكون في المستقبل.');
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('قيمة الدفعة يجب أن تكون أكبر من صفر.');
  assertBusinessDateOpen(input.paymentDate);

  if (input.type === 'deposit') {
    if (reservation.securityDepositAmount !== undefined) {
      throw new Error('نوع الحركة deposit غامض؛ استخدمي security_deposit_collection أو booking_advance أو rental_payment.');
    }
  }

  // ---- Blocker 1: separate refund guards ----
  if (isDepositRefund) {
    // Security deposit refund checks ONLY against securityDepositCollected, Refunded, Retained
    const collected = reservation.securityDepositCollectedAmount ?? 0;
    const refunded = reservation.securityDepositRefundedAmount ?? 0;
    const retained = reservation.securityDepositRetainedAmount ?? 0;
    const available = calculateSecurityDepositLiability({ collected, refunded, retained });
    if (input.amount > available + 1e-6) {
      throw new Error('قيمة استرداد التأمين المسترد تتجاوز المبلغ المتاح للاسترداد.');
    }
  } else if (isRentalRefund) {
    // This PR has no cancellation/refund policy for booking advances.  A generic
    // rental refund therefore covers only explicit rental collections.
    const rentalCollected = reservation.rentalCollectedAmount ?? 0;
    const rentalRefunded = reservation.rentalRefundedAmount ?? 0;
    if (input.amount > rentalCollected - rentalRefunded + 1e-6) {
      throw new Error('قيمة استرجاع الإيجار تتجاوز المبلغ المحصل فعلياً للإيجار. رد دفعة الحجز عند الإلغاء خارج نطاق هذه النسخة.');
    }
  }

  if (isRetention) {
    throw new Error('احتجاز التأمين متاح فقط عبر تسوية الاسترجاع المرتبطة برسوم تأخير أو ضرر مُقيّمة.');
  }

  // ---- Blocker 3: idempotency scoped to reservation + operation/type + key ----
  if (input.idempotencyKey) {
    const scopedExisting = getPayments().find(
      (p) => p.reservationNumber === input.reservationNumber && p.idempotencyKey === input.idempotencyKey,
    );
    if (scopedExisting) {
      const payloadMatches = matchesIdempotentPaymentPayload(scopedExisting, input, direction);
      if (payloadMatches) {
        return scopedExisting;
      }
      // Same key, same reservation, but different payload -> reject reuse
      throw new Error('إعادة استخدام مفتاح idempotency مع حمولة مختلفة غير مسموحة لنفس الحجز.');
    }
    // Do NOT return payment from other reservation - scoped search ensures we don't
    // Global check is intentionally NOT used here to prevent cross-reservation leak
  }

  // Map manual type to canonical for storage
  let canonicalType: PaymentType = input.type as PaymentType;
  if (input.type === 'rental') canonicalType = 'rental_payment';

  // ---- Blocker 2: settlement must be passed as real movement, not converted to income ----
  const updatedReservation = recordReservationPayment({
    reservationNumber: reservation.reservationNumber,
    type: input.type,
    direction, // income | refund | settlement - no conversion to income
    amount: input.amount,
  });

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

  // Canonical security deposit handling - derive from reservation fields, fallback to payment history only for collected
  const securityDepositAmount = getReservationDepositTotal(reservation);
  const securityDepositCollected = reservation.securityDepositCollectedAmount ?? 0;
  const securityDepositRefunded = reservation.securityDepositRefundedAmount ?? 0;
  const securityDepositRetained = reservation.securityDepositRetainedAmount ?? 0;

  // For legacy backups where collected fields not yet set, derive from payment history (only then)
  const securityDepositCollectedFromHistory = securityDepositCollected > 0
    ? securityDepositCollected
    : reservationPayments
        .filter((p) => p.type === 'security_deposit_collection' || p.type === 'deposit')
        .filter((p) => p.direction === 'income')
        .reduce((sum, p) => sum + p.amount, 0);

  const rentalCollected = reservation.rentalCollectedAmount ?? 0;
  const bookingAdvanceCollected = reservation.bookingAdvanceCollectedAmount ?? 0;

  const totalCollected = securityDepositCollectedFromHistory + rentalCollected + bookingAdvanceCollected;

  const previouslyRefundedAmount = reservationPayments
    .filter((p) => p.direction === 'refund')
    .reduce((sum, p) => sum + p.amount, 0);

  // Use canonical settlement calculation
  const settlement = calculateReturnSettlement({
    securityDepositAmount,
    securityDepositCollected: securityDepositCollectedFromHistory,
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
    collected: securityDepositCollectedFromHistory,
    refunded: securityDepositRefunded,
    retained: securityDepositRetained,
  });
  if (refundAmount + retainedDepositAmount > available + 1e-6) {
    throw new Error('إجمالي رد التأمين والتأمين المحتجز يتجاوز المبلغ المتاح.');
  }

  // Retention must have clear reason and cover proven fees - validation
  if (retainedDepositAmount > 0) {
    if (!input.retentionReason && (input.lateFee + input.damageFee) === 0) {
      // If retained but no fee and no reason, require reason
      throw new Error('سبب احتجاز التأمين المسترد مطلوب عند وجود مبلغ محتجز بدون رسوم مثبتة.');
    }
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
    securityDepositCollectedAmount: securityDepositCollectedFromHistory,
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
