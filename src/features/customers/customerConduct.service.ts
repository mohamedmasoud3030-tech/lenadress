import { generateId, readCollection, writeCollection } from '../../services/localDatabase';
import { getTodayISO } from '../../shared/utils/date';
import { formatMoneyOMR } from '../../shared/utils/format';
import { normalizePhoneForSearch } from '../../shared/utils/search';
import { recordAudit } from '../audit/audit.service';
import { getCurrentOperatorName } from '../operators/operator.service';
import { getDeliveryReturnRecords } from '../delivery-return/deliveryReturn.service';
import { getReservations } from '../reservations/reservation.service';
import type { Customer } from './customer.types';
import type { ConductEvent, ConductNote, CustomerConduct } from './customerConduct.types';

/**
 * Customer conduct, derived from what actually happened.
 *
 * Counting late returns or damages by hand would rot immediately, so they are
 * read from the reservation and delivery records every time. Only deliberate
 * human judgements are stored, and each carries its reason and its author.
 */

const NOTES_COLLECTION = 'customer-conduct-notes';

function normalizePhone(value: string): string {
  return normalizePhoneForSearch(value);
}

export function getConductNotes(): ConductNote[] {
  return readCollection<ConductNote>(NOTES_COLLECTION, []);
}

export function getConductNotesForCustomer(customerId: string): ConductNote[] {
  return getConductNotes()
    .filter((note) => note.customerId === customerId)
    .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt));
}

export type AddConductNoteInput = {
  customerId: string;
  kind: ConductNote['kind'];
  severity: ConductNote['severity'];
  note: string;
  reservationNumber?: string;
};

export function addConductNote(input: AddConductNoteInput): ConductNote {
  const note = input.note.trim();
  if (!note) throw new Error('نص الملاحظة مطلوب.');

  const entry: ConductNote = {
    id: generateId(),
    customerId: input.customerId,
    kind: input.kind,
    severity: input.severity,
    note,
    reservationNumber: input.reservationNumber,
    recordedAt: new Date().toISOString(),
    // A judgement about a customer must never be anonymous.
    recordedBy: getCurrentOperatorName(),
  };

  writeCollection(NOTES_COLLECTION, [entry, ...getConductNotes()]);
  recordAudit({
    action: 'update',
    entityType: 'customer',
    entityId: input.customerId,
    summary: `تمت إضافة ملاحظة سلوك للعميلة.`,
    nextValues: { kind: entry.kind, severity: entry.severity },
  });
  return entry;
}

export function removeConductNote(noteId: string): void {
  const notes = getConductNotes();
  const note = notes.find((entry) => entry.id === noteId);
  if (!note) throw new Error('الملاحظة غير موجودة.');

  writeCollection(NOTES_COLLECTION, notes.filter((entry) => entry.id !== noteId));
  recordAudit({
    action: 'delete',
    entityType: 'customer',
    entityId: note.customerId,
    summary: 'تم حذف ملاحظة سلوك عن العميلة.',
    previousValues: { kind: note.kind, note: note.note },
  });
}

/** Reservations belonging to a customer, matched by stable id then by phone. */
function getCustomerReservations(customer: Customer) {
  const phone = normalizePhone(customer.phone);
  return getReservations().filter((reservation) => (
    reservation.customerId
      ? reservation.customerId === customer.id
      : Boolean(phone) && normalizePhone(reservation.customerPhone) === phone
  ));
}

/**
 * Builds the full conduct picture for one customer.
 *
 * Every count comes from a record the showroom already created, so it cannot
 * disagree with the delivery log or the ledger.
 */
