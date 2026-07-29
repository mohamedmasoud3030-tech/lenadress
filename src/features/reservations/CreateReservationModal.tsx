import { useEffect, useId, useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Modal } from '../../components/shared/Modal';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';
import { DEFAULT_RESERVATION_DAYS, MAX_NOTES_LENGTH, MIN_ZERO_AMOUNT, MONEY_STEP } from '../../shared/domain/businessRules';
import { FORM_ERROR_CLASS_NAME, FORM_FIELD_CLASS_NAME, FORM_LABEL_CLASS_NAME } from '../../shared/domain/formConstants';
import { getTodayISO } from '../../shared/utils/date';
import { formatMoneyOMR } from '../../shared/utils/format';
import { getCustomers } from '../customers/customer.service';
import type { Customer } from '../customers/customer.types';
import { getDresses } from '../dresses/dress.service';
import { getBookablePieces, summarizeAllDesigns } from '../dresses/design.service';
import type { Dress } from '../dresses/dress.types';
import { SearchableSelect, type SearchableOption } from '../../components/shared/SearchableSelect';
import { createReservationCommand } from '../workflows';
import { getReservationTimeDefaults } from './reservation.service';
import { getBufferSettings } from './reservationConflicts';
import type { Reservation } from './reservation.types';
import { createSubmissionKey } from '../../shared/utils/submissionKey';

const reservationSchema = z.object({
  customerId: z.string().min(1, 'اختاري العميلة.'),
  dressId: z.string().min(1, 'اختاري العنصر.'),
  pickupDate: z.string().min(1, 'حددي تاريخ الاستلام.'),
  pickupTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'وقت الاستلام غير صالح.'),
  returnDate: z.string().min(1, 'حددي تاريخ الإرجاع.'),
  returnTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'وقت الإرجاع غير صالح.'),
  depositAmount: z.coerce.number().finite('قيمة العربون غير صالحة.').min(0, 'قيمة العربون لا يمكن أن تكون سالبة.'),
  rentalPrice: z.coerce.number().finite('قيمة الإيجار غير صالحة.').min(0, 'قيمة الإيجار لا يمكن أن تكون سالبة.'),
  notes: z.string().max(MAX_NOTES_LENGTH, `الملاحظات يجب ألا تتجاوز ${MAX_NOTES_LENGTH} حرف.`).optional(),
});

type ReservationFormValues = z.infer<typeof reservationSchema>;

type CreateReservationModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated: (reservation: Reservation) => void;
  /**
   * Values carried over from the availability search, so a piece the operator
   * just found free is not re-picked by hand. Without this the search hands
   * back a code the operator then has to locate in a list of hundreds, which
   * is the friction the search existed to remove.
   */
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
    dressId: '',
    pickupDate: today,
    pickupTime: times.pickupTime,
    returnDate: addDays(today, DEFAULT_RESERVATION_DAYS),
    returnTime: times.returnTime,
    depositAmount: 0,
    rentalPrice: 0,
    notes: '',
  };
}

function getReservableDresses(): Dress[] {
  return getDresses().filter((dress) => dress.isForRent && ['available', 'reserved', 'rented'].includes(dress.status));
}

