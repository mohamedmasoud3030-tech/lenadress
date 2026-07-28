import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from '../../components/shared/Modal';
import { FormActions, MoneyField, SelectField, TextAreaField, TextField } from '../../components/shared/FormField';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';
import { MAX_NOTES_LENGTH, MIN_ZERO_AMOUNT, MONEY_STEP } from '../../shared/domain/businessRules';
import { DRESS_CATEGORIES } from '../../shared/domain/dressConstants';
import { AMBER_FOCUS_RING_CLASS_NAME } from '../../shared/domain/formConstants';
import { createSubmissionKey } from '../../shared/utils/submissionKey';
import { addDesignWithVariantsCommand } from '../workflows';
import type { DressCategory } from './dress.types';
import type { DressDesign } from './design.types';

type Props = { open: boolean; onClose: () => void; onCreated: (design: DressDesign, pieces: number) => void };

type VariantRow = { size: string; color: string; quantity: string };

type Form = {
  name: string;
  description: string;
  category: DressCategory;
  defaultRentalPrice: string;
  defaultSalePrice: string;
  defaultDepositAmount: string;
  notes: string;
};

function defaults(): Form {
  return {
    name: '',
    description: '',
    category: 'زفاف',
    defaultRentalPrice: '',
    defaultSalePrice: '',
    defaultDepositAmount: '',
    notes: '',
  };
}

function emptyVariant(): VariantRow {
  return { size: '', color: '', quantity: '1' };
}

/**
 * Creates a design together with its physical pieces in one step.
 *
 * This is how a showroom actually receives stock: one model arrives in several
 * sizes and colours at once. Adding them one by one, then trying to remember
 * they belong together, is what produced the ungrouped inventory in the first
 * place.
 */
