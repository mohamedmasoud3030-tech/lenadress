import { useEffect, useId, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from '../../components/shared/Modal';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';
import { DEFAULT_RESERVATION_DAYS, MAX_NOTES_LENGTH, MIN_ZERO_AMOUNT, MONEY_STEP } from '../../shared/domain/businessRules';
import { FORM_ERROR_CLASS_NAME, FORM_FIELD_CLASS_NAME, FORM_LABEL_CLASS_NAME } from '../../shared/domain/formConstants';
import { getTodayISO } from '../../shared/utils/date';
import { formatMoneyOMR } from '../../shared/utils/format';
import { getCustomers } from '../customers/customer.service';
import type { Customer } from '../customers/customer.types';
import { getDresses } from '../dresses/dress.service';
import { getBookablePieces } from '../dresses/design.service';
import type { Dress } from '../dresses/dress.types';
import { getDressSecurityDepositAmount } from '../dresses/dress.types';
import { SearchableSelect, type SearchableOption } from '../../components/shared/SearchableSelect';
import { createReservationCommand } from '../workflows';
import { getReservationTimeDefaults } from './reservation.service';
import { getBufferSettings } from './reservationConflicts';
import type { Reservation, CreateReservationLineInput } from './reservation.types';
import { createSubmissionKey } from '../../shared/utils/submissionKey';
import { Stepper, useStepper } from '../../components/shared/Stepper';

const reservationSchema = z.object({
  customerId: z.string().min(1, 'اختاري العميلة.'),
  pickupDate: z.string().min(1, 'حددي تاريخ الاستلام.'),
  pickupTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'وقت الاستلام غير صالح.'),
  returnDate: z.string().min(1, 'حددي تاريخ الإرجاع.'),
  returnTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'وقت الإرجاع غير صالح.'),
  notes: z.string().max(MAX_NOTES_LENGTH, `الملاحظات يجب ألا تتجاوز ${MAX_NOTES_LENGTH} حرف.`).optional(),
});

type ReservationFormValues = z.infer<typeof reservationSchema>;

type LineEntry = {
  key: string;
  dressId: string;
  rentalPrice: string;
  securityDepositAmount: string;
  bookingAdvanceAmount: string;
};

type CreateReservationModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated: (reservation: Reservation) => void;
  prefill?: { dressCode?: string; pickupDate?: string; returnDate?: string };
};

function addDays(dateValue: string, days: number): string {
  const date = new Date(`${dateValue}T00:00:00`);
  date.setDate(date.getDate() + days);
  return getTodayISO(date);
}

function getDefaultValues(): ReservationFormValues {
  const today = getTodayISO();
  const times = getReservationTimeDefaults();
  return {
    customerId: '',
    pickupDate: today,
    pickupTime: times.pickupTime,
    returnDate: addDays(today, DEFAULT_RESERVATION_DAYS),
    returnTime: times.returnTime,
    notes: '',
  };
}

const reservableDressStatuses = new Set(['available', 'reserved', 'rented']);

function getReservableDresses(): Dress[] {
  return getDresses().filter((dress) => dress.isForRent && reservableDressStatuses.has(dress.status));
}

let lineKeyCounter = 0;
function nextLineKey() { return `line-${++lineKeyCounter}`; }

