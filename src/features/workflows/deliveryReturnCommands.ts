import { commandBoundary, runCommand } from '@engines/workflows';
import type { AccessoryReturnEntry } from '../accessories/reservationAccessory.service';
import { completeDelivery, completeReturn } from '../delivery-return/deliveryReturn.operations';
import type { ConditionPhoto, DeliveryReturnRecord } from '../delivery-return/deliveryReturn.types';
import type { PaymentMethod } from '../payments/payment.types';

/**
 * Atomic delivery and return commands.
 *
 * Delivery writes a delivery record, moves the reservation to `delivered`,
 * flips the item to `rented` and writes audit. Return additionally posts the
 * financial settlement. Each was previously a sequence of independent writes:
 * a failure in the middle could take the money without releasing the item, or
 * release the item without recording the settlement.
 *
 * Business rule enforced here: a returned item never goes straight back to
 * `available`. It must land in inspection, laundry, maintenance or damaged, and
 * only an explicit inspection/service decision can make it available again.
 */

const ALLOWED_RETURN_STATUSES = ['inspection', 'laundry', 'maintenance', 'damaged'] as const;

export type ReturnItemStatus = (typeof ALLOWED_RETURN_STATUSES)[number];

export type CompleteDeliveryCommandInput = {
  reservationNumber: string;
  deliveryDateTime: string;
  deliveryCondition?: string;
  /** Condition evidence photographed at the counter. */
  deliveryPhotos?: ConditionPhoto[];
  /** Accessories actually handed over; recorded inside the same boundary. */
  deliveredAccessoryIds?: string[];
  /** Audited reason for the exceptional decision to hand over with money outstanding. */
  paymentOverrideReason?: string;
  notes?: string;
  idempotencyKey?: string;
};

export function completeDeliveryCommand(input: CompleteDeliveryCommandInput): DeliveryReturnRecord {
  const { idempotencyKey, ...deliveryInput } = input;

  return runCommand(
    {
      name: 'delivery.complete',
      idempotencyKey,
      summarize: (record) => record.reservationNumber,
    },
    () => {
      const record = completeDelivery(deliveryInput);
      commandBoundary('delivery.complete:after-write');
      return record;
    },
  );
}

export type CompleteReturnCommandInput = {
  reservationNumber: string;
  returnDateTime: string;
  returnCondition?: string;
  /** Condition evidence photographed at the counter. */
  returnPhotos?: ConditionPhoto[];
  lateFee: number;
  damageFee: number;
  refundMethod: PaymentMethod;
  nextItemStatus: ReturnItemStatus;
  /** Per-accessory condition and optional damage/loss charge. */
  accessoryReturns?: AccessoryReturnEntry[];
  notes?: string;
  idempotencyKey?: string;
};

export function completeReturnCommand(input: CompleteReturnCommandInput): DeliveryReturnRecord {
  const { idempotencyKey, nextItemStatus, ...returnInput } = input;

  if (!ALLOWED_RETURN_STATUSES.includes(nextItemStatus)) {
    throw new Error('العنصر المسترجع يجب أن ينتقل إلى الفحص أو الغسيل أو الصيانة أو التالف، ولا يصبح متاحاً مباشرة.');
  }

  return runCommand(
    {
      name: 'return.complete',
      idempotencyKey,
      summarize: (record) => record.reservationNumber,
    },
    () => {
      const record = completeReturn({ ...returnInput, nextDressStatus: nextItemStatus });
      commandBoundary('return.complete:after-write');
      return record;
    },
  );
}
