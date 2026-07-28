import type { FormEvent } from 'react';
import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Modal } from '../../components/shared/Modal';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';
import { MAX_NOTES_LENGTH, MIN_ZERO_AMOUNT, MONEY_STEP } from '../../shared/domain/businessRules';
import {
  AMBER_FOCUS_RING_CLASS_NAME,
  STACKED_FORM_FIELD_CLASS_NAME,
  STACKED_FORM_LABEL_CLASS_NAME,
} from '../../shared/domain/formConstants';
import { calculateReservationRemainingAmount, calculateReturnSettlement } from '../../shared/utils/financialCalculations.js';
import { formatMoneyOMR } from '../../shared/utils/format';
import { BASIC_PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from '../payments/payment.constants';
import { getPayments } from '../payments/payment.service';
import type { PaymentMethod } from '../payments/payment.types';
import { getReservations } from '../reservations/reservation.service';
import type { Reservation } from '../reservations/reservation.types';
import { completeDeliveryCommand, completeReturnCommand, type ReturnItemStatus } from '../workflows';
import type { DeliveryReturnRecord } from './deliveryReturn.types';
import { createSubmissionKey } from '../../shared/utils/submissionKey';
import { getAccessoryByBarcode } from '../accessories/accessory.service';
import { getReservationAccessoryViews, type ReservationAccessoryView } from '../accessories/reservationAccessory.service';
import type { AccessoryReturnEntry } from '../accessories/reservationAccessory.service';
import { DeliveryAccessoryChecklist, type AccessoryReturnState } from './DeliveryAccessoryChecklist';
import { SearchableSelect, type SearchableOption } from '../../components/shared/SearchableSelect';

const DEFAULT_ACCESSORY_RETURN_STATE: AccessoryReturnState = { selected: false, condition: 'intact', charge: '0' };

const BarcodeScanner = lazy(async () => {
  const module = await import('../dresses/BarcodeScanner');
  return { default: module.BarcodeScanner };
});

type Props = { open: boolean; onClose: () => void; onCompleted: (record: DeliveryReturnRecord) => void };
type Operation = 'delivery' | 'return';
type NextDressStatus = ReturnItemStatus;
type Form = {
  operation: Operation;
  reservationNumber: string;
  dateTime: string;
  condition: string;
  lateFee: string;
  damageFee: string;
  refundMethod: PaymentMethod;
  nextDressStatus: NextDressStatus;
  notes: string;
};

function getCurrentDateTimeLocal(): string {
  const date = new Date();
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return offsetDate.toISOString().slice(0, 16);
}

function defaults(operation: Operation = 'delivery'): Form {
  return {
    operation,
    reservationNumber: '',
    dateTime: getCurrentDateTimeLocal(),
    condition: '',
    lateFee: '0',
    damageFee: '0',
    refundMethod: 'cash',
    nextDressStatus: 'inspection',
    notes: '',
  };
}

function parseAmount(value: string): number {
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}

function getEligibleReservations(operation: Operation): Reservation[] {
  return getReservations().filter((item) =>
    operation === 'delivery'
      ? ['pending', 'confirmed'].includes(item.status)
      : ['delivered', 'overdue'].includes(item.status),
  );
}

function getReturnPreview(reservation: Reservation | undefined, lateFee: number, damageFee: number) {
  if (!reservation) return null;

  const reservationPayments = getPayments().filter((payment) => payment.reservationNumber === reservation.reservationNumber);
  const depositCollected = Math.min(
    reservation.depositAmount,
    reservationPayments
      .filter((payment) => payment.type === 'deposit' && payment.direction === 'income')
      .reduce((total, payment) => total + payment.amount, 0),
  );
  const totalCollected = reservationPayments
    .filter((payment) => payment.direction === 'income')
    .reduce((total, payment) => total + payment.amount, 0);
  const previouslyRefundedAmount = reservationPayments
    .filter((payment) => payment.direction === 'refund')
    .reduce((total, payment) => total + payment.amount, 0);
  const previouslyRefundedDepositAmount = reservationPayments
    .filter((payment) => payment.type === 'refund' && payment.direction === 'refund' && payment.source === 'return')
    .reduce((total, payment) => total + payment.amount, 0);
  const settlement = calculateReturnSettlement({
    depositAmount: reservation.depositAmount,
    depositCollected,
    totalCollected,
    previouslyRefundedAmount,
    previouslyRefundedDepositAmount,
    lateFee,
    damageFee,
  });
  const remainingAfterReturn = calculateReservationRemainingAmount({
    totalAmount: reservation.totalAmount,
    assessedFeesAmount: (reservation.assessedFeesAmount ?? 0) + settlement.assessedFeesAmount,
    paidAmount: reservation.paidAmount,
    settledDepositAmount: (reservation.settledDepositAmount ?? 0) + settlement.settledDepositAmount,
    refundedAmount: (reservation.refundedAmount ?? 0) + settlement.refundAmount,
  });

  return { settlement, remainingAfterReturn };
}

export function DeliveryReturnModal({ open, onClose, onCompleted }: Props) {
  const [form, setForm] = useState<Form>(() => defaults());
  const [error, setError] = useState<unknown>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // One key per opened form instance: a double click reuses it and the command
  // layer rejects the second write instead of duplicating the operation.
  const [submissionKey, setSubmissionKey] = useState(() => createSubmissionKey('dr'));
  const [accessoryLinks, setAccessoryLinks] = useState<ReservationAccessoryView[]>([]);
  const [deliveredAccessoryIds, setDeliveredAccessoryIds] = useState<string[]>([]);
  const [returnState, setReturnState] = useState<Record<string, AccessoryReturnState>>({});
  const [showScanner, setShowScanner] = useState(false);
  const [scanFeedback, setScanFeedback] = useState<string | null>(null);
  const lateFee = parseAmount(form.lateFee);
  const damageFee = parseAmount(form.damageFee);
  const reservations = useMemo(() => getEligibleReservations(form.operation), [open, form.operation]);
  const selectedReservation = reservations.find((item) => item.reservationNumber === form.reservationNumber);
  const returnPreview = useMemo(
    () => getReturnPreview(selectedReservation, lateFee, damageFee),
    [selectedReservation, lateFee, damageFee],
  );

  const reservationOptions = useMemo<SearchableOption[]>(() => reservations.map((item) => ({
    value: item.reservationNumber,
    label: `${item.reservationNumber} — ${item.customerName}`,
    hint: `${item.dressCode} · ${item.dressName}`,
  })), [reservations]);

  useEffect(() => {
    if (!open) return;
    setForm(defaults());
    setError(null);
    setIsSubmitting(false);
    setSubmissionKey(createSubmissionKey('dr'));
    setAccessoryLinks([]);
    setDeliveredAccessoryIds([]);
    setReturnState({});
    setScanFeedback(null);
  }, [open]);

  // Accessory rows follow the selected reservation, so switching bookings never
  // carries a checked accessory over to the wrong customer.
  useEffect(() => {
    if (!form.reservationNumber) {
      setAccessoryLinks([]);
      setDeliveredAccessoryIds([]);
      setReturnState({});
      return;
    }
    const links = getReservationAccessoryViews(form.reservationNumber);
    setAccessoryLinks(links);
    setDeliveredAccessoryIds(links.filter((link) => !link.deliveredAt).map((link) => link.accessoryId));
    setReturnState(Object.fromEntries(
      links
        .filter((link) => link.deliveredAt && !link.returnedAt)
        .map((link) => [link.accessoryId, { selected: true, condition: 'intact' as const, charge: '0' }]),
    ));
    setScanFeedback(null);
  }, [form.reservationNumber, form.operation]);

  const toggleDeliveredAccessory = (accessoryId: string) => {
    setDeliveredAccessoryIds((current) => current.includes(accessoryId)
      ? current.filter((value) => value !== accessoryId)
      : [...current, accessoryId]);
  };

  const updateReturnState = (accessoryId: string, next: Partial<AccessoryReturnState>) => {
    setReturnState((current) => ({
      ...current,
      [accessoryId]: { ...DEFAULT_ACCESSORY_RETURN_STATE, ...current[accessoryId], ...next },
    }));
  };

  // The scanner selects the matching accessory row instead of navigating away.
  const handleAccessoryScan = (value: string) => {
    setShowScanner(false);
    const accessory = getAccessoryByBarcode(value);
    if (!accessory) {
      setScanFeedback(`لم يتم العثور على ملحق مرتبط بالباركود ${value}.`);
      return;
    }
    const link = accessoryLinks.find((item) => item.accessoryId === accessory.id);
    if (!link) {
      setScanFeedback(`الملحق ${accessory.code} غير مرتبط بهذا الحجز.`);
      return;
    }
    if (form.operation === 'delivery') {
      setDeliveredAccessoryIds((current) => current.includes(accessory.id) ? current : [...current, accessory.id]);
    } else {
      updateReturnState(accessory.id, { selected: true });
    }
    setScanFeedback(`تم تحديد الملحق ${accessory.code} — ${accessory.name}.`);
  };

  const updateOperation = (operation: Operation) => {
    setForm(defaults(operation));
    setError(null);
  };

  const close = () => {
    setForm(defaults());
    setError(null);
    onClose();
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setError(null);
    setIsSubmitting(true);

    try {
      const accessoryReturns: AccessoryReturnEntry[] = Object.entries(returnState)
        .filter(([, state]) => state.selected)
        .map(([accessoryId, state]) => ({
          accessoryId,
          condition: state.condition,
          chargeAmount: parseAmount(state.charge) > 0 ? parseAmount(state.charge) : undefined,
        }));

      const record = form.operation === 'delivery'
        ? completeDeliveryCommand({
            reservationNumber: form.reservationNumber,
            deliveryDateTime: form.dateTime,
            deliveryCondition: form.condition,
            deliveredAccessoryIds,
            notes: form.notes,
            idempotencyKey: submissionKey,
          })
        : completeReturnCommand({
            reservationNumber: form.reservationNumber,
            returnDateTime: form.dateTime,
            returnCondition: form.condition,
            lateFee,
            damageFee,
            refundMethod: form.refundMethod,
            nextItemStatus: form.nextDressStatus,
            accessoryReturns,
            notes: form.notes,
            idempotencyKey: submissionKey,
          });
      onCompleted(record);
      close();
    } catch (reason: unknown) {
      setIsSubmitting(false);
      setError(reason);
    }
  };

  return (
    <Modal open={open} onClose={close} title="تسجيل تسليم أو استرجاع" className="max-w-3xl">
      <form onSubmit={submit} className="space-y-5" noValidate>
        {error !== null && (
          <UserFacingErrorAlert error={error} fallback="تعذر حفظ العملية." />
        )}

        <div className="grid gap-3 rounded-3xl bg-slate-950 p-2 text-sm font-bold text-white sm:grid-cols-2">
          <button
            type="button"
            onClick={() => updateOperation('delivery')}
            className={`min-h-11 rounded-2xl px-4 transition ${AMBER_FOCUS_RING_CLASS_NAME} ${form.operation === 'delivery' ? 'bg-amber-300 text-slate-950' : 'text-slate-300 hover:bg-white/10'}`}
          >
            تسليم فستان للعميلة
          </button>
          <button
            type="button"
            onClick={() => updateOperation('return')}
            className={`min-h-11 rounded-2xl px-4 transition ${AMBER_FOCUS_RING_CLASS_NAME} ${form.operation === 'return' ? 'bg-amber-300 text-slate-950' : 'text-slate-300 hover:bg-white/10'}`}
          >
            استرجاع فستان من العميلة
          </button>
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
            unavailableText="لا توجد حجوزات مؤهلة لهذه العملية حالياً."
          />

          <label className={STACKED_FORM_LABEL_CLASS_NAME}>
            التاريخ والوقت
            <input
              required
              type="datetime-local"
              max={getCurrentDateTimeLocal()}
              value={form.dateTime}
              onChange={(event) => setForm((current) => ({ ...current, dateTime: event.target.value }))}
              className={STACKED_FORM_FIELD_CLASS_NAME}
            />
          </label>
        </div>

        {selectedReservation && (
          <div className="grid gap-3 rounded-3xl border border-amber-100 bg-amber-50/80 p-4 text-sm text-slate-700 sm:grid-cols-4">
            <div>
              <p className="text-xs font-bold text-amber-800">العميلة</p>
              <p className="mt-1 font-extrabold text-slate-950">{selectedReservation.customerName}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-amber-800">العنصر</p>
              <p className="mt-1 font-extrabold text-slate-950">{selectedReservation.dressCode}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-amber-800">الإرجاع المجدول</p>
              <p className="mt-1 font-extrabold text-slate-950">{selectedReservation.returnDate}</p>
            </div>
            <div>
              <p className="text-xs font-bold text-amber-800">الرصيد الحالي</p>
              <p className="mt-1 font-extrabold text-slate-950">{formatMoneyOMR(selectedReservation.remainingAmount)}</p>
            </div>
          </div>
        )}

        <label className={STACKED_FORM_LABEL_CLASS_NAME}>
          حالة العنصر
          <textarea
            rows={2}
            value={form.condition}
            onChange={(event) => setForm((current) => ({ ...current, condition: event.target.value }))}
            className={STACKED_FORM_FIELD_CLASS_NAME}
            placeholder={form.operation === 'delivery' ? 'مثال: تم التسليم بحالة ممتازة مع الشال.' : 'مثال: يحتاج تنظيف بسيط عند الذيل.'}
          />
        </label>

        {scanFeedback && <p role="status" className="rounded-xl border border-slate-200 bg-stone-50 px-3 py-2 text-sm font-bold text-slate-700">{scanFeedback}</p>}

        {selectedReservation && (form.operation === 'delivery'
          ? (
            <DeliveryAccessoryChecklist
              mode="delivery"
              links={accessoryLinks}
              selectedIds={deliveredAccessoryIds}
              onToggle={toggleDeliveredAccessory}
              onScan={() => setShowScanner(true)}
            />
          )
          : (
            <DeliveryAccessoryChecklist
              mode="return"
              links={accessoryLinks}
              state={returnState}
              onChange={updateReturnState}
              onScan={() => setShowScanner(true)}
            />
          ))}

        {form.operation === 'return' && (
          <div className="space-y-4 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="grid gap-4 md:grid-cols-2">
              <label className={STACKED_FORM_LABEL_CLASS_NAME}>
                رسوم التأخير
                <input
                  type="number"
                  min={MIN_ZERO_AMOUNT}
                  step={MONEY_STEP}
                  inputMode="decimal"
                  value={form.lateFee}
                  onChange={(event) => setForm((current) => ({ ...current, lateFee: event.target.value }))}
                  className={STACKED_FORM_FIELD_CLASS_NAME}
                />
              </label>
              <label className={STACKED_FORM_LABEL_CLASS_NAME}>
                رسوم الضرر
                <input
                  type="number"
                  min={MIN_ZERO_AMOUNT}
                  step={MONEY_STEP}
                  inputMode="decimal"
                  value={form.damageFee}
                  onChange={(event) => setForm((current) => ({ ...current, damageFee: event.target.value }))}
                  className={STACKED_FORM_FIELD_CLASS_NAME}
                />
              </label>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <label className={STACKED_FORM_LABEL_CLASS_NAME}>
                وسيلة رد العربون
                <select
                  value={form.refundMethod}
                  onChange={(event) => setForm((current) => ({ ...current, refundMethod: event.target.value as PaymentMethod }))}
                  className={STACKED_FORM_FIELD_CLASS_NAME}
                >
                  {PAYMENT_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {BASIC_PAYMENT_METHOD_LABELS[method]}
                    </option>
                  ))}
                </select>
              </label>
              <label className={STACKED_FORM_LABEL_CLASS_NAME}>
                حالة العنصر التالية
                <select
                  value={form.nextDressStatus}
                  onChange={(event) => setForm((current) => ({ ...current, nextDressStatus: event.target.value as NextDressStatus }))}
                  className={STACKED_FORM_FIELD_CLASS_NAME}
                >
                  <option value="inspection">إلى الفحص</option>
                  <option value="laundry">إلى المغسلة</option>
                  <option value="maintenance">إلى التعديل أو الصيانة</option>
                  <option value="damaged">تالف أو متضرر</option>
                </select>
              </label>
            </div>

            {returnPreview && (
              <div className="grid gap-3 rounded-2xl bg-slate-50 p-4 text-sm sm:grid-cols-4">
                <div>
                  <p className="text-xs font-bold text-slate-500">رسوم مثبتة</p>
                  <p className="mt-1 font-extrabold text-slate-950">{formatMoneyOMR(returnPreview.settlement.assessedFeesAmount)}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-500">عربون محتجز</p>
                  <p className="mt-1 font-extrabold text-amber-700">{formatMoneyOMR(returnPreview.settlement.retainedDepositAmount)}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-500">رد متوقع</p>
                  <p className="mt-1 font-extrabold text-emerald-700">{formatMoneyOMR(returnPreview.settlement.refundAmount)}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-500">متبقي بعد الاسترجاع</p>
                  <p className="mt-1 font-extrabold text-rose-700">{formatMoneyOMR(returnPreview.remainingAfterReturn)}</p>
                </div>
              </div>
            )}
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
            placeholder="ملاحظات داخلية اختيارية عن العملية"
          />
        </label>

        {reservations.length === 0 && (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">
            لا توجد حجوزات مؤهلة لهذه العملية حالياً.
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
            {isSubmitting ? 'جارٍ الحفظ…' : 'حفظ العملية'}
          </button>
        </div>
      </form>
      {showScanner && (
        <Suspense fallback={null}>
          <BarcodeScanner onScan={handleAccessoryScan} onClose={() => setShowScanner(false)} />
        </Suspense>
      )}
    </Modal>
  );
}