export function getCustomerConduct(customer: Customer): CustomerConduct {
  const today = getTodayISO();
  const reservations = getCustomerReservations(customer);
  const reservationNumbers = new Set(reservations.map((reservation) => reservation.reservationNumber));
  const deliveryRecords = getDeliveryReturnRecords()
    .filter((record) => reservationNumbers.has(record.reservationNumber));

  const events: ConductEvent[] = [];

  // Late returns: proven by the delivery record, not by the current status.
  const lateRecords = deliveryRecords.filter((record) => record.lateFee > 0 || record.status === 'late');
  lateRecords.forEach((record) => {
    events.push({
      kind: 'late_return',
      severity: 'warning',
      date: record.returnDateTime?.slice(0, 10) ?? today,
      description: `تأخرت في إرجاع ${record.dressCode}${record.lateFee > 0 ? ` ورُسمت ${formatMoneyOMR(record.lateFee)}` : ''}.`,
      reservationNumber: record.reservationNumber,
      amount: record.lateFee,
      derived: true,
    });
  });

  const damageRecords = deliveryRecords.filter((record) => record.damageFee > 0 || record.status === 'damaged');
  damageRecords.forEach((record) => {
    events.push({
      kind: 'damage',
      severity: 'severe',
      date: record.returnDateTime?.slice(0, 10) ?? today,
      description: `تلف أو فقد في ${record.dressCode}${record.damageFee > 0 ? ` بقيمة ${formatMoneyOMR(record.damageFee)}` : ''}.`,
      reservationNumber: record.reservationNumber,
      amount: record.damageFee,
      derived: true,
    });
  });

  const cancellations = reservations.filter((reservation) => reservation.status === 'cancelled');
  cancellations.forEach((reservation) => {
    events.push({
      kind: 'cancellation',
      severity: 'neutral',
      date: reservation.pickupDate,
      description: `ألغت الحجز ${reservation.reservationNumber}.`,
      reservationNumber: reservation.reservationNumber,
      derived: true,
    });
  });

  /**
   * A no-show is a booking whose pickup date passed while it was still waiting
   * to be collected: never delivered, never cancelled, so nobody came.
   *
   * `overdue` has to be accepted here as well. The reservation layer projects
   * any past-due booking to `overdue`, including one that was never collected
   * in the first place, so filtering on pending/confirmed alone silently missed
   * every no-show older than its own return date — which is most of them.
   * A delivery record is the proof of collection, so its absence is the test.
   */
  const collectedReservationNumbers = new Set(
    deliveryRecords.filter((record) => record.deliveryDateTime).map((record) => record.reservationNumber),
  );
  const noShows = reservations.filter((reservation) => (
    ['pending', 'confirmed', 'overdue'].includes(reservation.status)
    && reservation.pickupDate < today
    && !collectedReservationNumbers.has(reservation.reservationNumber)
  ));
  noShows.forEach((reservation) => {
    events.push({
      kind: 'no_show',
      severity: 'severe',
      date: reservation.pickupDate,
      description: `لم تستلم الحجز ${reservation.reservationNumber} في موعده.`,
      reservationNumber: reservation.reservationNumber,
      derived: true,
    });
  });

  getConductNotesForCustomer(customer.id).forEach((note) => {
    events.push({
      kind: note.kind,
      severity: note.severity,
      date: note.recordedAt.slice(0, 10),
      description: `${note.note} — ${note.recordedBy}`,
      reservationNumber: note.reservationNumber,
      derived: false,
    });
  });

  const completedRentalCount = reservations.filter((reservation) => reservation.status === 'returned').length;
  const outstandingAmount = reservations
    .filter((reservation) => reservation.status !== 'cancelled')
    .reduce((total, reservation) => total + reservation.remainingAmount, 0);
  const totalPenalties = deliveryRecords.reduce((total, record) => total + record.lateFee + record.damageFee, 0);

  const lateReturnCount = lateRecords.length;
  const damageCount = damageRecords.length;
  const noShowCount = noShows.length;
  const cancellationCount = cancellations.length;

  /**
   * Reliability: starts perfect and is reduced by proven incidents, weighted by
   * how much each one actually costs the showroom. A no-show or damage hurts
   * far more than a cancellation made in advance.
   */
  const totalBookings = Math.max(reservations.length, 1);
  const penalty =
    (lateReturnCount * 12)
    + (damageCount * 20)
    + (noShowCount * 25)
    + (cancellationCount * 5)
    + getConductNotesForCustomer(customer.id).filter((note) => note.severity === 'severe').length * 15;
  // A long clean history should absorb one old mistake.
  const loyaltyCredit = Math.min(completedRentalCount * 3, 15);
  const reliabilityScore = Math.max(0, Math.min(100, 100 - Math.round((penalty / totalBookings) * 100 / 100 * totalBookings) + loyaltyCredit));

  const advisories: string[] = [];
  if (outstandingAmount > 0) advisories.push(`عليها مبلغ غير مسدد: ${formatMoneyOMR(outstandingAmount)}.`);
  if (noShowCount > 0) advisories.push(`لم تحضر لاستلام ${noShowCount} حجز سابق.`);
  if (damageCount > 0) advisories.push(`سُجل ${damageCount} تلف أو فقد على حجوزاتها.`);
  if (lateReturnCount >= 2) advisories.push(`تأخرت في الإرجاع ${lateReturnCount} مرات.`);
  if (customer.status === 'blocked') advisories.push('العميلة محظورة حالياً ولا يمكن إنشاء حجز لها.');

  let suggestedStatus: CustomerConduct['suggestedStatus'] = 'normal';
  if (noShowCount >= 2 || damageCount >= 2) suggestedStatus = 'blocked';
  else if (noShowCount >= 1 || damageCount >= 1 || lateReturnCount >= 2 || outstandingAmount > 0) suggestedStatus = 'warning';
  else if (completedRentalCount >= 3 && reliabilityScore >= 95) suggestedStatus = 'trusted';

  return {
    customerId: customer.id,
    lateReturnCount,
    damageCount,
    noShowCount,
    cancellationCount,
    completedRentalCount,
    outstandingAmount,
    totalPenalties,
    events: events.sort((left, right) => right.date.localeCompare(left.date)),
    reliabilityScore,
    advisories,
    suggestedStatus,
  };
}
