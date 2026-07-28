import { commandBoundary, runCommand } from '@engines/workflows';
import { rescheduleReservation } from '../reservations/reservation.service';
import type { Reservation, RescheduleReservationInput } from '../reservations/reservation.types';

/**
 * Atomic reschedule command.
 *
 * Moving dates, swapping the item and extending the rental are all the same
 * write: the reservation row plus its audit entry. The central conflict check
 * runs inside the service, so this command only guarantees atomicity and
 * duplicate protection.
 */
export function rescheduleReservationCommand(
  input: RescheduleReservationInput & { idempotencyKey?: string },
): Reservation {
  const { idempotencyKey, ...scheduleInput } = input;
  return runCommand(
    { name: 'reservation.reschedule', idempotencyKey, summarize: (reservation) => reservation.reservationNumber },
    () => {
      const reservation = rescheduleReservation(scheduleInput);
      commandBoundary('reservation.reschedule:after-write');
      return reservation;
    },
  );
}
