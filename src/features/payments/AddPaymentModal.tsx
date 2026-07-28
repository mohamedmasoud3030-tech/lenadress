import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../../components/shared/Modal';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';
import { MAX_NOTES_LENGTH, MIN_MONEY_AMOUNT, MONEY_STEP } from '../../shared/domain/businessRules';
import {
  AMBER_FOCUS_RING_CLASS_NAME,
  STACKED_FORM_FIELD_CLASS_NAME,
  STACKED_FORM_LABEL_CLASS_NAME,
} from '../../shared/domain/formConstants';
import { getTodayISO } from '../../shared/utils/date';
import { calculateReservationRemainingAmount } from '../../shared/utils/financialCalculations.js';
import { formatMoneyOMR } from '../../shared/utils/format';
import { getReservations } from '../reservations/reservation.service';
import type { Reservation } from '../reservations/reservation.types';
import { MANUAL_PAYMENT_TYPES, PAYMENT_METHODS } from './payment.constants';
import { recordPaymentCommand } from '../workflows';
import { formatPaymentMethodLabel, formatPaymentTypeLabel } from './payment.service';
import type { ManualPaymentType, PaymentMethod, PaymentRecord } from './payment.types';
import { createSubmissionKey } from '../../shared/utils/submissionKey';
import { SearchableSelect, type SearchableOption } from '../../components/shared/SearchableSelect';

type AddPaymentModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated: (payment: PaymentRecord) => void;
};

type PaymentForm = {
  reservationNumber: string;
  paymentDate: string;
  type: ManualPaymentType;
  method: PaymentMethod;
  amount: string;
  notes: string;
};

type PaymentPreview = {
  amount: number;
  maximum?: number;
  projectedPaidAmount: number;
  projectedRefundedAmount: number;
  projectedRemainingAmount: number;
  balanceEffect: 'decrease' | 'increase' | 'unchanged';
};

function getDefaultForm(): PaymentForm {
  return { reservationNumber: '', paymentDate: getTodayISO(), type: 'rental', method: 'cash', amount: '', notes: '' };
}