export function CreateReservationModal({ open, onClose, onCreated, prefill }: CreateReservationModalProps) {
  const fieldId = useId();
  const [submitError, setSubmitError] = useState<unknown>(null);
  const { current: currentStep, next: nextStep, prev: prevStep, goTo: goToStep } = useStepper(4);
  const steps = [
    { id: 'customer', label: 'العميلة', description: 'اختيار العميلة' },
    { id: 'dates', label: 'التواريخ', description: 'الاستلام والإرجاع' },
    { id: 'items', label: 'القطع', description: 'اختيار الفساتين' },
    { id: 'summary', label: 'الملخص', description: 'المراجعة والدفع' },
  ];
  const [submissionKey] = useState(() => createSubmissionKey('rsv'));
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [dresses, setDresses] = useState<Dress[]>([]);
  const [lines, setLines] = useState<LineEntry[]>([]);
  const bufferDays = getBufferSettings();

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<ReservationFormValues>({
    resolver: zodResolver(reservationSchema),
    defaultValues: getDefaultValues(),
  });

  const pickupDate = watch('pickupDate');
  const returnDate = watch('returnDate');

  const period = useMemo(
    () => (pickupDate && returnDate && returnDate > pickupDate ? { pickupDate, returnDate } : undefined),
    [pickupDate, returnDate],
  );

  const customerOptions = useMemo<SearchableOption[]>(() => customers.map((customer) => ({
    value: customer.id,
    label: customer.name,
    hint: customer.phone,
    disabled: customer.status === 'blocked',
    disabledReason: 'عميلة محظورة — سوّي حالتها أولاً.',
  })), [customers]);

  const dressOptions = useMemo<SearchableOption[]>(() => {
    const source = period
      ? getBookablePieces('', period).filter((dress) => dress.isForRent && reservableDressStatuses.has(dress.status))
      : dresses;
    return source.map((dress) => ({
      value: dress.id,
      label: `${dress.code} — ${dress.name}`,
      hint: `${dress.size} · ${dress.color}${dress.designCode ? ` · ${dress.designCode}` : ''}`,
      badge: formatMoneyOMR(dress.rentalPrice),
    }));
  }, [dresses, period]);

  // ── Computed totals ──────────────────────────────────────────────────
  const rentalTotal = useMemo(() => {
    return lines.reduce((sum, entry) => {
      const dress = dresses.find((d) => d.id === entry.dressId);
      const rental = Number(entry.rentalPrice) || dress?.rentalPrice || 0;
      return sum + rental;
    }, 0);
  }, [lines, dresses]);

  const securityDepositTotal = useMemo(() => {
    return lines.reduce((sum, entry) => {
      const deposit = Number(entry.securityDepositAmount) || 0;
      return sum + deposit;
    }, 0);
  }, [lines]);

  const bookingAdvanceTotal = useMemo(() => {
    return lines.reduce((sum, entry) => {
      const adv = Number(entry.bookingAdvanceAmount) || 0;
      return sum + adv;
    }, 0);
  }, [lines]);

  const cashToCollectToday = useMemo(() => rentalTotal + securityDepositTotal, [rentalTotal, securityDepositTotal]);
  const remainingRentalAfterBooking = useMemo(() => Math.max(rentalTotal - bookingAdvanceTotal, 0), [rentalTotal, bookingAdvanceTotal]);

  const totalDiscount = useMemo(() => {
    return lines.reduce((sum, entry) => {
      const dress = dresses.find((d) => d.id === entry.dressId);
      if (!dress) return sum;
      const rental = Number(entry.rentalPrice) || 0;
      return sum + Math.max(dress.rentalPrice - rental, 0);
    }, 0);
  }, [lines, dresses]);

  // ── Line management ──────────────────────────────────────────────────
  const addLine = () => {
    setLines((current) => [...current, { key: nextLineKey(), dressId: '', rentalPrice: '', securityDepositAmount: '', bookingAdvanceAmount: '' }]);
  };

  const removeLine = (key: string) => {
    setLines((current) => current.length <= 1 ? current : current.filter((l) => l.key !== key));
  };

  const updateLine = (key: string, updates: Partial<LineEntry>) => {
    setLines((current) => current.map((l) => l.key === key ? { ...l, ...updates } : l));
  };

  // ── Initialize ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    try {
      setCustomers(getCustomers());
      const reservable = getReservableDresses();
      setDresses(reservable);

      const defaults = getDefaultValues();
      const prefilledDress = prefill?.dressCode
        ? reservable.find((dress) => dress.code === prefill.dressCode)
        : undefined;

      reset({
        ...defaults,
        pickupDate: prefill?.pickupDate || defaults.pickupDate,
        returnDate: prefill?.returnDate || defaults.returnDate,
      });

      if (prefilledDress) {
        setLines([{
          key: nextLineKey(),
          dressId: prefilledDress.id,
          rentalPrice: String(prefilledDress.rentalPrice),
          securityDepositAmount: String(getDressSecurityDepositAmount(prefilledDress)),
          bookingAdvanceAmount: '0',
        }]);
      } else {
        setLines([]);
      }

      setSubmitError(null);
    } catch (error: unknown) {
      setSubmitError(error);
    }
  }, [open, reset, prefill?.dressCode, prefill?.pickupDate, prefill?.returnDate]);

  // Auto-fill rental price and security deposit when a dress is selected
  useEffect(() => {
    lines.forEach((entry) => {
      if (!entry.dressId) return;
      const dress = dresses.find((d) => d.id === entry.dressId);
      if (dress) {
        if (!entry.rentalPrice) {
          updateLine(entry.key, { rentalPrice: String(dress.rentalPrice) });
        }
        if (!entry.securityDepositAmount) {
          updateLine(entry.key, { securityDepositAmount: String(getDressSecurityDepositAmount(dress)) });
        }
      }
    });
  }, [lines, dresses]);

  const closeModal = () => {
    setSubmitError(null);
    setLines([]);
    onClose();
  };

  const onSubmit = (formValues: ReservationFormValues) => {
    if (lines.length === 0 || lines.every((l) => !l.dressId)) {
      setSubmitError('اختاري قطعة واحدة على الأقل.');
      return;
    }

    const validLines = lines.filter((l) => l.dressId);
    const lineInputs: CreateReservationLineInput[] = validLines.map((entry) => {
      const dress = dresses.find((d) => d.id === entry.dressId);
      const rentalPrice = Number(entry.rentalPrice) || dress?.rentalPrice || 0;
      const securityDepositAmount = Number(entry.securityDepositAmount) || 0;
      const bookingAdvanceAmount = Number(entry.bookingAdvanceAmount) || 0;
      return {
        dressId: entry.dressId,
        pickupDate: formValues.pickupDate,
        pickupTime: formValues.pickupTime,
        returnDate: formValues.returnDate,
        returnTime: formValues.returnTime,
        rentalPrice,
        securityDepositAmount,
        bookingAdvanceAmount,
      };
    });

    try {
      const reservation = createReservationCommand({
        customerId: formValues.customerId,
        pickupDate: formValues.pickupDate,
        pickupTime: formValues.pickupTime,
        returnDate: formValues.returnDate,
        returnTime: formValues.returnTime,
        depositAmount: 0, // legacy compat
        securityDepositAmount: securityDepositTotal,
        bookingAdvanceAmount: bookingAdvanceTotal,
        rentalPrice: 0, // Per-line pricing
        notes: formValues.notes,
        lines: lineInputs,
        idempotencyKey: submissionKey,
      });
      onCreated(reservation);
      closeModal();
    } catch (error: unknown) {
      setSubmitError(error);
    }
  };

  return (
    <Modal open={open} onClose={closeModal} title="حجز جديد">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        {submitError !== null && (
          <UserFacingErrorAlert error={submitError} fallback="تعذر إنشاء الحجز. حاولي مرة أخرى." />
        )}

        <SearchableSelect
          label="العميلة"
          required
          value={watch('customerId')}
          onChange={(customerId) => setValue('customerId', customerId, { shouldValidate: true })}
          options={customerOptions}
          placeholder="اختاري العميلة"
          searchPlaceholder="ابحثي بالاسم أو رقم الهاتف…"
          error={errors.customerId?.message}
          unavailableText="لا توجد عميلات مسجلات بعد."
        />

        <fieldset className="grid gap-4 md:grid-cols-2">
          <legend className="sr-only">فترة الحجز وأوقاتها</legend>
          <div>
            <label htmlFor={`${fieldId}-pickup`} className={FORM_LABEL_CLASS_NAME}>تاريخ الاستلام</label>
            <input id={`${fieldId}-pickup`} type="date" min={getTodayISO()} {...register('pickupDate')} className={FORM_FIELD_CLASS_NAME} />
            {errors.pickupDate && <p className={FORM_ERROR_CLASS_NAME}>{errors.pickupDate.message}</p>}
          </div>
          <div>
            <label htmlFor={`${fieldId}-pickup-time`} className={FORM_LABEL_CLASS_NAME}>وقت الاستلام</label>
            <input id={`${fieldId}-pickup-time`} type="time" {...register('pickupTime')} className={FORM_FIELD_CLASS_NAME} />
            {errors.pickupTime && <p className={FORM_ERROR_CLASS_NAME}>{errors.pickupTime.message}</p>}
          </div>
          <div>
            <label htmlFor={`${fieldId}-return`} className={FORM_LABEL_CLASS_NAME}>تاريخ الإرجاع</label>
            <input id={`${fieldId}-return`} type="date" min={getTodayISO()} {...register('returnDate')} className={FORM_FIELD_CLASS_NAME} />
            {errors.returnDate && <p className={FORM_ERROR_CLASS_NAME}>{errors.returnDate.message}</p>}
          </div>
          <div>
            <label htmlFor={`${fieldId}-return-time`} className={FORM_LABEL_CLASS_NAME}>وقت الإرجاع</label>
            <input id={`${fieldId}-return-time`} type="time" {...register('returnTime')} className={FORM_FIELD_CLASS_NAME} />
            {errors.returnTime && <p className={FORM_ERROR_CLASS_NAME}>{errors.returnTime.message}</p>}
          </div>
        </fieldset>

        <p className="rounded-xl bg-stone-50 px-3 py-2 text-xs leading-5 text-slate-600">
          يتم حجز مدة التجهيز قبل التسليم ({bufferDays.preparationDaysBeforePickup} يوم) ومدة التنظيف بعد الإرجاع ({bufferDays.cleaningDaysAfterReturn} يوم) تلقائياً، ولا يمكن حجز نفس العنصر خلالها.
        </p>

        {/* ── Contract Lines ─────────────────────────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-800">القطع</h3>
            <button
              type="button"
              onClick={addLine}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-xl bg-slate-950 px-3 text-xs font-bold text-white transition hover:bg-slate-800"
            >
              <Plus aria-hidden="true" className="h-3.5 w-3.5" />
              إضافة قطعة
            </button>
          </div>

          {lines.length === 0 && (
            <p className="rounded-xl border border-dashed border-slate-300 bg-stone-50 p-4 text-center text-sm text-slate-500">
              لم يتم إضافة قطع بعد. اضغطي "إضافة قطعة" لبدء العقد.
            </p>
          )}

          {lines.map((entry) => {
            const selectedDress = dresses.find((d) => d.id === entry.dressId);
            const discount = selectedDress ? Math.max(selectedDress.rentalPrice - (Number(entry.rentalPrice) || 0), 0) : 0;

            return (
              <div key={entry.key} className="rounded-2xl border border-slate-200 bg-white p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <SearchableSelect
                      label="القطعة"
                      required
                      value={entry.dressId}
                      onChange={(dressId) => {
                        const dress = dresses.find((d) => d.id === dressId);
                        updateLine(entry.key, {
                          dressId,
                          rentalPrice: dress ? String(dress.rentalPrice) : '',
                          securityDepositAmount: dress ? String(getDressSecurityDepositAmount(dress)) : '0',
                          bookingAdvanceAmount: '0',
                        });
                      }}
                      options={dressOptions}
                      placeholder="اختاري القطعة"
                      searchPlaceholder="ابحثي بالكود أو الاسم…"
                      unavailableText="لا توجد فساتين مؤهلة للإيجار حالياً."
                    />
                  </div>
                  {lines.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeLine(entry.key)}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-500 transition hover:bg-rose-50 hover:text-rose-700"
                      aria-label="حذف القطعة"
                    >
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {selectedDress && (
                  <div className="grid gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm sm:grid-cols-3">
                    <div>
                      <p className="text-xs font-bold text-amber-800">سعر الإيجار</p>
                      <p className="mt-1 font-bold text-slate-950">{formatMoneyOMR(selectedDress.rentalPrice)}</p>
                    </div>
                    <div>
                      <p className="text-xs font-bold text-amber-800">اللون</p>
                      <p className="mt-1 font-bold text-slate-950">{selectedDress.color}</p>
                    </div>
                    <div>
                      <p className="text-xs font-bold text-amber-800\">المقاس</p>
                      <p className="mt-1 font-bold text-slate-950">{selectedDress.size}</p>
                    </div>
                  </div>
                )}

                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <label className={FORM_LABEL_CLASS_NAME}>قيمة الإيجار المتفق عليها (ر.ع) - المتبقي من الإيجار</label>
                    <input
                      type="number"
                      min={MIN_ZERO_AMOUNT}
                      max={selectedDress?.rentalPrice}
                      step={MONEY_STEP}
                      inputMode="decimal"
                      value={entry.rentalPrice}
                      onChange={(event) => updateLine(entry.key, { rentalPrice: event.target.value })}
                      className={FORM_FIELD_CLASS_NAME}
                    />
                    {discount > 0 && (
                      <p className="mt-1 text-xs font-bold text-amber-700">خصم: {formatMoneyOMR(discount)}</p>
                    )}
                  </div>
                  <div>
                    <label className={FORM_LABEL_CLASS_NAME}>دفعة الحجز (ر.ع)</label>
                    <input
                      type="number"
                      min={MIN_ZERO_AMOUNT}
                      step={MONEY_STEP}
                      inputMode="decimal"
                      value={entry.bookingAdvanceAmount}
                      onChange={(event) => updateLine(entry.key, { bookingAdvanceAmount: event.target.value })}
                      className={FORM_FIELD_CLASS_NAME}
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className={FORM_LABEL_CLASS_NAME}>التأمين المسترد (ر.ع)</label>
                    <input
                      type="number"
                      min={MIN_ZERO_AMOUNT}
                      step={MONEY_STEP}
                      inputMode="decimal"
                      value={entry.securityDepositAmount}
                      onChange={(event) => updateLine(entry.key, { securityDepositAmount: event.target.value })}
                      className={FORM_FIELD_CLASS_NAME}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <label className={FORM_LABEL_CLASS_NAME}>
          ملاحظات
          <textarea rows={3} maxLength={MAX_NOTES_LENGTH} {...register('notes')} className={FORM_FIELD_CLASS_NAME} placeholder="ملاحظات اختيارية عن التجهيز أو الاستلام" />
          {errors.notes && <p className={FORM_ERROR_CLASS_NAME}>{errors.notes.message}</p>}
        </label>

        {lines.length > 0 && lines.some((l) => l.dressId) && (
          <div className="space-y-2 rounded-xl bg-slate-950 p-4 text-white">
            <div className="flex justify-between text-sm">
              <span className="text-slate-300">إجمالي الإيجار</span>
              <span className="font-bold">{formatMoneyOMR(rentalTotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-300">دفعة الحجز</span>
              <span className="font-bold text-emerald-300">{formatMoneyOMR(bookingAdvanceTotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-300">المتبقي من الإيجار بعد دفعة الحجز</span>
              <span className="font-bold text-amber-300">{formatMoneyOMR(remainingRentalAfterBooking)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-300">التأمين المسترد (التزام)</span>
              <span className="font-bold text-violet-300">{formatMoneyOMR(securityDepositTotal)}</span>
            </div>
            <div className="flex justify-between border-t border-white/10 pt-2 text-sm font-extrabold">
              <span>إجمالي المبلغ النقدي للتحصيل اليوم (إيجار + تأمين)</span>
              <span className="text-amber-300">{formatMoneyOMR(cashToCollectToday)}</span>
            </div>
            {totalDiscount > 0 && (
              <span className="block text-xs font-medium text-amber-300">خصم إجمالي: {formatMoneyOMR(totalDiscount)}</span>
            )}
            <p className="text-[11px] leading-4 text-slate-400">التأمين المسترد التزام قابل للاسترداد ولا يُحتسب ضمن الإيراد. دفعة الحجز تقلل المتبقي من الإيجار مرة واحدة ولا تدخل في تسوية التأمين.</p>
          </div>
        )}

        <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={closeModal}
            className="min-h-11 rounded-xl border border-slate-300 px-5 py-2 text-sm font-bold text-slate-700 transition hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
          >
            إلغاء
          </button>
          <button
            type="submit"
            disabled={isSubmitting || customers.length === 0 || lines.length === 0 || lines.every((l) => !l.dressId)}
            className="min-h-11 rounded-xl bg-slate-950 px-5 py-2 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
          >
            {isSubmitting ? 'جارٍ الحفظ...' : 'إنشاء الحجز'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
