import { useEffect, useId, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { Modal } from '../../components/shared/Modal';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';
import { MAX_NOTES_LENGTH, MIN_ZERO_AMOUNT, MONEY_STEP } from '../../shared/domain/businessRules';
import { FORM_ERROR_CLASS_NAME, FORM_FIELD_CLASS_NAME, FORM_LABEL_CLASS_NAME } from '../../shared/domain/formConstants';
import { createSubmissionKey } from '../../shared/utils/submissionKey';
import { addDressCommand } from '../workflows';
import type { Dress } from './dress.types';
import { ImageUpload } from './ImageUpload';
import { generateDressBarcodeValue } from './barcode.utils';
import { INVENTORY_ITEM_TYPE_LABELS, INVENTORY_ITEM_TYPE_OPTIONS } from '../../shared/domain/dressConstants';

const initialStatuses = ['available', 'laundry', 'maintenance', 'damaged', 'inactive'] as const;

const dressSchema = z
  .object({
    name: z.string().trim().min(2, 'اكتبي اسم العنصر بشكل واضح.').max(100, 'الاسم طويل جداً.'),
    description: z.string().trim().max(300, 'الوصف يجب ألا يتجاوز 300 حرف.').optional(),
    itemType: z.enum(['dress', 'accessory', 'bag', 'shoe', 'veil', 'other']),
    category: z.enum(['زفاف', 'خطوبة', 'سهرة', 'أطفال', 'إكسسوارات', 'حقائب', 'أحذية', 'طرح وشالات', 'أخرى']),
    color: z.string().trim().min(1, 'لون العنصر مطلوب.').max(50, 'اسم اللون طويل جداً.'),
    size: z.string().trim().min(1, 'المقاس مطلوب.').max(30, 'المقاس طويل جداً.'),
    purchasePrice: z.coerce.number().finite('سعر الشراء غير صالح.').min(MIN_ZERO_AMOUNT, 'سعر الشراء لا يمكن أن يكون سالباً.'),
    rentalPrice: z.coerce.number().finite('سعر الإيجار غير صالح.').min(MIN_ZERO_AMOUNT, 'سعر الإيجار لا يمكن أن يكون سالباً.'),
    salePrice: z.coerce.number().finite('سعر البيع غير صالح.').min(MIN_ZERO_AMOUNT, 'سعر البيع لا يمكن أن يكون سالباً.'),
    depositAmount: z.coerce.number().finite('قيمة التأمين غير صالحة.').min(MIN_ZERO_AMOUNT, 'قيمة التأمين لا يمكن أن تكون سالبة.'), // legacy compat
    status: z.enum(initialStatuses),
    isForRent: z.boolean(),
    isForSale: z.boolean(),
    notes: z.string().trim().max(MAX_NOTES_LENGTH, `الملاحظات يجب ألا تتجاوز ${MAX_NOTES_LENGTH} حرف.`).optional(),
  })
  .superRefine((values, context) => {
    if (!values.isForRent && !values.isForSale) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['isForRent'],
        message: 'حددي أن العنصر للبيع أو للإيجار على الأقل.',
      });
    }

    if (values.isForRent && values.rentalPrice <= 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['rentalPrice'],
        message: 'أدخلي سعر الإيجار للفساتين المتاحة للإيجار.',
      });
    }

    if (values.isForSale && values.salePrice <= 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['salePrice'],
        message: 'أدخلي سعر البيع للفساتين المتاحة للبيع.',
      });
    }
  });

type DressFormValues = z.infer<typeof dressSchema>;

type AddDressModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated: (dress: Dress) => void;
};

const statusLabels: Record<(typeof initialStatuses)[number], string> = {
  available: 'متاح',
  laundry: 'في المغسلة',
  maintenance: 'تحت التعديل',
  damaged: 'تالف',
  inactive: 'غير نشط',
};

const dressFieldClassName = `${FORM_FIELD_CLASS_NAME} read-only:cursor-not-allowed read-only:bg-stone-100 read-only:text-slate-400`;

function getDefaultValues(): DressFormValues {
  return {
    name: '',
    description: '',
    itemType: 'dress',
    category: 'سهرة',
    color: '',
    size: '',
    purchasePrice: 0,
    rentalPrice: 0,
    salePrice: 0,
    depositAmount: 0, // legacy compat
    status: 'available',
    isForRent: true,
    isForSale: false,
    notes: '',
  };
}

