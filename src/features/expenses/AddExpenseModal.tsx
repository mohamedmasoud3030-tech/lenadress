import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../../components/shared/Modal';
import { FormActions, MoneyField, SelectField, TextAreaField, TextField } from '../../components/shared/FormField';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';
import { MAX_NOTES_LENGTH, MIN_MONEY_AMOUNT, MONEY_STEP } from '../../shared/domain/businessRules';
import { getTodayISO } from '../../shared/utils/date';
import { createSubmissionKey } from '../../shared/utils/submissionKey';
import { getAccessories } from '../accessories/accessory.service';
import { getDresses } from '../dresses/dress.service';
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS, EXPENSE_PAYMENT_METHOD_LABELS, EXPENSE_PAYMENT_METHODS } from './expense.constants';
import { postExpenseCommand } from '../workflows';
import type { ExpenseCategory, ExpensePaymentMethod, ExpenseRecord } from './expense.types';

type Props = { open: boolean; onClose: () => void; onCreated: (expense: ExpenseRecord) => void };

type Form = {
  expenseDate: string;
  title: string;
  category: ExpenseCategory;
  amount: string;
  paymentMethod: ExpensePaymentMethod;
  /** `dress:CODE` or `accessory:CODE`, so one control links either family. */
  relatedItem: string;
  notes: string;
};

function defaults(): Form {
  return {
    expenseDate: getTodayISO(),
    title: '',
    category: 'laundry',
    amount: '',
    paymentMethod: 'cash',
    relatedItem: '',
    notes: '',
  };
}

export function AddExpenseModal({ open, onClose, onCreated }: Props) {
  const [form, setForm] = useState<Form>(() => defaults());
  const [error, setError] = useState<unknown>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // A cost posted twice is real money lost from the books, so the same
  // duplicate-submit protection the other money screens use applies here too.
  const [submissionKey, setSubmissionKey] = useState(() => createSubmissionKey('exp'));

  const dresses = useMemo(() => getDresses(), [open]);
  const accessories = useMemo(() => getAccessories(), [open]);

  useEffect(() => {
    if (!open) return;
    setForm(defaults());
    setError(null);
    setIsSubmitting(false);
    setSubmissionKey(createSubmissionKey('exp'));
  }, [open]);

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

    const [kind, code] = form.relatedItem.split(':');

    try {
      const expense = postExpenseCommand({
        expenseDate: form.expenseDate,
        title: form.title,
        category: form.category,
        amount: Number(form.amount),
        paymentMethod: form.paymentMethod,
        relatedDressCode: kind === 'dress' ? code : undefined,
        relatedAccessoryCode: kind === 'accessory' ? code : undefined,
        notes: form.notes,
        idempotencyKey: submissionKey,
      });
      onCreated(expense);
      close();
    } catch (reason: unknown) {
      setIsSubmitting(false);
      setError(reason);
    }
  };

  return (
    <Modal open={open} onClose={close} title="تسجيل مصروف جديد" className="max-w-2xl">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error !== null && <UserFacingErrorAlert error={error} fallback="تعذر تسجيل المصروف." />}

        <TextField
          label="العنوان"
          required
          value={form.title}
          onChange={(event) => setForm({ ...form, title: event.target.value })}
          placeholder="مثال: تنظيف فستان بعد الإرجاع"
        />

        <div className="grid gap-4 md:grid-cols-2">
          <SelectField
            label="الفئة"
            value={form.category}
            onChange={(event) => setForm({ ...form, category: event.target.value as ExpenseCategory })}
          >
            {EXPENSE_CATEGORIES.map((category) => (
              <option key={category} value={category}>{EXPENSE_CATEGORY_LABELS[category]}</option>
            ))}
          </SelectField>

          <MoneyField
            label="القيمة (ر.ع)"
            required
            min={MIN_MONEY_AMOUNT}
            step={MONEY_STEP}
            value={form.amount}
            onChange={(event) => setForm({ ...form, amount: event.target.value })}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label="تاريخ المصروف"
            required
            type="date"
            max={getTodayISO()}
            value={form.expenseDate}
            onChange={(event) => setForm({ ...form, expenseDate: event.target.value })}
          />

          <SelectField
            label="وسيلة الدفع"
            value={form.paymentMethod}
            onChange={(event) => setForm({ ...form, paymentMethod: event.target.value as ExpensePaymentMethod })}
          >
            {EXPENSE_PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>{EXPENSE_PAYMENT_METHOD_LABELS[method]}</option>
            ))}
          </SelectField>
        </div>

        <SelectField
          label="ربط بعنصر (اختياري)"
          hint="ربط المصروف بفستان أو ملحق يجعله يظهر في تقرير ربحية ذلك العنصر."
          value={form.relatedItem}
          onChange={(event) => setForm({ ...form, relatedItem: event.target.value })}
        >
          <option value="">بدون ربط</option>
          <optgroup label="فساتين">
            {dresses.map((dress) => (
              <option key={dress.id} value={`dress:${dress.code}`}>{dress.code} — {dress.name}</option>
            ))}
          </optgroup>
          <optgroup label="ملحقات">
            {accessories.map((accessory) => (
              <option key={accessory.id} value={`accessory:${accessory.code}`}>{accessory.code} — {accessory.name}</option>
            ))}
          </optgroup>
        </SelectField>

        <TextAreaField
          label="ملاحظات"
          rows={3}
          maxLength={MAX_NOTES_LENGTH}
          value={form.notes}
          onChange={(event) => setForm({ ...form, notes: event.target.value })}
        />

        <FormActions onCancel={close} submitLabel="تسجيل المصروف" isSubmitting={isSubmitting} />
      </form>
    </Modal>
  );
}
