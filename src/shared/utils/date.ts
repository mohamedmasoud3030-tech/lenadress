export function getTodayISO(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return year + '-' + month + '-' + day;
}

/**
 * Parses an ISO date (`YYYY-MM-DD`) in the **local** timezone.
 *
 * `new Date('2026-07-28')` is parsed as UTC by the platform, which shifts the
 * day backwards or forwards for showrooms east or west of UTC and made calendar
 * cells land on the wrong date. Every date-only value in the app must go
 * through here.
 */
export function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map((part) => Number.parseInt(part, 10));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    throw new Error('قيمة التاريخ غير صالحة.');
  }
  return new Date(year, month - 1, day);
}

export function addDaysISO(value: string, days: number): string {
  const date = parseLocalDate(value);
  date.setDate(date.getDate() + days);
  return getTodayISO(date);
}

/** Whole days from `from` to `to`, computed on local calendar days. */
export function differenceInDays(from: string, to: string): number {
  const start = parseLocalDate(from);
  const end = parseLocalDate(to);
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

/** Inclusive list of ISO dates between two ISO dates, in local time. */
export function eachDayISO(from: string, to: string): string[] {
  if (to < from) return [];
  const days: string[] = [];
  const cursor = parseLocalDate(from);
  const end = parseLocalDate(to);
  while (cursor.getTime() <= end.getTime()) {
    days.push(getTodayISO(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTime(value: string | undefined): value is string {
  return typeof value === 'string' && TIME_PATTERN.test(value);
}

/** Arabic 12-hour label for a stored `HH:MM` value. */
export function formatTimeLabel(value: string | undefined, fallback = '—'): string {
  if (!isValidTime(value)) return fallback;
  const [hourText, minuteText] = value.split(':');
  const hour = Number.parseInt(hourText, 10);
  const suffix = hour < 12 ? 'ص' : 'م';
  const displayHour = hour % 12 === 0 ? 12 : hour % 12;
  return `${displayHour}:${minuteText} ${suffix}`;
}

/** Extracts the local `HH:MM` part of a stored datetime-local or ISO value. */
export function extractTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /T(\d{2}:\d{2})/.exec(value);
  return match && isValidTime(match[1]) ? match[1] : undefined;
}
