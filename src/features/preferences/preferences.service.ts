import { readCollection, writeCollection } from '../../services/localDatabase';
import { recordAudit } from '../audit/audit.service';

export type AppPreferences = {
  showroomName: string;
  /**
   * Legacy single buffer. Kept because existing installations store it and the
   * service queue still reads one symmetric value. New code should use
   * `preparationDaysBeforePickup` / `cleaningDaysAfterReturn`.
   */
  reservationBufferDays: number;
  /** Preparation days blocked before a pickup. */
  preparationDaysBeforePickup: number;
  /** Cleaning days blocked after a return. */
  cleaningDaysAfterReturn: number;
  /** Default pickup time used when a reservation carries no explicit time. */
  defaultPickupTime: string;
  /** Default return time used when a reservation carries no explicit time. */
  defaultReturnTime: string;
  dormantDressDays: number;
  /**
   * Late-fee policy.
   *
   * The late fee was a blank number field, so every operator improvised and
   * roughly half of all late returns were charged nothing at all. The system
   * now proposes a figure and the operator may still override it: an automatic
   * non-negotiable charge would be wrong, because waiving a fee for a good
   * customer is a legitimate commercial decision the showroom must keep.
   */
  lateFeePolicy: LateFeePolicy;
};

export type LateFeeMode = 'none' | 'fixed_per_day' | 'percent_of_rental_per_day';

export type LateFeePolicy = {
  mode: LateFeeMode;
  /** OMR per late day when the mode is `fixed_per_day`. */
  amountPerDay: number;
  /** Percentage of the agreed rental per late day, 0..100. */
  percentPerDay: number;
  /**
   * Days of lateness forgiven before anything is charged. A customer returning
   * an hour after closing is not the case a late fee exists for.
   */
  graceDays: number;
  /**
   * Upper bound as a percentage of the agreed rental, 0 meaning uncapped. A
   * month-late return would otherwise compute a fee larger than the dress.
   */
  maxPercentOfRental: number;
};

const COLLECTION = 'preferences';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  showroomName: 'LENA',
  reservationBufferDays: 1,
  preparationDaysBeforePickup: 1,
  cleaningDaysAfterReturn: 1,
  defaultPickupTime: '10:00',
  defaultReturnTime: '20:00',
  dormantDressDays: 90,
  lateFeePolicy: {
    // Off by default: a showroom must opt into charging, and inventing a rate
    // on the operator's behalf would put a number on a real invoice that
    // nobody agreed to.
    mode: 'none',
    amountPerDay: 0,
    percentPerDay: 10,
    graceDays: 0,
    maxPercentOfRental: 100,
  },
};

export const MAX_BUFFER_DAYS = 14;

function normalizeBufferDays(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_BUFFER_DAYS ? parsed : fallback;
}

const LATE_FEE_MODES: LateFeeMode[] = ['none', 'fixed_per_day', 'percent_of_rental_per_day'];

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function normalizeLateFeePolicy(value: unknown): LateFeePolicy {
  const fallback = DEFAULT_APP_PREFERENCES.lateFeePolicy;
  const input = (value ?? {}) as Partial<LateFeePolicy>;
  const mode = LATE_FEE_MODES.includes(input.mode as LateFeeMode) ? (input.mode as LateFeeMode) : fallback.mode;

  return {
    mode,
    amountPerDay: clampNumber(input.amountPerDay, fallback.amountPerDay, 0, 10_000),
    percentPerDay: clampNumber(input.percentPerDay, fallback.percentPerDay, 0, 100),
    graceDays: Math.round(clampNumber(input.graceDays, fallback.graceDays, 0, 30)),
    maxPercentOfRental: clampNumber(input.maxPercentOfRental, fallback.maxPercentOfRental, 0, 1000),
  };
}

export function isValidTimeValue(value: unknown): value is string {
  return typeof value === 'string' && TIME_PATTERN.test(value);
}

function normalizeTime(value: unknown, fallback: string): string {
  return isValidTimeValue(value) ? value : fallback;
}

