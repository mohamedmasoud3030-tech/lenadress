import type { FormEvent } from 'react';
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from '../../components/shared/Modal';
import { FormActions, MoneyField, TextField } from '../../components/shared/FormField';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';
import { MIN_ZERO_AMOUNT, MONEY_STEP } from '../../shared/domain/businessRules';
import { AMBER_FOCUS_RING_CLASS_NAME } from '../../shared/domain/formConstants';
import { createSubmissionKey } from '../../shared/utils/submissionKey';
import { addDesignVariantsCommand } from '../workflows';
import type { DressDesign } from './design.types';

type Props = {
  open: boolean;
  design: DressDesign | null;
  onClose: () => void;
  onAdded: (count: number) => void;
};

type VariantRow = { size: string; color: string; quantity: string; rentalPrice: string };

function emptyRow(): VariantRow {
  return { size: '', color: '', quantity: '1', rentalPrice: '' };
}

/**
 * Adds more sizes, colours or copies to an existing design.
 *
 * Stock does not all arrive on the same day: a showroom re-orders a popular
 * size, or receives the same gown in a new colour weeks later. Without this the
 * design could only ever hold what was typed when it was first created, which
 * made the grouping useless the moment inventory changed.
 */
export function AddVariantsModal({ open, design, onClose, onAdded }: Props) {
  const [rows, setRows] = useState<VariantRow[]>([emptyRow()]);
  const [error, setError] = useState<unknown>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionKey, setSubmissionKey] = useState(() => createSubmissionKey('var'));

  useEffect(() => {
    if (!open) return;
    setRows([emptyRow()]);
    setError(null);
    setIsSubmitting(false);
    setSubmissionKey(createSubmissionKey('var'));
  }, [open]);

  const close = () => {
    setRows([emptyRow()]);
    setError(null);
    onClose();
  };

  const update = (index: number, patch: Partial<VariantRow>) =>
    setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));

  const totalPieces = rows.reduce((total, row) => total + (Number(row.quantity) || 0), 0);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting || !design) return;
    setError(null);
    setIsSubmitting(true);

    try {
      const created = addDesignVariantsCommand(
        design.id,
        rows.map((row) => ({
          size: row.size,
          color: row.color,
          quantity: Number(row.quantity) || 1,
          // An empty price falls back to the design default.
          rentalPrice: row.rentalPrice ? Number(row.rentalPrice) : undefined,
        })),
        submissionKey,
      );
      onAdded(created.length);
      close();
    } catch (reason: unknown) {
      setIsSubmitting(false);
      setError(reason);
    }
  };

  if (!design) return null;

  return (
    <Modal open={open} onClose={close} title={`إضافة قطع إلى ${design.name}`} className="max-w-3xl">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error !== null && <UserFacingErrorAlert error={error} fallback="تعذر إضافة القطع." />}

        <p className="rounded-xl bg-stone-50 p-3 text-xs leading-5 text-slate-600">
          كل قطعة ستحصل على كود مخزون وباركود مستقل. اتركي سعر الإيجار فارغاً لاستخدام سعر التصميم الافتراضي.
        </p>

        {rows.map((row, index) => (
          <div key={index} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-[1fr_1fr_90px_1fr_auto]">
            <TextField
              label={`المقاس ${index + 1}`}
              required
              value={row.size}
              onChange={(event) => update(index, { size: event.target.value })}
              placeholder="M"
            />
            <TextField
              label={`اللون ${index + 1}`}
              required
              value={row.color}
              onChange={(event) => update(index, { color: event.target.value })}
              placeholder="أبيض"
            />
            <TextField
              label="العدد"
              type="number"
              inputMode="numeric"
              min={1}
              max={50}
              value={row.quantity}
              onChange={(event) => update(index, { quantity: event.target.value })}
            />
            <MoneyField
              label="سعر الإيجار"
              min={MIN_ZERO_AMOUNT}
              step={MONEY_STEP}
              value={row.rentalPrice}
              onChange={(event) => update(index, { rentalPrice: event.target.value })}
              placeholder="افتراضي"
            />
            <div className="flex items-end">
              <button
                type="button"
                aria-label={`حذف الصف ${index + 1}`}
                disabled={rows.length === 1}
                onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}
                className={`flex h-11 w-11 items-center justify-center rounded-xl border border-rose-200 text-rose-700 transition hover:bg-rose-50 disabled:opacity-40 ${AMBER_FOCUS_RING_CLASS_NAME}`}
              >
                <Trash2 aria-hidden="true" className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}

        <button
          type="button"
          onClick={() => setRows((current) => [...current, emptyRow()])}
          className={`inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 transition hover:bg-stone-100 ${AMBER_FOCUS_RING_CLASS_NAME}`}
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
          صف آخر
        </button>

        <FormActions
          onCancel={close}
          submitLabel={`إضافة ${totalPieces} قطعة`}
          isSubmitting={isSubmitting}
          disabled={totalPieces === 0}
        />
      </form>
    </Modal>
  );
}
