import { useEffect, useId, useState } from 'react';
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
import type { Dress } from '../dresses/dress.types';
import { createReservationCommand } from '../workflows';
import { getReservationBufferDays } from './reservation.service';
import type { Reservation } from './reservation.types';

const reservationSchema = z.object({
  customerId: z.string().min(1, 'اختاري العميلة.'),
  dressId: z.string().min(1, 'اختاري العنصر.'),
  pickupDate: z.string().min(1, 'حددي تاريخ الاستلام.'),
  returnDate: z.string().min(1, 'حددي تاريخ الإرجاع.'),
  depositAmount: z.coerce.number().finite('قيمة العربون غير صالحة.').min(0, 'قيمة العربون لا يمكن أن تكون سالبة.'),
  notes: z.string().max(MAX_NOTES_LENGTH, `الملاحظات يجب ألا تتجاوز ${MAX_NOTES_LENGTH} حرف.`).optional(),
});

type ReservationFormValues = z.infer<typeof reservationSchema>;

type CreateReservationModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated: (reservation: Reservation) => void;
};

function addDays(dateValue: string, days: number): string {
  const date = new Date(`${dateValue}T00:00:00`);
  date.setDate(date.getDate() + days);
  return getTodayISO(date);
}

function getDefaultValues(): ReservationFormValues {
  const today = getTodayISO();
  return {
    customerId: '',
    dressId: '',
    pickupDate: today,
    returnDate: addDays(today, DEFAULT_RESERVATION_DAYS),
    depositAmount: 0,
    notes: '',
  };
}

function getReservableDresses(): Dress[] {
  return getDresses().filter((dress) => dress.isForRent && ['available', 'reserved', 'rented'].includes(dress.status));
}

export function CreateReservationModal({ open, onClose, onCreated }: CreateReservationModalProps) {
  const fieldId = useId();
  const [submitError, setSubmitError] = useState<unknown>(null);
  // Stable per-form key so a duplicate submit is rejected by the command layer.
  const [submissionKey, setSubmissionKey] = useState(() => `rsv-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [dresses, setDresses] = useState<Dress[]>([]);
  const bufferDays = getReservationBufferDays();

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
  const selectedDress = dresses.find((dress) => dress.id === selectedDressId);

  useEffect(() => {
    if (!open) return;
      try {
        setCustomers(getCustomers());
        setDresses(getReservableDresses());
        reset(getDefaultValues());
        setSubmitError(null);
      } catch (error: unknown) {
        setSubmitError(error);
      }
  }, [open, reset]);

  useEffect(() => {
    if (!selectedDress) return;
    setValue('depositAmount', selectedDress.depositAmount, { shouldValidate: true });
  }, [selectedDress, setValue]);

  const closeModal = () => {
    setSubmissionKey(`rsv-${Date.now()}-${Math.random().toString(36).slice(2)}`);
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

  const totalAmount = selectedDress ? selectedDress.rentalPrice + Number(depositAmount || 0) : 0;

  return (
    <Modal open={open} onClose={closeModal} title="إنشاء حجز جديد" className="max-w-2xl">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
        {submitError !== null && (
          <UserFacingErrorAlert error={submitError} fallback="تعذر إنشاء الحجز. حاولي مرة أخرى." />
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor={`${fieldId}-customer`} className={FORM_LABEL_CLASS_NAME}>العميلة</label>
            <select id={`${fieldId}-customer`} {...register('customerId')} className={FORM_FIELD_CLASS_NAME}>
              <option value="">اختاري العميلة</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id} disabled={customer.status === 'blocked'}>
                  {customer.name} — {customer.phone}{customer.status === 'blocked' ? ' — محظورة' : ''}
                </option>
              ))}
            </select>
            {errors.customerId && <p className={FORM_ERROR_CLASS_NAME}>{errors.customerId.message}</p>}
          </div>

          <div>
            <label htmlFor={`${fieldId}-dress`} className={FORM_LABEL_CLASS_NAME}>العنصر</label>
            <select id={`${fieldId}-dress`} {...register('dressId')} className={FORM_FIELD_CLASS_NAME}>
              <option value="">اختاري العنصر</option>
              {dresses.map((dress) => (
                <option key={dress.id} value={dress.id}>
                  {dress.code} — {dress.name} — {formatMoneyOMR(dress.rentalPrice)}
                </option>
              ))}
            </select>
            {errors.dressId && <p className={FORM_ERROR_CLASS_NAME}>{errors.dressId.message}</p>}
            {dresses.length === 0 && <p className="mt-1 text-xs font-medium text-amber-700">لا توجد فساتين مؤهلة للإيجار حالياً.</p>}
          </div>
        </div>

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
          <legend className="sr-only">فترة الحجز</legend>
          <div>
            <label htmlFor={`${fieldId}-pickup`} className={FORM_LABEL_CLASS_NAME}>تاريخ الاستلام</label>
            <input id={`${fieldId}-pickup`} type="date" min={getTodayISO()} {...register('pickupDate')} className={FORM_FIELD_CLASS_NAME} />
            {errors.pickupDate && <p className={FORM_ERROR_CLASS_NAME}>{errors.pickupDate.message}</p>}
          </div>
          <div>
            <label htmlFor={`${fieldId}-return`} className={FORM_LABEL_CLASS_NAME}>تاريخ الإرجاع</label>
            <input id={`${fieldId}-return`} type="date" min={getTodayISO()} {...register('returnDate')} className={FORM_FIELD_CLASS_NAME} />
            {errors.returnDate && <p className={FORM_ERROR_CLASS_NAME}>{errors.returnDate.message}</p>}
          </div>
        </fieldset>

        <p className="rounded-xl bg-stone-50 px-3 py-2 text-xs leading-5 text-slate-600">
          يتم حجز فترة تجهيز تلقائياً قبل الحجز وبعده ({bufferDays} يوم).
        </p>

        <div className="grid gap-4 md:grid-cols-[220px_1fr]">
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
