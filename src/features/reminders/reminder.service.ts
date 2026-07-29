import { generateId, readCollection, writeCollection } from '../../services/localDatabase';
import { addDaysISO, formatTimeLabel, getTodayISO } from '../../shared/utils/date';
import { recordAudit } from '../audit/audit.service';
import { getAccessoriesForReservation } from '../accessories/reservationAccessory.service';
import { getShowroomProfile } from '../preferences/showroomProfile.service';
import { getReservationTimes, getReservations } from '../reservations/reservation.service';
import { getReservationLines, isMultiItemReservation } from '../reservations/contractLineHelpers';
import type { Reservation } from '../reservations/reservation.types';
import { buildTemplateVariables, getMessageTemplates, renderTemplate } from './messageTemplates';
import type { Reminder, ReminderDismissal, ReminderKind, ReminderSummary } from './reminder.types';

/**
 * Customer reminders.
 *
 * A showroom loses money in four predictable ways: a customer forgets her
 * pickup, forgets to return, keeps an item past its date, or never settles her
 * balance. All four are visible in data the app already holds, so the app can
 * surface them instead of relying on someone remembering.
 *
 * Reminders are **derived, never stored**. Storing them would create a second
 * source of truth that drifts the moment a booking is changed or cancelled.
 * The only thing persisted is a dismissal: proof the operator already handled
 * one today.
 */

const DISMISSAL_COLLECTION = 'reminder-dismissals';

const ACTIVE_STATUSES = new Set<Reservation['status']>(['pending', 'confirmed', 'delivered', 'overdue']);

export const REMINDER_KIND_LABELS: Record<ReminderKind, string> = {
  pickup_tomorrow: 'تذكير بالاستلام غداً',
  return_tomorrow: 'تذكير بالإرجاع غداً',
  overdue_return: 'تأخر في الإرجاع',
  outstanding_balance: 'مبلغ غير مسدد',
};

function reminderId(reservationNumber: string, kind: ReminderKind): string {
  return `${kind}:${reservationNumber}`;
}

export function getReminderDismissals(): ReminderDismissal[] {
  return readCollection<ReminderDismissal>(DISMISSAL_COLLECTION, []);
}

/**
 * Records that a reminder was handled today.
 *
 * The business date is part of the record on purpose: an overdue item that is
 * still out tomorrow should be chased again, so yesterday's dismissal must not
 * silence it forever.
 */
export function dismissReminder(reminderRef: string, channel: ReminderDismissal['channel'] = 'manual'): ReminderDismissal {
  const businessDate = getTodayISO();
  const existing = getReminderDismissals();

  const alreadyDismissed = existing.find(
    (entry) => entry.reminderId === reminderRef && entry.businessDate === businessDate,
  );
  if (alreadyDismissed) return alreadyDismissed;

  const dismissal: ReminderDismissal = {
    id: generateId(),
    reminderId: reminderRef,
    dismissedAt: new Date().toISOString(),
    businessDate,
    channel,
  };

  // Keep the log bounded; only today's entries affect behaviour.
  const recent = existing.filter((entry) => entry.businessDate >= addDaysISO(businessDate, -30));
  writeCollection(DISMISSAL_COLLECTION, [dismissal, ...recent]);
  recordAudit({
    action: 'update',
    entityType: 'reservation',
    entityId: reminderRef,
    summary: `تمت متابعة التذكير ${reminderRef}${channel === 'whatsapp' ? ' عبر واتساب' : ''}.`,
    nextValues: { channel, businessDate },
  });
  return dismissal;
}

export function isReminderHandledToday(reminderRef: string): boolean {
  const businessDate = getTodayISO();
  return getReminderDismissals().some(
    (entry) => entry.reminderId === reminderRef && entry.businessDate === businessDate,
  );
}

/**
 * Renders a reminder from the showroom's own template.
 *
 * The four messages used to be hard-coded string concatenations here. They are
 * now content the owner edits in settings, so this function only gathers the
 * facts and hands them to the template renderer.
 */
