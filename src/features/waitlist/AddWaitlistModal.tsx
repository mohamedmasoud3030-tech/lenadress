import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../../components/shared/Modal';
import { FormActions, TextAreaField, TextField } from '../../components/shared/FormField';
import { SearchableSelect, type SearchableOption } from '../../components/shared/SearchableSelect';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';
import { MAX_NOTES_LENGTH } from '../../shared/domain/businessRules';
import { addDaysISO, getTodayISO } from '../../shared/utils/date';
import { createSubmissionKey } from '../../shared/utils/submissionKey';
import { getCustomers } from '../customers/customer.service';
import { summarizeAllDesigns } from '../dresses/design.service';
import { addWaitlistEntryCommand } from '../workflows';

type Props = { open: boolean; onClose: () => void; onCreated: (customerName: string) => void };

/**
 * Records a want the showroom cannot satisfy today.
 *
 * The design is offered rather than a specific piece, because the customer
 * wants *that dress*, and any piece of it in her size will do. The variant
 * counts shown are for her period, so the operator can see immediately whether
 * this is genuinely a waitlist case or something bookable right now.
 */
export function AddWaitlistModal({ open, onClose, onCreated }: Props) {
  const today = getTodayISO();
  const [customerId, setCustomerId] = useState('');
  const [designId, setDesignId] = useState('');
  const [size, setSize] = useState('');
  const [color, setColor] = useState('');
  const [pickupDate, setPickupDate] = useState(today);
  const [returnDate, setReturnDate] = useState(() => addDaysISO(today, 2));
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const customers = useMemo(() => (open ? getCustomers() : []), [open]);
  const period = useMemo(
    () => (pickupDate && returnDate && returnDate > pickupDate ? { pickupDate, returnDate } : undefined),
    [pickupDate, returnDate],
  );
  const designs = useMemo(() => (open ? summarizeAllDesigns(period) : []), [open, period]);

  useEffect(() => {
    if (!open) return;
    setCustomerId('');
    setDesignId('');
    setSize('');
    setColor('');
    setPickupDate(today);
    setReturnDate(addDaysISO(today, 2));
    setNotes('');
    setError(null);
    setIsSubmitting(false);
  }, [open, today]);

  const customerOptions = useMemo<SearchableOption[]>(() => customers.map((customer) => ({
    value: customer.id,
    label: customer.name,
    hint: customer.phone,
  })), [customers]);

  const designOptions = useMemo<SearchableOption[]>(() => designs.map((summary) => {
    const free = summary.variants.reduce((total, variant) => total + (variant.freeInPeriod ?? variant.available), 0);
    return {
      value: summary.design.id,
      label: summary.design.name,
      hint: `${summary.design.code} · ${summary.sizes.join('، ') || 'بلا مقاسات'}`,
      // Being free is not an error here: the operator may still want to record a want.
      badge: free > 0 ? `${free} متاحة الآن` : 'محجوزة بالكامل',
    };
  }), [designs]);

  const selected = designs.find((summary) => summary.design.id === designId);
  const freeNow = selected?.variants.reduce((total, variant) => total + (variant.freeInPeriod ?? 0), 0) ?? 0;

  const close = () => {
    setError(null);
    onClose();
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setError(null);
    setIsSubmitting(true);

    try {
      const entry = addWaitlistEntryCommand({
        customerId,
        designId: designId || undefined,
        size: size || undefined,
        color: color || undefined,
        pickupDate,
        returnDate,
        notes,
        idempotencyKey: createSubmissionKey('waitlist-create'),
      });
      onCreated(entry.customerName);
      close();
    } catch (reason: unknown) {
      setIsSubmitting(false);
      setError(reason);
    }
  };

  return (
    <Modal open={open} onClose={close} title="إضافة طلب انتظار" className="max-w-2xl">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error !== null && <UserFacingErrorAlert error={error} fallback="تعذر إضافة طلب الانتظار." />}

        <SearchableSelect
          label="العميلة"
          required
          value={customerId}
          onChange={setCustomerId}
          options={customerOptions}
          placeholder="اختاري العميلة"
          searchPlaceholder="ابحثي بالاسم أو رقم الهاتف…"
          unavailableText="لا توجد عميلات مسجلات بعد."
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="تاريخ الاستلام المطلوب"
            required
            type="date"
            min={today}
            value={pickupDate}
            onChange={(event) => setPickupDate(event.target.value)}
          />
          <TextField
            label="تاريخ الإرجاع المطلوب"
            required
            type="date"
            min={today}
            value={returnDate}
            error={returnDate <= pickupDate ? 'تاريخ الإرجاع يجب أن يكون بعد الاستلام.' : undefined}
            onChange={(event) => setReturnDate(event.target.value)}
          />
        </div>

        <SearchableSelect
          label="التصميم المطلوب"
          required
          value={designId}
          onChange={setDesignId}
          options={designOptions}
          placeholder="اختاري التصميم"
          searchPlaceholder="ابحثي باسم التصميم أو كوده…"
          hint="الأعداد المعروضة محسوبة للفترة المطلوبة."
          unavailableText="لا توجد تصاميم مسجلة بعد."
        />

        {selected && freeNow > 0 && (
          <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs font-bold text-emerald-800">
            يتوفر {freeNow} قطعة من هذا التصميم في الفترة المطلوبة — يمكنكِ إنشاء حجز مباشرة بدل الانتظار.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="المقاس (اختياري)"
            value={size}
            onChange={(event) => setSize(event.target.value)}
            placeholder="اتركيه فارغاً لأي مقاس"
          />
          <TextField
            label="اللون (اختياري)"
            value={color}
            onChange={(event) => setColor(event.target.value)}
            placeholder="اتركيه فارغاً لأي لون"
          />
        </div>

        <TextAreaField
          label="ملاحظات"
          rows={2}
          maxLength={MAX_NOTES_LENGTH}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          placeholder="مثال: مناسبة زفاف، تفضّل الأبيض العاجي."
        />

        <FormActions
          onCancel={close}
          submitLabel="إضافة للانتظار"
          isSubmitting={isSubmitting}
          disabled={!customerId || !designId || returnDate <= pickupDate}
        />
      </form>
    </Modal>
  );
}
