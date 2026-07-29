import type { Reservation } from '../reservations/reservation.types';

/**
 * Why a customer needs to be contacted.
 *
 * These are the four moments a rental showroom actually loses money or goodwill
 * by staying silent.
 */
export type ReminderKind =
  /** Her pickup is tomorrow — reduces no-shows. */
  | 'pickup_tomorrow'
  /** Her return is due tomorrow — reduces late returns. */
  | 'return_tomorrow'
  /** The return date has passed and the item is still out. */
  | 'overdue_return'
  /** Money is still owed on the booking. */
  | 'outstanding_balance';

export type ReminderUrgency = 'info' | 'warning' | 'critical';

export type Reminder = {
  /** Stable per reservation and kind, so a dismissal can be remembered. */
  id: string;
  kind: ReminderKind;
  urgency: ReminderUrgency;
  reservation: Reservation;
  customerName: string;
  customerPhone: string;
  title: string;
  /** The ready-to-send Arabic message. */
  message: string;
  /** ISO date the reminder concerns, used for ordering. */
  dueDate: string;
  amount?: number;
};

export type ReminderSummary = {
  total: number;
  critical: number;
  pickupTomorrow: number;
  returnTomorrow: number;
  overdue: number;
  unpaid: number;
};

/** A reminder the operator has already acted on, so it stops reappearing. */
export type ReminderDismissal = {
  id: string;
  reminderId: string;
  dismissedAt: string;
  /** The date the dismissal applies to; a new day re-raises the reminder. */
  businessDate: string;
  channel?: 'whatsapp' | 'manual';
};