export function AddDesignModal({ open, onClose, onCreated }: Props) {
  const [form, setForm] = useState<Form>(() => defaults());
  const [variants, setVariants] = useState<VariantRow[]>([emptyVariant()]);
  const [error, setError] = useState<unknown>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionKey, setSubmissionKey] = useState(() => createSubmissionKey('dsg'));

  useEffect(() => {
    if (!open) return;
    setForm(defaults());
    setVariants([emptyVariant()]);
    setError(null);
    setIsSubmitting(false);
    setSubmissionKey(createSubmissionKey('dsg'));
  }, [open]);

  const close = () => {
    setForm(defaults());
    setVariants([emptyVariant()]);
    setError(null);
    onClose();
  };

  const updateVariant = (index: number, patch: Partial<VariantRow>) =>
    setVariants((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));

  const totalPieces = variants.reduce((total, row) => total + (Number(row.quantity) || 0), 0);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setError(null);
    setIsSubmitting(true);

    try {
      const result = addDesignWithVariantsCommand({
        design: {
          name: form.name,
          description: form.description,
          category: form.category,
          defaultRentalPrice: Number(form.defaultRentalPrice) || 0,
          defaultSalePrice: Number(form.defaultSalePrice) || 0,
          defaultDepositAmount: Number(form.defaultDepositAmount) || 0,
          notes: form.notes,
        },
        variants: variants.map((row) => ({
          size: row.size,
          color: row.color,
          quantity: Number(row.quantity) || 1,
        })),
        idempotencyKey: submissionKey,
      });
      onCreated(result.design, result.pieces.length);
      close();
    } catch (reason: unknown) {
      setIsSubmitting(false);
      setError(reason);
    }
  };

  return (
    <Modal open={open} onClose={close} title="إضافة تصميم جديد" className="max-w-3xl">
      <form onSubmit={submit} className="space-y-5" noValidate>
        {error !== null && <UserFacingErrorAlert error={error} fallback="تعذر إضافة التصميم." />}

        <TextField
          label="اسم التصميم"
          required
          value={form.name}
          onChange={(event) => setForm({ ...form, name: event.target.value })}
          placeholder="مثال: فستان زفاف حورية دانتيل"
        />

        <div className="grid gap-4 md:grid-cols-2">
          <SelectField
            label="الفئة"
            value={form.category}
            onChange={(event) => setForm({ ...form, category: event.target.value as DressCategory })}
          >
            {DRESS_CATEGORIES.map((category) => (
              <option key={category} value={category}>{category}</option>
            ))}
          </SelectField>

          <TextField
            label="وصف مختصر"
            value={form.description}
            onChange={(event) => setForm({ ...form, description: event.target.value })}
          />
        </div>

        <fieldset className="grid gap-4 md:grid-cols-3">
          <legend className="mb-1 text-sm font-bold text-slate-800">الأسعار الافتراضية للقطع</legend>
          <MoneyField
            label="سعر الإيجار"
            min={MIN_ZERO_AMOUNT}
            step={MONEY_STEP}
            value={form.defaultRentalPrice}
            onChange={(event) => setForm({ ...form, defaultRentalPrice: event.target.value })}
          />
          <MoneyField
            label="سعر البيع"
            min={MIN_ZERO_AMOUNT}
            step={MONEY_STEP}
            value={form.defaultSalePrice}
            onChange={(event) => setForm({ ...form, defaultSalePrice: event.target.value })}
          />
          <MoneyField
            label="مبلغ التأمين"
            min={MIN_ZERO_AMOUNT}
            step={MONEY_STEP}
            value={form.defaultDepositAmount}
            onChange={(event) => setForm({ ...form, defaultDepositAmount: event.target.value })}
          />
        </fieldset>

        <fieldset className="space-y-3 rounded-2xl border border-slate-200 bg-stone-50/70 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <legend className="text-sm font-bold text-slate-800">المقاسات والألوان المتوفرة</legend>
            <button
              type="button"
              onClick={() => setVariants((current) => [...current, emptyVariant()])}
              className={`inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 transition hover:bg-stone-100 ${AMBER_FOCUS_RING_CLASS_NAME}`}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              إضافة مقاس / لون
            </button>
          </div>

          {variants.map((row, index) => (
            <div key={index} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-[1fr_1fr_110px_auto]">
              <TextField
                label={`المقاس ${index + 1}`}
                required
                value={row.size}
                onChange={(event) => updateVariant(index, { size: event.target.value })}
                placeholder="M"
              />
              <TextField
                label={`اللون ${index + 1}`}
                required
                value={row.color}
                onChange={(event) => updateVariant(index, { color: event.target.value })}
                placeholder="أبيض"
              />
              <TextField
                label="العدد"
                type="number"
                inputMode="numeric"
                min={1}
                max={50}
                value={row.quantity}
                onChange={(event) => updateVariant(index, { quantity: event.target.value })}
              />
              <div className="flex items-end">
                <button
                  type="button"
                  aria-label={`حذف المقاس ${index + 1}`}
                  disabled={variants.length === 1}
                  onClick={() => setVariants((current) => current.filter((_, rowIndex) => rowIndex !== index))}
                  className={`flex h-11 w-11 items-center justify-center rounded-xl border border-rose-200 text-rose-700 transition hover:bg-rose-50 disabled:opacity-40 ${AMBER_FOCUS_RING_CLASS_NAME}`}
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}

          <p className="text-xs font-bold text-slate-600">
            سيتم إنشاء {totalPieces} قطعة، لكل واحدة كود مخزون وباركود مستقل.
          </p>
        </fieldset>

        <TextAreaField
          label="ملاحظات"
          rows={2}
          maxLength={MAX_NOTES_LENGTH}
          value={form.notes}
          onChange={(event) => setForm({ ...form, notes: event.target.value })}
        />

        <FormActions
          onCancel={close}
          submitLabel={`حفظ التصميم و${totalPieces} قطعة`}
          isSubmitting={isSubmitting}
          disabled={totalPieces === 0}
        />
      </form>
    </Modal>
  );
}
