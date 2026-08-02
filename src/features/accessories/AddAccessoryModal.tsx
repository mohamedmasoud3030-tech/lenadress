import { useEffect, useId, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Modal } from '../../components/shared/Modal';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';
import { MAX_NOTES_LENGTH, MIN_ZERO_AMOUNT, MONEY_STEP } from '../../shared/domain/businessRules';
import { FORM_ERROR_CLASS_NAME, FORM_FIELD_CLASS_NAME, FORM_LABEL_CLASS_NAME } from '../../shared/domain/formConstants';
import {
  ACCESSORY_CATEGORY_LABELS,
  ACCESSORY_CATEGORY_OPTIONS,
  ACCESSORY_STATUS_LABELS,
  ACCESSORY_STATUS_OPTIONS,
} from '../../shared/domain/accessoryConstants';
import { createSubmissionKey } from '../../shared/utils/submissionKey';
import { addAccessoryCommand } from '../workflows';
import type { Accessory } from './accessory.types';

const accessorySchema = z.object({
  name: z.string().trim().min(2, 'اكتبي اسم الملحق بشكل واضح.').max(100, 'الاسم طويل جداً.'),
  category: z.enum(['veil', 'crown', 'belt', 'bag', 'gloves', 'jewellery', 'shoes', 'other']),
  status: z.enum(['available', 'service', 'lost', 'damaged', 'retired']),
  rentalPrice: z.coerce.number().finite('سعر التأجير غير صالح.').min(MIN_ZERO_AMOUNT, 'سعر التأجير لا يمكن أن يكون سالباً.'),
  salePrice: z.coerce.number().finite('سعر البيع غير صالح.').min(MIN_ZERO_AMOUNT, 'سعر البيع لا يمكن أن يكون سالباً.'),
  depositAmount: z.coerce.number().finite('مبلغ التأمين غير صالح.').min(MIN_ZERO_AMOUNT, 'مبلغ التأمين لا يمكن أن يكون سالباً.'), // legacy compat
  notes: z.string().trim().max(MAX_NOTES_LENGTH, `الملاحظات يجب ألا تتجاوز ${MAX_NOTES_LENGTH} حرف.`).optional(),
});

type AccessoryFormValues = z.infer<typeof accessorySchema>;

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (accessory: Accessory) => void;
};

function getDefaultValues(): AccessoryFormValues {
  return {
    name: '',
    category: 'veil',
    status: 'available',
    rentalPrice: 0,
    salePrice: 0,
    depositAmount: 0, // legacy compat
    notes: '',
  };
}