function normalizePreferences(value?: Partial<AppPreferences>): AppPreferences {
  const reservationBufferDays = normalizeBufferDays(
    value?.reservationBufferDays,
    DEFAULT_APP_PREFERENCES.reservationBufferDays,
  );
  const dormantDressDays = Number(value?.dormantDressDays ?? DEFAULT_APP_PREFERENCES.dormantDressDays);

  return {
    showroomName: value?.showroomName?.trim() || DEFAULT_APP_PREFERENCES.showroomName,
    reservationBufferDays,
    // Installations created before the split inherit the single legacy buffer,
    // so upgrading never silently changes which periods are blocked.
    preparationDaysBeforePickup: normalizeBufferDays(value?.preparationDaysBeforePickup, reservationBufferDays),
    cleaningDaysAfterReturn: normalizeBufferDays(value?.cleaningDaysAfterReturn, reservationBufferDays),
    defaultPickupTime: normalizeTime(value?.defaultPickupTime, DEFAULT_APP_PREFERENCES.defaultPickupTime),
    defaultReturnTime: normalizeTime(value?.defaultReturnTime, DEFAULT_APP_PREFERENCES.defaultReturnTime),
    dormantDressDays:
      Number.isInteger(dormantDressDays) && dormantDressDays >= 1 && dormantDressDays <= 3650
        ? dormantDressDays
        : DEFAULT_APP_PREFERENCES.dormantDressDays,
    lateFeePolicy: normalizeLateFeePolicy(value?.lateFeePolicy),
  };
}

export function getAppPreferences(): AppPreferences {
  return normalizePreferences(readCollection<Partial<AppPreferences>>(COLLECTION, [DEFAULT_APP_PREFERENCES])[0]);
}

export function saveAppPreferences(input: AppPreferences): AppPreferences {
  const normalized = normalizePreferences(input);
  if (!input.showroomName.trim()) throw new Error('اسم المعرض مطلوب.');
  if (!Number.isInteger(input.reservationBufferDays) || input.reservationBufferDays < 0 || input.reservationBufferDays > MAX_BUFFER_DAYS) {
    throw new Error('أيام الفاصل الزمني للحجز يجب أن تكون رقماً بين 0 و 14.');
  }
  if (!Number.isInteger(input.preparationDaysBeforePickup) || input.preparationDaysBeforePickup < 0 || input.preparationDaysBeforePickup > MAX_BUFFER_DAYS) {
    throw new Error('مدة التجهيز قبل التسليم يجب أن تكون رقماً بين 0 و 14 يوماً.');
  }
  if (!Number.isInteger(input.cleaningDaysAfterReturn) || input.cleaningDaysAfterReturn < 0 || input.cleaningDaysAfterReturn > MAX_BUFFER_DAYS) {
    throw new Error('مدة التنظيف بعد الإرجاع يجب أن تكون رقماً بين 0 و 14 يوماً.');
  }
  if (!isValidTimeValue(input.defaultPickupTime) || !isValidTimeValue(input.defaultReturnTime)) {
    throw new Error('أوقات الاستلام والإرجاع الافتراضية يجب أن تكون بصيغة HH:MM صحيحة.');
  }
  if (!Number.isInteger(input.dormantDressDays) || input.dormantDressDays < 1 || input.dormantDressDays > 3650) {
    throw new Error('أيام اعتبار العنصر خاملاً يجب أن تكون رقماً موجباً.');
  }
  const policy = input.lateFeePolicy;
  if (policy) {
    if (!LATE_FEE_MODES.includes(policy.mode)) throw new Error('طريقة احتساب رسوم التأخير غير معروفة.');
    if (policy.mode === 'fixed_per_day' && !(policy.amountPerDay > 0)) {
      throw new Error('حددي قيمة رسوم التأخير اليومية قبل تفعيل الاحتساب الثابت.');
    }
    if (policy.mode === 'percent_of_rental_per_day' && !(policy.percentPerDay > 0)) {
      throw new Error('حددي نسبة رسوم التأخير اليومية قبل تفعيل الاحتساب بالنسبة.');
    }
  }

  writeCollection(COLLECTION, [normalized]);
  recordAudit({
    action: 'update',
    entityType: 'preferences',
    entityId: 'operational-preferences',
    summary: 'تم تحديث إعدادات تشغيل المعرض.',
    nextValues: {
      preparationDaysBeforePickup: normalized.preparationDaysBeforePickup,
      cleaningDaysAfterReturn: normalized.cleaningDaysAfterReturn,
      defaultPickupTime: normalized.defaultPickupTime,
      defaultReturnTime: normalized.defaultReturnTime,
      dormantDressDays: normalized.dormantDressDays,
      lateFeeMode: normalized.lateFeePolicy.mode,
    },
  });
  return normalized;
}
