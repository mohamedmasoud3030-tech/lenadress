import { Appointment, AppointmentStatus } from './appointment.types';
import { generateId, migrateLegacyAppointmentStorage, readCollection, writeCollection } from '../../services/localDatabase';
import { recordAudit } from '../audit/audit.service';

const APPOINTMENTS_COLLECTION = 'appointments';

function getAppointments(): Appointment[] {
  migrateLegacyAppointmentStorage();
  return readCollection<Appointment>(APPOINTMENTS_COLLECTION, []);
}

function saveAppointments(appointments: Appointment[]): void {
  migrateLegacyAppointmentStorage();
  writeCollection<Appointment>(APPOINTMENTS_COLLECTION, appointments);
}

export function addAppointment(input: Omit<Appointment, 'id' | 'createdAt' | 'updatedAt'>): Appointment {
  const appointments = getAppointments();
  
  const newAppointment: Appointment = {
    ...input,
    // Crypto-backed, like every other persisted id. `Math.random()` was both a
    // collision risk and a flagged weak-randomness source.
    id: `apt-${generateId()}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  if (!input.customerName?.trim()) throw new Error('اسم العميلة مطلوب.');
  if (!input.appointmentDate) throw new Error('تاريخ الموعد مطلوب.');
  if (!input.startTime || !input.endTime) throw new Error('وقت بداية ونهاية الموعد مطلوبان.');
  if (input.endTime <= input.startTime) throw new Error('وقت النهاية يجب أن يكون بعد وقت البداية.');

  // Two appointments cannot occupy the same room at the same time.
  const clash = appointments.find((appointment) => appointment.status !== 'cancelled'
    && appointment.appointmentDate === input.appointmentDate
    && Boolean(input.roomId) && appointment.roomId === input.roomId
    && appointment.startTime < input.endTime
    && input.startTime < appointment.endTime);
  if (clash) throw new Error(`تتعارض الغرفة مع موعد آخر من ${clash.startTime} إلى ${clash.endTime}.`);

  appointments.push(newAppointment);
  saveAppointments(appointments);
  recordAudit({
    action: 'create',
    entityType: 'appointment',
    entityId: newAppointment.id,
    summary: `تم حجز موعد للعميلة ${newAppointment.customerName} بتاريخ ${newAppointment.appointmentDate}.`,
    nextValues: { appointmentDate: newAppointment.appointmentDate, startTime: newAppointment.startTime },
  });
  return newAppointment;
}

export function getAppointmentsByDate(date: string): Appointment[] {
  const appointments = getAppointments();
  return appointments.filter(apt => apt.appointmentDate === date);
}

export function getTodaysAppointments(): Appointment[] {
  const today = new Date().toISOString().split('T')[0];
  return getAppointmentsByDate(today);
}

export function updateAppointmentStatus(id: string, status: AppointmentStatus): Appointment | null {
  const appointments = getAppointments();
  const index = appointments.findIndex(apt => apt.id === id);
  
  if (index === -1) return null;

  appointments[index] = {
    ...appointments[index],
    status,
    updatedAt: new Date().toISOString(),
  };

  saveAppointments(appointments);
  return appointments[index];
}

export function deleteAppointment(id: string): boolean {
  const appointments = getAppointments();
  const filtered = appointments.filter(apt => apt.id !== id);
  
  if (filtered.length === appointments.length) return false;

  saveAppointments(filtered);
  return true;
}
