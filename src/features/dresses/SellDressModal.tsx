import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../../components/shared/Modal';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';
import { MAX_NOTES_LENGTH, MIN_MONEY_AMOUNT, MONEY_STEP } from '../../shared/domain/businessRules';
import { STACKED_FORM_FIELD_CLASS_NAME, STACKED_FORM_LABEL_CLASS_NAME } from '../../shared/domain/formConstants';
import { INVENTORY_ITEM_TYPE_LABELS } from '../../shared/domain/dressConstants';
import { getTodayISO } from '../../shared/utils/date';
import { formatMoneyOMR } from '../../shared/utils/format';
import { BASIC_PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from '../payments/payment.constants';
import { getSaleableDresses, type SalePaymentMethod } from './sale.service';
import { quickSaleCommand } from '../workflows';
import type { SaleInvoice } from './salesLedger.service';

type Props = { open: boolean; onClose: () => void; onCreated: (invoice: SaleInvoice) => void };
type Form = { dressCode: string; saleDate: string; customerName: string; customerPhone: string; amount: string; paymentMethod: SalePaymentMethod; notes: string };
function defaults(): Form { return { dressCode: '', saleDate: getTodayISO(), customerName: '', customerPhone: '', amount: '', paymentMethod: 'cash', notes: '' }; }

export function SellDressModal({ open, onClose, onCreated }: Props) {
  const [form, setForm] = useState<Form>(() => defaults());
  const [error, setError] = useState<unknown>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionKey, setSubmissionKey] = useState(() => `sale-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const dresses = useMemo(() => getSaleableDresses(), [open]);
  const selected = dresses.find((dress) => dress.code === form.dressCode);

  useEffect(() => { if (open) { setForm(defaults()); setError(null); setIsSubmitting(false); setSubmissionKey(`sale-${Date.now()}-${Math.random().toString(36).slice(2)}`); } }, [open]);
  const close = () => { setForm(defaults()); setError(null); onClose(); };
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setError(null); setIsSubmitting(true);
    try {
      const sale = quickSaleCommand({ ...form, amount: Number(form.amount), customerPhone: form.customerPhone || undefined, idempotencyKey: submissionKey });
      onCreated(sale); close();
    } catch (reason: unknown) { setIsSubmitting(false); setError(reason); }
  };

  return <Modal open={open} onClose={close} title="بيع عنصر" className="max-w-2xl"><form onSubmit={submit} className="space-y-4">
    {error !== null && <UserFacingErrorAlert error={error} fallback="تعذر تسجيل البيع." />}
    <label className={STACKED_FORM_LABEL_CLASS_NAME}>العنصر<select required value={form.dressCode} onChange={(e)=>setForm({...form,dressCode:e.target.value,amount:dresses.find((dress)=>dress.code===e.target.value)?.salePrice.toString() ?? ''})} className={STACKED_FORM_FIELD_CLASS_NAME}><option value="">اختاري العنصر</option>{dresses.map((dress)=><option key={dress.id} value={dress.code}>{INVENTORY_ITEM_TYPE_LABELS[dress.itemType ?? 'dress']} — {dress.code} — {dress.name}</option>)}</select></label>
    {selected && <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><p>سعر البيع المسجل: <b>{formatMoneyOMR(selected.salePrice)}</b></p><p className="mt-1">النوع: <b>{INVENTORY_ITEM_TYPE_LABELS[selected.itemType ?? 'dress']}</b> • الفئة: <b>{selected.category}</b></p></div>}
    <div className="grid gap-4 md:grid-cols-2"><label className={STACKED_FORM_LABEL_CLASS_NAME}>اسم العميلة<input required value={form.customerName} onChange={(e)=>setForm({...form,customerName:e.target.value})} className={STACKED_FORM_FIELD_CLASS_NAME} /></label><label className={STACKED_FORM_LABEL_CLASS_NAME}>رقم الهاتف<input value={form.customerPhone} onChange={(e)=>setForm({...form,customerPhone:e.target.value})} className={STACKED_FORM_FIELD_CLASS_NAME} /></label></div>
    <div className="grid gap-4 md:grid-cols-2"><label className={STACKED_FORM_LABEL_CLASS_NAME}>قيمة البيع<input required type="number" min={MIN_MONEY_AMOUNT} step={MONEY_STEP} value={form.amount} onChange={(e)=>setForm({...form,amount:e.target.value})} className={STACKED_FORM_FIELD_CLASS_NAME} /></label><label className={STACKED_FORM_LABEL_CLASS_NAME}>تاريخ البيع<input required type="date" max={getTodayISO()} value={form.saleDate} onChange={(e)=>setForm({...form,saleDate:e.target.value})} className={STACKED_FORM_FIELD_CLASS_NAME} /></label></div>
    <label className={STACKED_FORM_LABEL_CLASS_NAME}>وسيلة الدفع<select value={form.paymentMethod} onChange={(e)=>setForm({...form,paymentMethod:e.target.value as SalePaymentMethod})} className={STACKED_FORM_FIELD_CLASS_NAME}>{PAYMENT_METHODS.map((method) => <option key={method} value={method}>{BASIC_PAYMENT_METHOD_LABELS[method]}</option>)}</select></label>
    <label className={STACKED_FORM_LABEL_CLASS_NAME}>ملاحظات<textarea rows={3} maxLength={MAX_NOTES_LENGTH} value={form.notes} onChange={(e)=>setForm({...form,notes:e.target.value})} className={STACKED_FORM_FIELD_CLASS_NAME} /></label>
    {dresses.length===0 && <p className="text-sm font-bold text-amber-700">لا توجد عناصر مؤهلة للبيع حالياً.</p>}
    <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end"><button type="button" onClick={close} className="min-h-11 rounded-xl border border-slate-300 px-5 text-sm font-bold text-slate-700">إلغاء</button><button type="submit" disabled={dresses.length===0} className="min-h-11 rounded-xl bg-slate-950 px-5 text-sm font-bold text-white disabled:opacity-50">تسجيل البيع</button></div>
  </form></Modal>;
}
