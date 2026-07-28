import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from '../../components/shared/Modal';
import { FormActions, MoneyField, SelectField, TextAreaField, TextField } from '../../components/shared/FormField';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';
import { MAX_NOTES_LENGTH, MIN_MONEY_AMOUNT, MONEY_STEP } from '../../shared/domain/businessRules';
import { AMBER_FOCUS_RING_CLASS_NAME } from '../../shared/domain/formConstants';
import { getTodayISO } from '../../shared/utils/date';
import { formatMoneyOMR } from '../../shared/utils/format';
import { createSubmissionKey } from '../../shared/utils/submissionKey';
import { SearchableSelect, type SearchableOption } from '../../components/shared/SearchableSelect';
import { BASIC_PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from '../payments/payment.constants';
import type { SaleInvoice } from './salesLedger.service';
import { createSaleInvoiceCommand } from '../workflows';
import { getSaleableDresses, type SalePaymentMethod } from './sale.service';

type Props = { open: boolean; onClose: () => void; onCreated: (invoice: SaleInvoice) => void };
type Line = { dressCode: string; amount: string };

export function CreateSaleInvoiceModal({ open, onClose, onCreated }: Props) {
  const dresses = useMemo(() => getSaleableDresses(), [open]);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [saleDate, setSaleDate] = useState(getTodayISO());
  const [paymentMethod, setPaymentMethod] = useState<SalePaymentMethod>('cash');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<Line[]>([{ dressCode: '', amount: '' }]);
  const [error, setError] = useState<unknown>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // An invoice posted twice sells the same item twice and doubles the revenue,
  // so it needs the same duplicate protection as every other money operation.
  const [submissionKey, setSubmissionKey] = useState(() => createSubmissionKey('inv'));

  const total = lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
  const dressOptions = useMemo<SearchableOption[]>(() => dresses.map((dress) => ({
    value: dress.code,
    label: `${dress.code} — ${dress.name}`,
    hint: `${dress.size} · ${dress.color}`,
    badge: formatMoneyOMR(dress.salePrice),
  })), [dresses]);

  useEffect(() => {
    if (!open) return;
    setIsSubmitting(false);
    setError(null);
    setSubmissionKey(createSubmissionKey('inv'));
  }, [open]);

  const close = () => {
    setCustomerName('');
    setCustomerPhone('');
    setSaleDate(getTodayISO());
    setPaymentMethod('cash');
    setNotes('');
    setLines([{ dressCode: '', amount: '' }]);
    setError(null);
    onClose();
  };

  const updateLine = (index: number, patch: Partial<Line>) =>
    setLines((current) => current.map((line, lineIndex) => (lineIndex === index ? { ...line, ...patch } : line)));

  const selectDress = (index: number, dressCode: string) => {
    const dress = dresses.find((item) => item.code === dressCode);
    updateLine(index, { dressCode, amount: dress ? String(dress.salePrice) : '' });
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setError(null);
    setIsSubmitting(true);

    try {
      const invoice = createSaleInvoiceCommand({
        saleDate,
        customerName,
        customerPhone,
        paymentMethod,
        notes,
        lines: lines.map((line) => ({ dressCode: line.dressCode, amount: Number(line.amount) })),
        idempotencyKey: submissionKey,
      });
      onCreated(invoice);
      close();
    } catch (reason: unknown) {
      setIsSubmitting(false);
      setError(reason);
    }
  };

  return (
    <Modal open={open} onClose={close} title="فاتورة مبيعات جديدة" className="max-w-3xl">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error !== null && <UserFacingErrorAlert error={error} fallback="تعذر تسجيل الفاتورة." />}

        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label="اسم العميلة"
            required
            autoComplete="name"
            value={customerName}
            onChange={(event) => setCustomerName(event.target.value)}
          />
          <TextField
            label="الهاتف"
            type="tel"
            inputMode="tel"
            dir="ltr"
            autoComplete="tel"
            value={customerPhone}
            onChange={(event) => setCustomerPhone(event.target.value)}
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            label="تاريخ البيع"
            required
            type="date"
            max={getTodayISO()}
            value={saleDate}
            onChange={(event) => setSaleDate(event.target.value)}
          />
          <SelectField
            label="وسيلة الدفع"
            value={paymentMethod}
            onChange={(event) => setPaymentMethod(event.target.value as SalePaymentMethod)}
          >
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>{BASIC_PAYMENT_METHOD_LABELS[method]}</option>
            ))}
          </SelectField>
        </div>

        <fieldset className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <legend className="text-sm font-bold text-slate-800">بنود الفاتورة</legend>
            <button
              type="button"
              onClick={() => setLines((current) => [...current, { dressCode: '', amount: '' }])}
              className={`inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-bold text-slate-700 transition hover:bg-stone-100 ${AMBER_FOCUS_RING_CLASS_NAME}`}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              إضافة بند
            </button>
          </div>

          {lines.map((line, index) => (
            <div key={index} className="grid gap-3 rounded-xl border border-slate-200 p-3 md:grid-cols-[1fr_170px_auto]">
              <SearchableSelect
                label={`العنصر (بند ${index + 1})`}
                required
                value={line.dressCode}
                onChange={(dressCode) => selectDress(index, dressCode)}
                options={dressOptions}
                placeholder="اختاري العنصر"
                searchPlaceholder="ابحثي بالكود أو الاسم…"
                unavailableText="لا توجد عناصر مؤهلة للبيع حالياً."
              />

                            <MoneyField
                label={`القيمة (بند ${index + 1})`}
                required
                min={MIN_MONEY_AMOUNT}
                step={MONEY_STEP}
                value={line.amount}
                onChange={(event) => updateLine(index, { amount: event.target.value })}
              />

              <div className="flex items-end">
                <button
                  type="button"
                  aria-label={`حذف البند ${index + 1}`}
                  disabled={lines.length === 1}
                  onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))}
                  className={`flex h-11 w-11 items-center justify-center rounded-xl border border-rose-200 text-rose-700 transition hover:bg-rose-50 disabled:opacity-40 ${AMBER_FOCUS_RING_CLASS_NAME}`}
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </fieldset>

        <TextAreaField
          label="ملاحظات"
          rows={3}
          maxLength={MAX_NOTES_LENGTH}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
          <p className="text-lg font-extrabold text-slate-950">الإجمالي: {formatMoneyOMR(total)}</p>
        </div>

        <FormActions
          onCancel={close}
          submitLabel="حفظ الفاتورة"
          isSubmitting={isSubmitting}
          disabled={dresses.length === 0}
        />
      </form>
    </Modal>
  );
}
