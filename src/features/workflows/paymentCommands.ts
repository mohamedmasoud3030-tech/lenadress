import { commandBoundary, runCommand } from '@engines/workflows';
import { addPayment, recordReturnSettlement, type ReturnSettlement } from '../payments/payment.service';
import type { ManualPaymentType, PaymentMethod, PaymentRecord } from '../payments/payment.types';

/**
 * Atomic money commands.
 *
 * A payment touches the ledger, the reservation balance and the audit log. Any
 * partial application would leave the showroom with money recorded against a
 * reservation that does not reflect it, so the whole sequence runs inside one
 * transaction boundary with duplicate-submit protection.
 */

export type RecordPaymentCommandInput = {
  reservationNumber: string;
  paymentDate: string;
  type: ManualPaymentType;
  method: PaymentMethod;
  amount: number;
  notes?: string;
  idempotencyKey?: string;
};

export function recordPaymentCommand(input: RecordPaymentCommandInput): PaymentRecord {
  const { idempotencyKey, ...paymentInput } = input;

  return runCommand(
    {
      name: 'payment.record',
      idempotencyKey,
      summarize: (payment) => payment.paymentNumber,
    },
    () => {
      const payment = addPayment(paymentInput);
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
};

export function settleReturnCommand(input: SettleReturnCommandInput): ReturnSettlement {
  const { idempotencyKey, ...settlementInput } = input;

  return runCommand({ name: 'payment.settle-return', idempotencyKey }, () => {
    const settlement = recordReturnSettlement(settlementInput);
    commandBoundary('payment.settle-return:after-write');
    return settlement;
  });
}