export function AddAccessoryModal({ open, onClose, onCreated }: Props) {
  const fieldId = useId();
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionKey, setSubmissionKey] = useState(() => createSubmissionKey('acc'));

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<AccessoryFormValues>({
    resolver: zodResolver(accessorySchema),
    defaultValues: getDefaultValues(),
  });

  useEffect(() => {
    if (!open) return;
    reset(getDefaultValues());
    setSubmitError(null);
    setIsSubmitting(false);
    setSubmissionKey(createSubmissionKey('acc'));
  }, [open, reset]);

  const closeModal = () => {
    reset(getDefaultValues());
    setSubmitError(null);
    onClose();
  };

  const onSubmit = (values: AccessoryFormValues) => {
    if (isSubmitting) return;
    setSubmitError(null);
    setIsSubmitting(true);

    try {
      const accessory = addAccessoryCommand({
        name: values.name,
        category: values.category,
        status: values.status,
        // Zero means "not priced for this channel", which is stored as absent.
        rentalPrice: values.rentalPrice > 0 ? values.rentalPrice : undefined,
        salePrice: values.salePrice > 0 ? values.salePrice : undefined,
        depositAmount: values.depositAmount > 0 ? values.depositAmount : undefined, // legacy compat
        notes: values.notes,
        idempotencyKey: submissionKey,
      });
      onCreated(accessory);
      closeModal();
    } catch (error: unknown) {
      setIsSubmitting(false);
      setSubmitError(error);
    }
  };

  return (
    <Modal open={open} onClose={closeModal} title="إضافة ملحق جديد" className="max-w-2xl">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
        {submitError !== null && <UserFacingErrorAlert error={submitError} fallback="تعذر إضافة الملحق. حاولي مرة أخرى." />}

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor={`${fieldId}-name`} className={FORM_LABEL_CLASS_NAME}>اسم الملحق</label>
            <input id={`${fieldId}-name`} {...register('name')} className={FORM_FIELD_CLASS_NAME} placeholder="مثال: طرحة دانتيل طويلة" />
            {errors.name && <p className={FORM_ERROR_CLASS_NAME}>{errors.name.message}</p>}
          </div>
          <div>
            <label htmlFor={`${fieldId}-category`} className={FORM_LABEL_CLASS_NAME}>الفئة</label>
            <select id={`${fieldId}-category`} {...register('category')} className={FORM_FIELD_CLASS_NAME}>
              {ACCESSORY_CATEGORY_OPTIONS.map((category) => (
                <option key={category} value={category}>{ACCESSORY_CATEGORY_LABELS[category]}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor={`${fieldId}-status`} className={FORM_LABEL_CLASS_NAME}>الحالة التشغيلية</label>
          <select id={`${fieldId}-status`} {...register('status')} className={FORM_FIELD_CLASS_NAME}>
            {ACCESSORY_STATUS_OPTIONS.map((status) => (
              <option key={status} value={status}>{ACCESSORY_STATUS_LABELS[status]}</option>
            ))}
          </select>
        </div>

        <fieldset className="grid gap-4 md:grid-cols-3">
          <legend className="sr-only">أسعار الملحق</legend>
          <div>
            <label htmlFor={`${fieldId}-rental`} className={FORM_LABEL_CLASS_NAME}>سعر التأجير (اختياري)</label>
            <input id={`${fieldId}-rental`} type="number" min={MIN_ZERO_AMOUNT} step={MONEY_STEP} inputMode="decimal" {...register('rentalPrice')} className={FORM_FIELD_CLASS_NAME} />
            {errors.rentalPrice && <p className={FORM_ERROR_CLASS_NAME}>{errors.rentalPrice.message}</p>}
          </div>
          <div>
            <label htmlFor={`${fieldId}-sale`} className={FORM_LABEL_CLASS_NAME}>سعر البيع (اختياري)</label>
            <input id={`${fieldId}-sale`} type="number" min={MIN_ZERO_AMOUNT} step={MONEY_STEP} inputMode="decimal" {...register('salePrice')} className={FORM_FIELD_CLASS_NAME} />
            {errors.salePrice && <p className={FORM_ERROR_CLASS_NAME}>{errors.salePrice.message}</p>}
          </div>
          <div>
            <label htmlFor={`${fieldId}-deposit`} className={FORM_LABEL_CLASS_NAME}>مبلغ التأمين (اختياري)</label>
            <input id={`${fieldId}-deposit`} type="number" min={MIN_ZERO_AMOUNT} step={MONEY_STEP} inputMode="decimal" {...register('depositAmount')} className={FORM_FIELD_CLASS_NAME} /> // legacy compat
            {errors.depositAmount && <p className={FORM_ERROR_CLASS_NAME}>{errors.depositAmount.message}</p>} // legacy compat
          </div>
        </fieldset>

        <div>
          <label htmlFor={`${fieldId}-notes`} className={FORM_LABEL_CLASS_NAME}>ملاحظات</label>
          <textarea id={`${fieldId}-notes`} rows={3} maxLength={MAX_NOTES_LENGTH} {...register('notes')} className={FORM_FIELD_CLASS_NAME} placeholder="ملاحظات اختيارية عن الملحق" />
          {errors.notes && <p className={FORM_ERROR_CLASS_NAME}>{errors.notes.message}</p>}
        </div>

        <p className="rounded-xl bg-stone-50 px-3 py-2 text-xs leading-5 text-slate-600">
          يُخصص كود مخزون ثابت للملحق تلقائياً، ويُشتق منه الباركود، فلا يتكرر ولا يتغير بعد الحفظ.
        </p>

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
            disabled={isSubmitting}
            className="min-h-11 rounded-xl bg-slate-950 px-5 py-2 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
          >
            {isSubmitting ? 'جارٍ الحفظ…' : 'حفظ الملحق'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