export function CreateReservationModal({ open, onClose, onCreated, prefill }: CreateReservationModalProps) {
  const fieldId = useId();
  const [submitError, setSubmitError] = useState<unknown>(null);
  // Stable per-form key so a duplicate submit is rejected by the command layer.
  const [submissionKey, setSubmissionKey] = useState(() => createSubmissionKey('rsv'));
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [dresses, setDresses] = useState<Dress[]>([]);
  const [designId, setDesignId] = useState('');
  const [selectedSize, setSelectedSize] = useState('');
  const [selectedColor, setSelectedColor] = useState('');
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

  const selectedDressId = watch('dressId');
  const depositAmount = watch('depositAmount');
  const rentalPrice = watch('rentalPrice');
  const pickupDate = watch('pickupDate');
  const returnDate = watch('returnDate');
  const selectedDress = dresses.find((dress) => dress.id === selectedDressId);

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

  // Designs are summarised against the chosen period, so the operator sees what
  // is genuinely free rather than what merely exists.
  const designSummaries = useMemo(() => (open ? summarizeAllDesigns(period) : []), [open, period]);

  const designOptions = useMemo<SearchableOption[]>(() => designSummaries.map((summary) => {
    const free = summary.variants.reduce((total, variant) => total + (variant.freeInPeriod ?? variant.available), 0);
    return {
      value: summary.design.id,
      label: summary.design.name,
      hint: `${summary.design.code} · ${summary.sizes.length} مقاس · ${summary.colors.length} لون`,
      badge: period ? `${free} متاحة` : `${summary.availableCount} متاحة`,
      disabled: free === 0,
      disabledReason: 'لا توجد قطعة متاحة من هذا التصميم في هذه الفترة.',
    };
  }), [designSummaries, period]);

  const variantSummary = useMemo(
    () => designSummaries.find((summary) => summary.design.id === designId)?.variants ?? [],
    [designSummaries, designId],
  );

  const sizeOptions = useMemo<SearchableOption[]>(() => {
    const sizes = new Map<string, number>();
    variantSummary.forEach((variant) => {
      sizes.set(variant.size, (sizes.get(variant.size) ?? 0) + (variant.freeInPeriod ?? variant.available));
    });
    return Array.from(sizes.entries()).map(([size, free]) => ({
      value: size,
      label: size,
      badge: `${free} متاحة`,
      disabled: free === 0,
      disabledReason: 'لا توجد قطعة متاحة بهذا المقاس في هذه الفترة.',
    }));
  }, [variantSummary]);

  const colorOptions = useMemo<SearchableOption[]>(() => {
    const colors = new Map<string, number>();
    variantSummary
      .filter((variant) => !selectedSize || variant.size === selectedSize)
      .forEach((variant) => {
        colors.set(variant.color, (colors.get(variant.color) ?? 0) + (variant.freeInPeriod ?? variant.available));
      });
    return Array.from(colors.entries()).map(([color, free]) => ({
      value: color,
      label: color,
      badge: `${free} متاحة`,
      disabled: free === 0,
      disabledReason: 'لا توجد قطعة متاحة بهذا اللون في هذه الفترة.',
    }));
  }, [variantSummary, selectedSize]);

  /**
   * Pieces offered for booking. With a design chosen the list is resolved
   * through the shared conflict rule for the exact period; without one it falls
   * back to the full rentable list so a one-off piece is still reachable.
   */
  const pieceOptions = useMemo<SearchableOption[]>(() => {
    const source = designId && period
      ? getBookablePieces(designId, period, selectedSize || undefined, selectedColor || undefined)
      : dresses.filter((dress) => (!designId || dress.designId === designId)
        && (!selectedSize || dress.size === selectedSize)
        && (!selectedColor || dress.color === selectedColor));

    return source.map((dress) => ({
      value: dress.id,
      label: `${dress.code} — ${dress.name}`,
      hint: `${dress.size} · ${dress.color}${dress.designCode ? ` · ${dress.designCode}` : ''}`,
      badge: formatMoneyOMR(dress.rentalPrice),
    }));
  }, [designId, period, selectedSize, selectedColor, dresses]);

  useEffect(() => {
    if (!open) return;
      try {
        setCustomers(getCustomers());
        const reservable = getReservableDresses();
        setDresses(reservable);
        setDesignId('');
        setSelectedSize('');
        setSelectedColor('');

        // The prefilled piece is resolved against the reservable list rather
        // than trusted from the URL: a code can go stale between the search
        // and the click, and silently booking the wrong item would be worse
        // than making the operator pick again.
        const defaults = getDefaultValues();
        const prefilledDress = prefill?.dressCode
          ? reservable.find((dress) => dress.code === prefill.dressCode)
          : undefined;

        reset({
          ...defaults,
          dressId: prefilledDress?.id ?? defaults.dressId,
          pickupDate: prefill?.pickupDate || defaults.pickupDate,
          returnDate: prefill?.returnDate || defaults.returnDate,
        });
        if (prefilledDress?.designId) setDesignId(prefilledDress.designId);
        if (prefilledDress) {
          setSelectedSize(prefilledDress.size);
          setSelectedColor(prefilledDress.color);
        }
        setSubmitError(null);
      } catch (error: unknown) {
        setSubmitError(error);
      }
  }, [open, reset, prefill?.dressCode, prefill?.pickupDate, prefill?.returnDate]);

  useEffect(() => {
    if (!selectedDress) return;
    // Picking a piece directly reveals which design it belongs to.
    if (selectedDress.designId && selectedDress.designId !== designId) {
      setDesignId(selectedDress.designId);
    }
    setValue('depositAmount', selectedDress.depositAmount, { shouldValidate: true });
    // The agreed price starts at the catalogue price; lowering it records a discount.
    setValue('rentalPrice', selectedDress.rentalPrice, { shouldValidate: true });
  }, [selectedDress, setValue, designId]);

  const closeModal = () => {
    setSubmissionKey(createSubmissionKey('rsv'));
    reset(getDefaultValues());
    setSubmitError(null);
    onClose();
  };

  const onSubmit = (values: ReservationFormValues) => {
    setSubmitError(null);

    try {
      const reservation = createReservationCommand({ ...values, idempotencyKey: submissionKey });
      onCreated(reservation);
      closeModal();
    } catch (error: unknown) {
      setSubmitError(error);
    }
  };

  const agreedRentalPrice = Number(rentalPrice || 0);
  const discountAmount = selectedDress ? Math.max(selectedDress.rentalPrice - agreedRentalPrice, 0) : 0;
  const totalAmount = selectedDress ? agreedRentalPrice + Number(depositAmount || 0) : 0;

  return (
    <Modal open={open} onClose={closeModal} title="إنشاء حجز جديد" className="max-w-2xl">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
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

        <div className="space-y-3 rounded-2xl border border-slate-200 bg-stone-50/70 p-3">
          <SearchableSelect
            label="التصميم"
            value={designId}
            onChange={(nextDesignId) => {
              // Changing the design invalidates the size, colour and the piece.
              setDesignId(nextDesignId);
              setSelectedSize('');
              setSelectedColor('');
              setValue('dressId', '', { shouldValidate: true });
            }}
            options={designOptions}
            placeholder="ابحثي عن تصميم"
            searchPlaceholder="ابحثي باسم التصميم أو كوده…"
            hint="اختاري التصميم أولاً ثم المقاس واللون المتاحين في هذه الفترة."
            unavailableText="لا توجد تصاميم مسجلة. يمكنك اختيار قطعة مباشرة بالأسفل."
          />

          {designId && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <SearchableSelect
                  label="المقاس"
                  value={selectedSize}
                  onChange={(size) => { setSelectedSize(size); setValue('dressId', '', { shouldValidate: true }); }}
                  options={sizeOptions}
                  placeholder="كل المقاسات"
                  searchPlaceholder="ابحثي عن مقاس…"
                  unavailableText="لا توجد مقاسات متاحة في هذه الفترة."
                />
                <SearchableSelect
                  label="اللون"
                  value={selectedColor}
                  onChange={(color) => { setSelectedColor(color); setValue('dressId', '', { shouldValidate: true }); }}
                  options={colorOptions}
                  placeholder="كل الألوان"
                  searchPlaceholder="ابحثي عن لون…"
                  unavailableText="لا توجد ألوان متاحة في هذه الفترة."
                />
              </div>

              {variantSummary.length > 0 && (
                <ul className="flex flex-wrap gap-1.5" aria-label="المتاح من هذا التصميم خلال الفترة">
                  {variantSummary.map((variant) => {
                    const free = variant.freeInPeriod ?? 0;
                    return (
                      <li
                        key={`${variant.size}-${variant.color}`}
                        className={`rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${
                          free > 0
                            ? 'bg-emerald-50 text-emerald-800 ring-emerald-200'
                            : 'bg-slate-100 text-slate-500 ring-slate-200'
                        }`}
                      >
                        {variant.size} · {variant.color} — {free > 0 ? `${free} متاحة` : 'غير متاح'}
                      </li>
                    );
                  })}
                </ul>
              )}
            </>
          )}
        </div>

        <SearchableSelect
          label="القطعة"
          required
          value={watch('dressId')}
          onChange={(dressId) => setValue('dressId', dressId, { shouldValidate: true })}
          options={pieceOptions}
          placeholder="اختاري القطعة"
          searchPlaceholder="ابحثي بالكود أو الاسم…"
          error={errors.dressId?.message}
          hint={designId ? 'القطع المعروضة متاحة فعلياً خلال الفترة المحددة.' : 'اختاري تصميماً بالأعلى لتصفية القطع، أو ابحثي مباشرة.'}
          unavailableText={designId
            ? 'لا توجد قطعة متاحة من هذا التصميم بهذا المقاس واللون خلال الفترة.'
            : 'لا توجد فساتين مؤهلة للإيجار حالياً.'}
        />

        {selectedDress && (
          <div className="grid gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm sm:grid-cols-3">
            <div>
              <p className="text-xs font-bold text-amber-800">سعر الإيجار</p>
              <p className="mt-1 font-bold text-slate-950">{formatMoneyOMR(selectedDress.rentalPrice)}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-amber-800">اللون</p>
              <p className="mt-1 font-bold text-slate-950">{selectedDress.color}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-amber-800">المقاس</p>
              <p className="mt-1 font-bold text-slate-950">{selectedDress.size}</p>
            </div>
          </div>
        )}

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

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor={`${fieldId}-rental`} className={FORM_LABEL_CLASS_NAME}>قيمة الإيجار المتفق عليها (ر.ع)</label>
            <input
              id={`${fieldId}-rental`}
              type="number"
              min={MIN_ZERO_AMOUNT}
              max={selectedDress?.rentalPrice}
              step={MONEY_STEP}
              inputMode="decimal"
              {...register('rentalPrice')}
              className={FORM_FIELD_CLASS_NAME}
            />
            {errors.rentalPrice && <p className={FORM_ERROR_CLASS_NAME}>{errors.rentalPrice.message}</p>}
            {discountAmount > 0 && (
              <p className="mt-1 text-xs font-bold text-amber-700">خصم مسجل: {formatMoneyOMR(discountAmount)}</p>
            )}
          </div>
          <div>
            <label htmlFor={`${fieldId}-deposit`} className={FORM_LABEL_CLASS_NAME}>العربون (ر.ع)</label>
            <input
              id={`${fieldId}-deposit`}
              type="number"
              min={MIN_ZERO_AMOUNT}
              step={MONEY_STEP}
              inputMode="decimal"
              {...register('depositAmount')}
              className={FORM_FIELD_CLASS_NAME}
            />
            {errors.depositAmount && <p className={FORM_ERROR_CLASS_NAME}>{errors.depositAmount.message}</p>}
          </div>
          <div>
            <label htmlFor={`${fieldId}-notes`} className={FORM_LABEL_CLASS_NAME}>ملاحظات</label>
            <textarea id={`${fieldId}-notes`} rows={3} maxLength={MAX_NOTES_LENGTH} {...register('notes')} className={FORM_FIELD_CLASS_NAME} placeholder="ملاحظات اختيارية عن التجهيز أو الاستلام" />
            {errors.notes && <p className={FORM_ERROR_CLASS_NAME}>{errors.notes.message}</p>}
          </div>
        </div>

        {selectedDress && (
          <div className="flex items-center justify-between gap-4 rounded-xl bg-slate-950 px-4 py-3 text-white">
            <span className="text-sm font-bold text-slate-300">الإجمالي شامل العربون</span>
            <span className="text-lg font-extrabold text-amber-300">{formatMoneyOMR(totalAmount)}</span>
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
            disabled={isSubmitting || customers.length === 0 || dresses.length === 0}
            className="min-h-11 rounded-xl bg-slate-950 px-5 py-2 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
          >
            {isSubmitting ? 'جارٍ الحفظ...' : 'إنشاء الحجز'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
