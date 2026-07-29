/**
 * Customer conduct.
 *
 * The customer record only ever held a status flag (`normal`, `trusted`,
 * `warning`, `blocked`) with no reason attached and no history. So the operator
 * could see that someone was blocked, but not why, when, or by whom — and could
 * not see that a customer had been late three times until she was already
 * standing at the counter asking for a fourth booking.
 *
 * Conduct is **derived from the operational history** wherever possible: late
 * returns, damage charges, cancellations and outstanding balances are facts the
 * app already records. Only the deliberate judgements — a manual warning, a
 * block, a note — are stored, and each one keeps its reason and its author.
 */

export type ConductFlagKind =
  /** Returned an item after its due date. */
  | 'late_return'
  /** A damage or loss charge was assessed on her rental. */
  | 'damage'
  /** Did not collect a confirmed booking. */
  | 'no_show'
  /** Cancelled a confirmed booking. */
  | 'cancellation'
  /** An operator recorded a concern manually. */
  | 'manual_note';

export type ConductSeverity = 'positive' | 'neutral' | 'warning' | 'severe';

/** A manually recorded judgement about a customer. */
export type ConductNote = {
  id: string;
  customerId: string;
  kind: ConductFlagKind;
  severity: ConductSeverity;
  note: string;
  /** Reservation the note refers to, when there is one. */
  reservationNumber?: string;
  recordedAt: string;
  /** Operator who recorded it, so a judgement is never anonymous. */
  recordedBy: string;
};

/** One derived or recorded event on the customer's record. */
export type ConductEvent = {
  kind: ConductFlagKind;
  severity: ConductSeverity;
  date: string;
  description: string;
  reservationNumber?: string;
  amount?: number;
  /** True when the event was derived from history rather than typed. */
  derived: boolean;
};

export type CustomerConduct = {
  customerId: string;
  lateReturnCount: number;
  damageCount: number;
  noShowCount: number;
  cancellationCount: number;
  completedRentalCount: number;
  /** Money still owed across every open booking. */
  outstandingAmount: number;
  /** Total damage and late fees this customer has been charged. */
  totalPenalties: number;
  events: ConductEvent[];
  /** 0–100, higher is better. Derived, never stored. */
  reliabilityScore: number;
  /** What the operator should know before booking again. */
  advisories: string[];
  /** Recommended status based on the record; the operator still decides. */
  suggestedStatus: 'trusted' | 'normal' | 'warning' | 'blocked';
};
