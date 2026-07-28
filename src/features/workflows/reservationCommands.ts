import { commandBoundary, runCommand } from '@engines/workflows';
import { createReservation, cancelReservation } from '../reservations/reservation.service';
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
  dressId: string;
  pickupDate: string;
  pickupTime?: string;
  returnDate: string;
  returnTime?: string;
  depositAmount: number;
  /** Agreed rental price; below the catalogue price it is recorded as a discount. */
  rentalPrice?: number;
  notes?: string;
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
