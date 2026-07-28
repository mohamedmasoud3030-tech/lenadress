import { readCollection, writeCollection } from '../../services/localDatabase';

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
};

export const MAX_BUFFER_DAYS = 14;

function normalizeBufferDays(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_BUFFER_DAYS ? parsed : fallback;
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

  writeCollection(COLLECTION, [normalized]);
  return normalized;
}
