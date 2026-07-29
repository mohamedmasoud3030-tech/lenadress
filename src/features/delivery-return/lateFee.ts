import { parseLocalDate } from '../../shared/utils/date';
import { getAppPreferences } from '../preferences/preferences.service';
import type { LateFeePolicy } from '../preferences/preferences.service';
import type { Reservation } from '../reservations/reservation.types';

/**
 * Late-fee suggestion.
 *
 * The late fee was a blank number field on the return form. Every operator
 * improvised, so identical delays produced different charges, and roughly half
 * of all late returns were charged nothing because nobody remembered to work
 * the number out with a customer standing at the counter.
 *
 * This computes a defensible figure from the configured policy and shows how it
 * was reached. It deliberately **suggests** rather than imposes: waiving a fee
 * for a good customer is a legitimate commercial decision, and an automatic
 * uneditable charge would put a number on a real invoice that neither party
 * agreed to. The operator can always overwrite it.
 *
 * Rejected alternatives:
 *   - Charging automatically on the overdue projection, with no return event:
 *     the app already projects a booking to `overdue` from the calendar alone,
 *     but money must only move on a real, witnessed handover.
 *   - Hour-level proration: showrooms here settle in whole days, and an hourly
 *     fee invites an argument about the exact minute the customer walked in.
 */

export type LateFeeSuggestion = {
  /** Whole days past the agreed return date, before any grace. */
  lateDays: number;
  /** Days actually charged, after the grace allowance. */
  chargeableDays: number;
  amount: number;
  /** True when the cap reduced the computed figure. */
  capped: boolean;
  /** Arabic explanation shown next to the field. */
  explanation: string;
};

const NO_FEE: LateFeeSuggestion = {
  lateDays: 0,
  chargeableDays: 0,
  amount: 0,
  capped: false,
  explanation: 'لا توجد أيام تأخير.',
};

/** Whole calendar days between the agreed return and the actual one, local time. */
export function countLateDays(agreedReturnDate: string, actualReturnDateTime: string): number {
  if (!agreedReturnDate || !actualReturnDateTime) return 0;

  const agreed = parseLocalDate(agreedReturnDate);
  const actualDatePart = actualReturnDateTime.slice(0, 10);
  const actual = parseLocalDate(actualDatePart);

  const difference = Math.round((actual.getTime() - agreed.getTime()) / 86_400_000);
  return Math.max(difference, 0);
}

/**
 * Rounds money to three decimals, the Omani rial's subdivision.
 *
 * Percentage arithmetic routinely produces values like 8.000000000000002, and
 * a figure that ugly on a printed invoice undermines the operator's credibility
 * even when it is arithmetically correct.
 */
function roundMoney(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function suggestLateFee(
  reservation: Pick<Reservation, 'returnDate' | 'rentalPrice'>,
  actualReturnDateTime: string,
  policy: LateFeePolicy = getAppPreferences().lateFeePolicy,
): LateFeeSuggestion {
  const lateDays = countLateDays(reservation.returnDate, actualReturnDateTime);
  if (lateDays === 0) return NO_FEE;

  // An unrecognised mode is treated exactly like `none`. A stored policy can
  // come from a hand-edited backup or a newer version of the app, and falling
  // through to a charging branch would invent money from a value nobody
  // understood.
  if (policy.mode !== 'fixed_per_day' && policy.mode !== 'percent_of_rental_per_day') {
    return {
      lateDays,
      chargeableDays: 0,
      amount: 0,
      capped: false,
      explanation: `تأخير ${lateDays} يوم. لم يتم تفعيل سياسة رسوم التأخير في الإعدادات.`,
    };
  }

  const chargeableDays = Math.max(lateDays - policy.graceDays, 0);
  if (chargeableDays === 0) {
    return {
      lateDays,
      chargeableDays: 0,
      amount: 0,
      capped: false,
      explanation: `تأخير ${lateDays} يوم، ضمن مهلة السماح (${policy.graceDays} يوم).`,
    };
  }

  const rentalPrice = Math.max(reservation.rentalPrice ?? 0, 0);
  const perDay = policy.mode === 'fixed_per_day'
    ? policy.amountPerDay
    : (rentalPrice * policy.percentPerDay) / 100;

  const raw = perDay * chargeableDays;
  const cap = policy.maxPercentOfRental > 0 ? (rentalPrice * policy.maxPercentOfRental) / 100 : Number.POSITIVE_INFINITY;
  const amount = roundMoney(Math.min(raw, cap));
  const capped = raw > cap;

  const basis = policy.mode === 'fixed_per_day'
    ? `${roundMoney(policy.amountPerDay)} ر.ع لكل يوم`
    : `${policy.percentPerDay}% من قيمة الإيجار لكل يوم`;

  const graceNote = policy.graceDays > 0 ? ` بعد خصم مهلة ${policy.graceDays} يوم` : '';
  const capNote = capped ? ` (تم تطبيق الحد الأقصى ${policy.maxPercentOfRental}% من قيمة الإيجار)` : '';

  return {
    lateDays,
    chargeableDays,
    amount,
    capped,
    explanation: `تأخير ${lateDays} يوم${graceNote} × ${basis} = ${roundMoney(amount)} ر.ع${capNote}. يمكنك تعديل القيمة.`,
  };
}