export function AddDressModal({ open, onClose, onCreated }: AddDressModalProps) {
  const fieldId = useId();
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [images, setImages] = useState<string[]>([]);
  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<DressFormValues>({
    resolver: zodResolver(dressSchema),
    defaultValues: getDefaultValues(),
  });

  const isForRent = watch('isForRent');
  const isForSale = watch('isForSale');
  const itemType = watch('itemType');
  const supportsSize = itemType === 'dress' || itemType === 'shoe' || itemType === 'veil';
  const supportsDeposit = itemType === 'dress';

  useEffect(() => {
    if (!open) return;
    reset(getDefaultValues());
    setSubmitError(null);
  }, [open, reset]);

  const closeModal = () => {
    reset(getDefaultValues());
    setSubmitError(null);
    onClose();
  };

  const onSubmit = (values: DressFormValues) => {
    setSubmitError(null);

    try {
      const dress = addDressCommand({
        images: images,
        barcode: generateDressBarcodeValue(),
        ...values,
        description: values.description || '',
        rentalPrice: values.isForRent ? values.rentalPrice : 0,
        salePrice: values.isForSale ? values.salePrice : 0,
        depositAmount: values.isForRent ? values.depositAmount : 0, // legacy compat
        notes: values.notes || undefined,
        idempotencyKey: createSubmissionKey('inventory-create'),
      });
      onCreated(dress);
      closeModal();
    } catch (error: unknown) {
      setSubmitError(error);
    }
  };

  return (
    <Modal open={open} onClose={closeModal} title="إضافة عنصر مخزون جديد" className="max-w-3xl">
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
        <ImageUpload images={images} onChange={setImages} maxImages={5} />
        {submitError !== null && (
          <UserFacingErrorAlert error={submitError} fallback="تعذر إضافة العنصر. حاولي مرة أخرى." />
        )}

        <div className="grid gap-4 md:grid-cols-3">
          <div>
            <label htmlFor={`${fieldId}-name`} className={FORM_LABEL_CLASS_NAME}>اسم العنصر</label>
            <input id={`${fieldId}-name`} {...register('name')} className={dressFieldClassName} placeholder="مثال: فستان سهرة كحلي مطرز أو حقيبة سهرة فضية" />
            {errors.name && <p className={FORM_ERROR_CLASS_NAME}>{errors.name.message}</p>}
          </div>
          <div>
            <label htmlFor={`${fieldId}-item-type`} className={FORM_LABEL_CLASS_NAME}>نوع العنصر</label>
            <select id={`${fieldId}-item-type`} {...register('itemType')} className={dressFieldClassName}>
              {INVENTORY_ITEM_TYPE_OPTIONS.map((itemType) => (
                <option key={itemType} value={itemType}>{INVENTORY_ITEM_TYPE_LABELS[itemType]}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${fieldId}-category`} className={FORM_LABEL_CLASS_NAME}>الفئة</label>
            <select id={`${fieldId}-category`} {...register('category')} className={dressFieldClassName}>
              <option value="زفاف">زفاف</option>
              <option value="خطوبة">خطوبة</option>
              <option value="سهرة">سهرة</option>
              <option value="أطفال">أطفال</option>
              <option value="إكسسوارات">إكسسوارات</option>
              <option value="حقائب">حقائب</option>
              <option value="أحذية">أحذية</option>
              <option value="طرح وشالات">طرح وشالات</option>
              <option value="أخرى">أخرى</option>
            </select>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor={`${fieldId}-color`} className={FORM_LABEL_CLASS_NAME}>اللون</label>
            <input id={`${fieldId}-color`} {...register('color')} className={dressFieldClassName} placeholder="مثال: كحلي أو فضي" />
            {errors.color && <p className={FORM_ERROR_CLASS_NAME}>{errors.color.message}</p>}
          </div>
          <div>
            <label htmlFor={`${fieldId}-size`} className={FORM_LABEL_CLASS_NAME}>المقاس</label>
            <input id={`${fieldId}-size`} dir="ltr" {...register('size')} readOnly={!supportsSize} className={dressFieldClassName} placeholder={supportsSize ? 'مثال: M أو 42 أو One Size' : 'غير مطلوب غالباً لهذا النوع'} />
            {errors.size && <p className={FORM_ERROR_CLASS_NAME}>{errors.size.message}</p>}
          </div>
        </div>

        <div>
          <label htmlFor={`${fieldId}-description`} className={FORM_LABEL_CLASS_NAME}>وصف مختصر</label>
          <textarea id={`${fieldId}-description`} rows={3} maxLength={300} {...register('description')} className={dressFieldClassName} placeholder="تفاصيل القصة أو التطريز أو الاستخدام المناسب" />
          {errors.description && <p className={FORM_ERROR_CLASS_NAME}>{errors.description.message}</p>}
        </div>

        <fieldset className="rounded-xl border border-slate-200 bg-stone-50 p-4">
          <legend className="px-1 text-sm font-bold text-slate-700">نوع الاستخدام</legend>
          <div className="mt-2 flex flex-wrap gap-5">
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm font-bold text-slate-800">
              <input type="checkbox" {...register('isForRent')} className="h-4 w-4 cursor-pointer rounded border-slate-300 text-slate-950 focus-visible:ring-2 focus-visible:ring-amber-500" />
              متاح للإيجار
            </label>
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm font-bold text-slate-800">
              <input type="checkbox" {...register('isForSale')} className="h-4 w-4 cursor-pointer rounded border-slate-300 text-slate-950 focus-visible:ring-2 focus-visible:ring-amber-500" />
              متاح للبيع
            </label>
          </div>
          {errors.isForRent && <p className={FORM_ERROR_CLASS_NAME}>{errors.isForRent.message}</p>}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <label htmlFor={`${fieldId}-purchase-price`} className={FORM_LABEL_CLASS_NAME}>سعر الشراء (ر.ع)</label>
            <input id={`${fieldId}-purchase-price`} type="number" min={MIN_ZERO_AMOUNT} step={MONEY_STEP} inputMode="decimal" {...register('purchasePrice')} className={dressFieldClassName} />
            {errors.purchasePrice && <p className={FORM_ERROR_CLASS_NAME}>{errors.purchasePrice.message}</p>}
          </div>
          <div>
            <label htmlFor={`${fieldId}-rental-price`} className={FORM_LABEL_CLASS_NAME}>سعر الإيجار (ر.ع)</label>
            <input id={`${fieldId}-rental-price`} type="number" min={MIN_ZERO_AMOUNT} step={MONEY_STEP} inputMode="decimal" readOnly={!isForRent} {...register('rentalPrice')} className={dressFieldClassName} />
            {errors.rentalPrice && <p className={FORM_ERROR_CLASS_NAME}>{errors.rentalPrice.message}</p>}
          </div>
          <div>
            <label htmlFor={`${fieldId}-deposit`} className={FORM_LABEL_CLASS_NAME}>التأمين (ر.ع)</label>
            <input id={`${fieldId}-deposit`} type="number" min={MIN_ZERO_AMOUNT} step={MONEY_STEP} inputMode="decimal" readOnly={!isForRent || !supportsDeposit} {...register('depositAmount')} className={dressFieldClassName} /> {/* legacy compat */}
            {errors.depositAmount && <p className={FORM_ERROR_CLASS_NAME}>{errors.depositAmount.message}</p>} {/* legacy compat */}
          </div>
          <div>
            <label htmlFor={`${fieldId}-sale-price`} className={FORM_LABEL_CLASS_NAME}>سعر البيع (ر.ع)</label>
            <input id={`${fieldId}-sale-price`} type="number" min={MIN_ZERO_AMOUNT} step={MONEY_STEP} inputMode="decimal" readOnly={!isForSale} {...register('salePrice')} className={dressFieldClassName} />
            {errors.salePrice && <p className={FORM_ERROR_CLASS_NAME}>{errors.salePrice.message}</p>}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label htmlFor={`${fieldId}-status`} className={FORM_LABEL_CLASS_NAME}>حالة البداية</label>
            <select id={`${fieldId}-status`} {...register('status')} className={dressFieldClassName}>
              {initialStatuses.map((status) => (
                <option key={status} value={status}>{statusLabels[status]}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${fieldId}-notes`} className={FORM_LABEL_CLASS_NAME}>ملاحظات</label>
            <textarea id={`${fieldId}-notes`} rows={3} maxLength={MAX_NOTES_LENGTH} {...register('notes')} className={dressFieldClassName} placeholder="ملاحظات اختيارية عن العنصر أو التجهيز" />
            {errors.notes && <p className={FORM_ERROR_CLASS_NAME}>{errors.notes.message}</p>}
          </div>
        </div>

        <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={closeModal}
            className="min-h-11 cursor-pointer rounded-xl border border-slate-300 px-5 py-2 text-sm font-bold text-slate-700 transition duration-200 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 active:scale-95"
          >
            إلغاء
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="min-h-11 cursor-pointer rounded-xl bg-slate-950 px-5 py-2 text-sm font-bold text-white transition duration-200 hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 active:scale-95"
          >
            {isSubmitting ? 'جارٍ الحفظ...' : 'إضافة العنصر'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
