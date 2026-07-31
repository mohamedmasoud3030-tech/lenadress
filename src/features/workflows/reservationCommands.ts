import { commandBoundary, runCommand } from '@engines/workflows';
import { createReservation, cancelReservation, addContractLine, removeContractLine, updateContractLine, deliverContractLine, getReservations, returnContractLine } from '../reservations/reservation.service';
import { calculateLinesFees, getReservationDepositTotal } from '../reservations/contractLineHelpers';
import { recordReturnSettlement } from '../payments/payment.service';
import type { PaymentMethod } from '../payments/payment.types';
import type { Reservation } from '../reservations/reservation.types';

/**
 * Atomic reservation commands.
 *
 * The underlying service already validates blocked customers, date ordering,
 * overlap with the preparation buffer, and item eligibility. Wrapping it in a
 * command adds the two guarantees the showroom actually needs at the counter:
 * a duplicate submit never creates two reservations, and a failure anywhere in
 * the sequence (reservation write, audit write) leaves nothing behind.
 */

export type CreateReservationCommandInput = {
  customerId: string;
  /** Single-item shortcut: equivalent to lines=[{dressId}]. */
  dressId?: string;
  pickupDate: string;
  pickupTime?: string;
  returnDate: string;
  returnTime?: string;
  depositAmount: number;
  /** Agreed rental price; below the catalogue price it is recorded as a discount. */
  rentalPrice?: number;
  notes?: string;
  /** Multi-item lines. When provided, dressId is ignored. */
  lines?: import('../reservations/reservation.types').CreateReservationLineInput[];
  idempotencyKey?: string;
};

export function createReservationCommand(input: CreateReservationCommandInput): Reservation {
  const { idempotencyKey, ...reservationInput } = input;

  return runCommand(
    {
      name: 'reservation.create',
      idempotencyKey,
      summarize: (reservation) => reservation.reservationNumber,
    },
    () => {
      const reservation = createReservation(reservationInput);
      commandBoundary('reservation.create:after-write');
      return reservation;
    },
  );
}

export function cancelReservationCommand(id: string, idempotencyKey?: string): void {
  runCommand({ name: 'reservation.cancel', idempotencyKey }, () => {
    cancelReservation(id);
    commandBoundary('reservation.cancel:after-write');
  });
}

export type AddContractLineCommandInput = {
  reservationNumber: string;
  dressId: string;
  pickupDate?: string;
  pickupTime?: string;
  returnDate?: string;
  returnTime?: string;
  rentalPrice?: number;
  depositAmount?: number;
  notes?: string;
  idempotencyKey?: string;
};

export function addContractLineCommand(input: AddContractLineCommandInput): Reservation {
  const { idempotencyKey, ...lineInput } = input;

  return runCommand(
    {
      name: 'reservation.addLine',
      idempotencyKey,
      summarize: (reservation) => reservation.reservationNumber,
    },
    () => {
      const reservation = addContractLine(lineInput);
      commandBoundary('reservation.addLine:after-write');
      return reservation;
    },
  );
}

export type RemoveContractLineCommandInput = {
  reservationNumber: string;
  lineId: string;
  idempotencyKey?: string;
};

export function removeContractLineCommand(input: RemoveContractLineCommandInput): Reservation {
  const { idempotencyKey, ...lineInput } = input;

  return runCommand(
    {
      name: 'reservation.removeLine',
      idempotencyKey,
      summarize: (reservation) => reservation.reservationNumber,
    },
    () => {
      const reservation = removeContractLine(lineInput);
      commandBoundary('reservation.removeLine:after-write');
      return reservation;
    },
  );
}

export type UpdateContractLineCommandInput = {
  reservationNumber: string;
  lineId: string;
  pickupDate?: string;
  pickupTime?: string;
  returnDate?: string;
  returnTime?: string;
  rentalPrice?: number;
  depositAmount?: number;
  notes?: string;
  idempotencyKey?: string;
};

export function updateContractLineCommand(input: UpdateContractLineCommandInput): Reservation {
  const { idempotencyKey, ...lineInput } = input;

  return runCommand(
    {
      name: 'reservation.updateLine',
      idempotencyKey,
      summarize: (reservation) => reservation.reservationNumber,
    },
    () => {
      const reservation = updateContractLine(lineInput);
      commandBoundary('reservation.updateLine:after-write');
      return reservation;
    },
  );
}

export type DeliverContractLineCommandInput = {
  reservationNumber: string;
  lineId: string;
  deliveryDateTime: string;
  deliveryCondition?: string;
  deliveryPhotos?: import('../delivery-return/deliveryReturn.types').ConditionPhoto[];
  paymentOverrideReason?: string;
  notes?: string;
  idempotencyKey?: string;
};

export function deliverContractLineCommand(input: DeliverContractLineCommandInput): Reservation {
  const { idempotencyKey, ...lineInput } = input;

  return runCommand(
    {
      name: 'reservation.deliverLine',
      idempotencyKey,
      summarize: (reservation) => reservation.reservationNumber,
    },
    () => {
      const reservation = deliverContractLine(lineInput);
      commandBoundary('reservation.deliverLine:after-write');
      return reservation;
    },
  );
}

export type ReturnContractLineCommandInput = {
  reservationNumber: string;
  lineId: string;
  returnDateTime: string;
  returnCondition?: string;
  returnPhotos?: import('../delivery-return/deliveryReturn.types').ConditionPhoto[];
  lateFee: number;
  damageFee: number;
  /** Required when the final returned line closes a collected deposit. */
  refundMethod?: PaymentMethod;
  nextItemStatus: 'inspection' | 'laundry' | 'maintenance' | 'damaged';
  notes?: string;
  idempotencyKey?: string;
};

export function returnContractLineCommand(input: ReturnContractLineCommandInput): Reservation {
  const { idempotencyKey, refundMethod, ...lineInput } = input;

  return runCommand(
    {
      name: 'reservation.returnLine',
      idempotencyKey,
      summarize: (reservation) => reservation.reservationNumber,
    },
    () => {
      let reservation = returnContractLine(lineInput);
      if (reservation.status === 'returned' && (reservation.settledDepositAmount ?? 0) === 0) {
        if (getReservationDepositTotal(reservation) > 0 && !refundMethod) {
          throw new Error('حددي طريقة رد العربون قبل استرجاع آخر بند في العقد.');
        }
        const fees = calculateLinesFees(reservation.lines ?? []);
        recordReturnSettlement({
          reservationNumber: reservation.reservationNumber,
          paymentDate: input.returnDateTime.slice(0, 10),
          refundMethod: refundMethod ?? 'other',
          lateFee: reservation.lines?.reduce((total, line) => total + line.lateFee, 0) ?? fees,
          damageFee: reservation.lines?.reduce((total, line) => total + line.damageFee, 0) ?? 0,
          feesAlreadyAssessed: true,
        });
        reservation = getReservations().find((item) => item.id === reservation.id) ?? reservation;
      }
      commandBoundary('reservation.returnLine:after-write');
      return reservation;
    },
  );
}
