import { commandBoundary, runCommand } from '@engines/workflows';
import { addPayment, recordReturnSettlement, type ReturnSettlement } from '../payments/payment.service';
import type { ManualPaymentType, PaymentMethod, PaymentRecord } from '../payments/payment.types';

export type RecordPaymentCommandInput = {
  reservationNumber: string;
  paymentDate: string;
  type: ManualPaymentType;
  method: PaymentMethod;
  amount: number;
  notes?: string;
  retentionReason?: string;
  idempotencyKey?: string;
};

export function recordPaymentCommand(input: RecordPaymentCommandInput): PaymentRecord {
  const { idempotencyKey, ...paymentInput } = input;
  // Scope idempotency to reservation + operation + key per requirement: reservationNumber + operation + idempotencyKey
  // For DB consistency, index is (reservation_id, idempotency_key), so we scope command log similarly by reservation
  const scopedKey = idempotencyKey ? `${paymentInput.reservationNumber}:${idempotencyKey}` : undefined;

  return runCommand(
    {
      name: 'payment.record',
      idempotencyKey: scopedKey,
      summarize: (payment) => payment.paymentNumber,
    },
    () => {
      const payment = addPayment({ ...paymentInput, idempotencyKey });
      commandBoundary('payment.record:after-write');
      return payment;
    },
  );
}

export type SettleReturnCommandInput = {
  reservationNumber: string;
  paymentDate: string;
  refundMethod: PaymentMethod;
  lateFee: number;
  damageFee: number;
  idempotencyKey?: string;
  retentionReason?: string;
};

export function settleReturnCommand(input: SettleReturnCommandInput): ReturnSettlement {
  const { idempotencyKey, ...settlementInput } = input;
  const scopedKey = idempotencyKey ? `${settlementInput.reservationNumber}:${idempotencyKey}` : undefined;

  return runCommand({ name: 'payment.settle-return', idempotencyKey: scopedKey }, () => {
    const settlement = recordReturnSettlement(settlementInput);
    commandBoundary('payment.settle-return:after-write');
    return settlement;
  });
}
