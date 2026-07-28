import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../../components/shared/Modal';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';
import { MAX_NOTES_LENGTH, MIN_MONEY_AMOUNT, MONEY_STEP } from '../../shared/domain/businessRules';
import { STACKED_FORM_FIELD_CLASS_NAME, STACKED_FORM_LABEL_CLASS_NAME } from '../../shared/domain/formConstants';
import { getTodayISO } from '../../shared/utils/date';
import { getDresses } from '../dresses/dress.service';
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS, EXPENSE_PAYMENT_METHOD_LABELS, EXPENSE_PAYMENT_METHODS } from './expense.constants';
import { postExpenseCommand } from '../workflows';
import type { ExpenseCategory, ExpensePaymentMethod, ExpenseRecord } from './expense.types';

type Props = { open: boolean; onClose: () => void; onCreated: (expense: ExpenseRecord) => void };
type Form = { expenseDate: string; title: string; category: ExpenseCategory; amount: string; paymentMethod: ExpensePaymentMethod; relatedDressCode: string; notes: string };
function defaults(): Form { return { expenseDate: getTodayISO(), title: '', category: 'laundry', amount: '', paymentMethod: 'cash', relatedDressCode: '', notes: '' }; }

export function AddExpenseModal({ open, onClose, onCreated }: Props) {
  const [form, setForm] = useState<Form>(() => defaults());
  const [error, setError] = useState<unknown>(null);
  const dresses = useMemo(() => getDresses(), [open]);
  useEffect(() => { if (open) { setForm(defaults()); setError(null); } }, [open]);
  const close = () => { setForm(defaults()); setError(null); onClose(); };
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    try {
      const expense = postExpenseCommand({ ...form, amount: Number(form.amount), relatedDressCode: form.relatedDressCode || undefined });
      onCreated(expense);
      close();
    } catch (reason: unknown) {
      setError(reason);
    }
  };
  return <Modal open={open} onClose={close} title="تسجيل مصروف جديد" className="max-w-2xl"><form onSubmit={submit} className="space-y-4">
    {error !== null && <UserFacingErrorAlert error={error} fallback="تعذر تسجيل المصروف." />}
    <label className={STACKED_FORM_LABEL_CLASS_NAME}>العنوان<input required value={form.title} onChange={(e)=>setForm({...form,title:e.target.value})} className={STACKED_FORM_FIELD_CLASS_NAME} /></label>
    <div className="grid gap-4 md:grid-cols-2"><label className={STACKED_FORM_LABEL_CLASS_NAME}>الفئة<select value={form.category} onChange={(e)=>setForm({...form,category:e.target.value as ExpenseCategory})} className={STACKED_FORM_FIELD_CLASS_NAME}>{EXPENSE_CATEGORIES.map((category) => <option key={category} value={category}>{EXPENSE_CATEGORY_LABELS[category]}</option>)}</select></label><label className={STACKED_FORM_LABEL_CLASS_NAME}>القيمة (ر.ع)<input required type="number" min={MIN_MONEY_AMOUNT} step={MONEY_STEP} value={form.amount} onChange={(e)=>setForm({...form,amount:e.target.value})} className={STACKED_FORM_FIELD_CLASS_NAME} /></label></div>
    <div className="grid gap-4 md:grid-cols-2"><label className={STACKED_FORM_LABEL_CLASS_NAME}>تاريخ المصروف<input required type="date" max={getTodayISO()} value={form.expenseDate} onChange={(e)=>setForm({...form,expenseDate:e.target.value})} className={STACKED_FORM_FIELD_CLASS_NAME} /></label><label className={STACKED_FORM_LABEL_CLASS_NAME}>وسيلة الدفع<select value={form.paymentMethod} onChange={(e)=>setForm({...form,paymentMethod:e.target.value as ExpensePaymentMethod})} className={STACKED_FORM_FIELD_CLASS_NAME}>{EXPENSE_PAYMENT_METHODS.map((method) => <option key={method} value={method}>{EXPENSE_PAYMENT_METHOD_LABELS[method]}</option>)}</select></label></div>
    <label className={STACKED_FORM_LABEL_CLASS_NAME}>ربط بفستان اختياري<select value={form.relatedDressCode} onChange={(e)=>setForm({...form,relatedDressCode:e.target.value})} className={STACKED_FORM_FIELD_CLASS_NAME}><option value="">بدون ربط</option>{dresses.map((dress)=><option key={dress.id} value={dress.code}>{dress.code} — {dress.name}</option>)}</select></label>
    <label className={STACKED_FORM_LABEL_CLASS_NAME}>ملاحظات<textarea rows={3} maxLength={MAX_NOTES_LENGTH} value={form.notes} onChange={(e)=>setForm({...form,notes:e.target.value})} className={STACKED_FORM_FIELD_CLASS_NAME} /></label>
    <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end"><button type="button" onClick={close} className="min-h-11 rounded-xl border border-slate-300 px-5 text-sm font-bold text-slate-700">إلغاء</button><button type="submit" className="min-h-11 rounded-xl bg-slate-950 px-5 text-sm font-bold text-white">تسجيل المصروف</button></div>
  </form></Modal>;
}