function parseAmount(value: string): number {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function isEligible(reservation: Reservation, type: ManualPaymentType): boolean {
  if (reservation.status === 'cancelled') return false;
  if (type === 'refund') return reservation.paidAmount - (reservation.refundedAmount ?? 0) > 0;
  if (type === 'penalty' || type === 'adjustment') return true;
  return reservation.remainingAmount > 0;
}

function getMaximumAmount(reservation: Reservation | undefined, type: ManualPaymentType): number | undefined {
  if (!reservation) return undefined;
  if (type === 'refund') return Math.max(reservation.paidAmount - (reservation.refundedAmount ?? 0), 0);
  if (type === 'rental' || type === 'deposit') return reservation.remainingAmount;
  return undefined;
}

function getPaymentPreview(
  reservation: Reservation | undefined,
  type: ManualPaymentType,
  amount: number,
  maximum?: number,
): PaymentPreview | null {
  if (!reservation) return null;

  const boundedAmount = maximum === undefined ? amount : Math.min(amount, maximum);
  const isRefund = type === 'refund';
  const isFeeSettlement = type === 'penalty' || type === 'adjustment';
  const projectedPaidAmount = reservation.paidAmount + (isRefund ? 0 : boundedAmount);
  const projectedRefundedAmount = (reservation.refundedAmount ?? 0) + (isRefund ? boundedAmount : 0);
  const projectedRemainingAmount = calculateReservationRemainingAmount({
    totalAmount: reservation.totalAmount,
    assessedFeesAmount: (reservation.assessedFeesAmount ?? 0) + (isFeeSettlement ? boundedAmount : 0),
    paidAmount: projectedPaidAmount,
    settledDepositAmount: reservation.settledDepositAmount,
    refundedAmount: projectedRefundedAmount,
  });
  const balanceEffect = projectedRemainingAmount < reservation.remainingAmount
    ? 'decrease'
    : projectedRemainingAmount > reservation.remainingAmount
      ? 'increase'
      : 'unchanged';

  return {
    amount: boundedAmount,
    maximum,
    projectedPaidAmount,
    projectedRefundedAmount,
    projectedRemainingAmount,
    balanceEffect,
  };
}

function getBalanceEffectLabel(effect: PaymentPreview['balanceEffect']): string {
  if (effect === 'decrease') return 'سينخفض الرصيد';
  if (effect === 'increase') return 'سيزيد الرصيد';
  return 'الرصيد لن يتغير';
}

export function AddPaymentModal({ open, onClose, onCreated }: AddPaymentModalProps) {
  const [form, setForm] = useState<PaymentForm>(() => getDefaultForm());
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Stable per-form key so a double click never posts the same money twice.
  const [submissionKey, setSubmissionKey] = useState(() => createSubmissionKey('pay'));
  const amount = parseAmount(form.amount);
  const reservations = useMemo(() => getReservations().filter((item) => isEligible(item, form.type)), [open, form.type]);
  const selected = reservations.find((item) => item.reservationNumber === form.reservationNumber);
  const maximum = getMaximumAmount(selected, form.type);
  const preview = getPaymentPreview(selected, form.type, amount, maximum);

  // A showroom with hundreds of bookings cannot use a native wheel to find one.
  const reservationOptions = useMemo<SearchableOption[]>(() => reservations.map((item) => ({
    value: item.reservationNumber,
    label: `${item.reservationNumber} — ${item.customerName}`,
    hint: `${item.dressCode} · ${item.dressName}`,
    badge: formatMoneyOMR(item.remainingAmount),
  })), [reservations]);

  useEffect(() => {
    if (!open) return;
    setForm(getDefaultForm());
    setSubmitError(null);
    setIsSubmitting(false);
    setSubmissionKey(createSubmissionKey('pay'));
  }, [open]);

  const updateType = (type: ManualPaymentType) => {
    setForm((current) => ({ ...current, type, reservationNumber: '', amount: '' }));
    setSubmitError(null);
  };

  const close = () => {
    setForm(getDefaultForm());
    setSubmitError(null);
    onClose();
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setSubmitError(null);
    setIsSubmitting(true);

    try {
      const payment = recordPaymentCommand({ ...form, amount: Number(form.amount), idempotencyKey: submissionKey });
      onCreated(payment);
      close();
    } catch (error: unknown) {
      setIsSubmitting(false);
      setSubmitError(error);
    }
  };

  return (
    <Modal open={open} onClose={close} title="تسجيل حركة مالية" className="max-w-3xl">
      <form onSubmit={submit} className="space-y-5" noValidate>
        {submitError !== null && (
          <UserFacingErrorAlert error={submitError} fallback="تعذر تسجيل الدفعة." />
        )}

        <div>
          <p className="mb-2 text-sm font-bold text-slate-700">نوع الحركة</p>
          <div className="grid gap-2 rounded-3xl bg-slate-950 p-2 text-sm font-bold text-white sm:grid-cols-5">
            {MANUAL_PAYMENT_TYPES.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => updateType(type)}
                className={`min-h-11 rounded-2xl px-3 transition ${AMBER_FOCUS_RING_CLASS_NAME} ${form.type === type ? 'bg-amber-300 text-slate-950' : 'text-slate-300 hover:bg-white/10'}`}
              >
                {formatPaymentTypeLabel(type)}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-[1.3fr_1fr]">
          <SearchableSelect
            label="الحجز"
            required
            value={form.reservationNumber}
            onChange={(reservationNumber) => setForm((current) => ({ ...current, reservationNumber }))}
            options={reservationOptions}
            placeholder="اختاري الحجز"
            searchPlaceholder="ابحثي برقم الحجز أو العميلة أو الكود…"
            unavailableText="لا توجد حجوزات مؤهلة لهذه الحركة حالياً."
          />

          <label className={STACKED_FORM_LABEL_CLASS_NAME}>
            تاريخ الحركة
            <input
              required
              type="date"
              max={getTodayISO()}
              value={form.paymentDate}
              onChange={(event) => setForm((current) => ({ ...current, paymentDate: event.target.value }))}
              className={STACKED_FORM_FIELD_CLASS_NAME}
            />
          </label>
        </div>

        {selected && (
          <div className="grid gap-3 rounded-3xl border border-amber-100 bg-amber-50/80 p-4 text-sm text-slate-700 sm:grid-cols-4">
            <div>
              <p className="text-xs font-bold text-amber-800">العميلة</p>
              <p className="mt-1 font-extrabold text-slate-950">{selected.customerName}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-amber-800">العنصر</p>
              <p className="mt-1 font-extrabold text-slate-950">{selected.dressCode}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-amber-800">المحصل</p>
              <p className="mt-1 font-extrabold text-slate-950">{formatMoneyOMR(selected.paidAmount)}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-amber-800">الرصيد الحالي</p>
              <p className="mt-1 font-extrabold text-slate-950">{formatMoneyOMR(selected.remainingAmount)}</p>
            </div>
          </div>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <label className={STACKED_FORM_LABEL_CLASS_NAME}>
            القيمة (ر.ع)
            <input
              required
              type="number"
              min={MIN_MONEY_AMOUNT}
              max={maximum}
              step={MONEY_STEP}
              inputMode="decimal"
              value={form.amount}
              onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))}
              className={STACKED_FORM_FIELD_CLASS_NAME}
            />
            {maximum !== undefined && (
              <span className="mt-1 block text-xs font-semibold text-slate-500">الحد الأقصى: {formatMoneyOMR(maximum)}</span>
            )}
          </label>

          <label className={STACKED_FORM_LABEL_CLASS_NAME}>
            {form.type === 'refund' ? 'وسيلة الاسترجاع' : 'وسيلة الدفع'}
            <select
              value={form.method}
              onChange={(event) => setForm((current) => ({ ...current, method: event.target.value as PaymentMethod }))}
              className={STACKED_FORM_FIELD_CLASS_NAME}
            >
              {PAYMENT_METHODS.map((method) => (
                <option key={method} value={method}>
                  {formatPaymentMethodLabel(method)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {preview && (
          <div className="grid gap-3 rounded-3xl border border-slate-200 bg-white p-4 text-sm shadow-sm sm:grid-cols-5">
            <div>
              <p className="text-xs font-bold text-slate-500">تأثير الحركة</p>
              <p className="mt-1 font-extrabold text-slate-950">{getBalanceEffectLabel(preview.balanceEffect)}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-500">المبلغ المحتسب</p>
              <p className="mt-1 font-extrabold text-amber-700">{formatMoneyOMR(preview.amount)}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-500">المحصل بعد الحفظ</p>
              <p className="mt-1 font-extrabold text-emerald-700">{formatMoneyOMR(preview.projectedPaidAmount)}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-500">المسترجع بعد الحفظ</p>
              <p className="mt-1 font-extrabold text-sky-700">{formatMoneyOMR(preview.projectedRefundedAmount)}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-slate-500">الرصيد بعد الحفظ</p>
              <p className="mt-1 font-extrabold text-rose-700">{formatMoneyOMR(preview.projectedRemainingAmount)}</p>
            </div>
          </div>
        )}

        <label className={STACKED_FORM_LABEL_CLASS_NAME}>
          ملاحظات
          <textarea
            rows={3}
            maxLength={MAX_NOTES_LENGTH}
            value={form.notes}
            onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
            className={STACKED_FORM_FIELD_CLASS_NAME}
            placeholder="ملاحظات اختيارية عن الحركة المالية"
          />
        </label>

        {reservations.length === 0 && (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">
            لا توجد حجوزات مؤهلة لهذه الحركة حالياً.
          </p>
        )}

        <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={close}
            className={`min-h-11 rounded-xl border border-slate-300 px-5 py-2 text-sm font-bold text-slate-700 transition hover:bg-stone-100 ${AMBER_FOCUS_RING_CLASS_NAME}`}
          >
            إلغاء
          </button>
          <button
            type="submit"
            disabled={reservations.length === 0 || isSubmitting}
            className={`min-h-11 rounded-xl bg-slate-950 px-5 py-2 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 ${AMBER_FOCUS_RING_CLASS_NAME}`}
          >
            تسجيل الحركة
          </button>
        </div>
      </form>
    </Modal>
  );
}