function buildMessage(kind: ReminderKind, reservation: Reservation): string {
  const times = getReservationTimes(reservation);
  const accessoryNames = getAccessoriesForReservation(reservation.reservationNumber)
    .map((link) => link.accessoryNameSnapshot)
    .filter((name): name is string => Boolean(name));

  // For multi-item reservations, list all item names
  const lines = getReservationLines(reservation);
  const dressName = isMultiItemReservation(reservation)
    ? lines.map((line) => line.dressNameSnapshot).join('، ')
    : reservation.dressName;

  const variables = buildTemplateVariables({
    customerName: reservation.customerName,
    dressName,
    reservationNumber: reservation.reservationNumber,
    pickupDate: reservation.pickupDate,
    pickupTime: formatTimeLabel(times.pickupTime),
    returnDate: reservation.returnDate,
    returnTime: formatTimeLabel(times.returnTime),
    remainingAmount: reservation.remainingAmount,
    accessoryNames,
    brandName: getShowroomProfile().brandName,
  });

  return renderTemplate(getMessageTemplates()[kind], variables);
}

function createReminder(kind: ReminderKind, reservation: Reservation, urgency: Reminder['urgency'], dueDate: string): Reminder {
  return {
    id: reminderId(reservation.reservationNumber, kind),
    kind,
    urgency,
    reservation,
    customerName: reservation.customerName,
    customerPhone: reservation.customerPhone,
    title: REMINDER_KIND_LABELS[kind],
    message: buildMessage(kind, reservation),
    dueDate,
    amount: kind === 'outstanding_balance' ? reservation.remainingAmount : undefined,
  };
}

/**
 * Every reminder the showroom should act on today.
 *
 * `includeHandled` exists so the operator can review what was already sent,
 * rather than the list silently hiding work that was done.
 */
export function getReminders(includeHandled = false): Reminder[] {
  const today = getTodayISO();
  const tomorrow = addDaysISO(today, 1);
  const reservations = getReservations().filter((reservation) => ACTIVE_STATUSES.has(reservation.status));
  const reminders: Reminder[] = [];

  reservations.forEach((reservation) => {
    // Only a booking that has not yet been handed over can be reminded to collect.
    if (reservation.pickupDate === tomorrow && (reservation.status === 'pending' || reservation.status === 'confirmed')) {
      reminders.push(createReminder('pickup_tomorrow', reservation, 'info', tomorrow));
    }

    if (reservation.returnDate === tomorrow && reservation.status === 'delivered') {
      reminders.push(createReminder('return_tomorrow', reservation, 'warning', tomorrow));
    }

    if (reservation.status === 'overdue') {
      reminders.push(createReminder('overdue_return', reservation, 'critical', reservation.returnDate));
    }

    if (reservation.remainingAmount > 0) {
      // Money owed on a finished rental is the urgent case; on a future booking
      // it is merely informational.
      const isPastDue = reservation.returnDate < today;
      reminders.push(createReminder(
        'outstanding_balance',
        reservation,
        isPastDue ? 'critical' : 'info',
        reservation.returnDate,
      ));
    }
  });

  const visible = includeHandled ? reminders : reminders.filter((reminder) => !isReminderHandledToday(reminder.id));

  const urgencyRank = { critical: 0, warning: 1, info: 2 } as const;
  return visible.sort((left, right) =>
    urgencyRank[left.urgency] - urgencyRank[right.urgency] || left.dueDate.localeCompare(right.dueDate));
}

export function summarizeReminders(reminders: Reminder[]): ReminderSummary {
  return {
    total: reminders.length,
    critical: reminders.filter((reminder) => reminder.urgency === 'critical').length,
    pickupTomorrow: reminders.filter((reminder) => reminder.kind === 'pickup_tomorrow').length,
    returnTomorrow: reminders.filter((reminder) => reminder.kind === 'return_tomorrow').length,
    overdue: reminders.filter((reminder) => reminder.kind === 'overdue_return').length,
    unpaid: reminders.filter((reminder) => reminder.kind === 'outstanding_balance').length,
  };
}

/** A free-form message to one customer, used by the contact button. */
export function buildCustomerMessage(customerName: string, body: string): string {
  return `مرحباً ${customerName}،\n${body}\n\n${getShowroomProfile().brandName}`;
}
