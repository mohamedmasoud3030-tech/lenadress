import { commandBoundary, runCommand } from '@engines/workflows';
import { addAppointment, updateAppointmentStatus } from '../appointments/appointment.service';
import type { Appointment, AppointmentStatus } from '../appointments/appointment.types';

/**
 * Appointment commands.
 *
 * Booking a fitting writes the appointment and its audit entry, so it is a
 * multi-write operation like every other showroom action: atomic, and protected
 * against the double tap that used to create two identical fittings.
 */

export type BookAppointmentCommandInput = Omit<Appointment, 'id' | 'createdAt' | 'updatedAt'> & {
  idempotencyKey?: string;
};

export function bookAppointmentCommand(input: BookAppointmentCommandInput): Appointment {
  const { idempotencyKey, ...appointmentInput } = input;

  return runCommand(
    { name: 'appointment.book', idempotencyKey, summarize: (appointment) => appointment.id },
    () => {
      const appointment = addAppointment(appointmentInput);
      commandBoundary('appointment.book:after-write');
      return appointment;
    },
  );
}

export function updateAppointmentStatusCommand(
  id: string,
  status: AppointmentStatus,
  idempotencyKey?: string,
): Appointment {
  return runCommand({ name: 'appointment.status', idempotencyKey }, () => {
    const appointment = updateAppointmentStatus(id, status);
    if (!appointment) throw new Error('الموعد المحدد غير موجود.');
    commandBoundary('appointment.status:after-write');
    return appointment;
  });
}
