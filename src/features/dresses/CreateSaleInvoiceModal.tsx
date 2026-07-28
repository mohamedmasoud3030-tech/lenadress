import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from '../../components/shared/Modal';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';
import { MIN_MONEY_AMOUNT, MONEY_STEP } from '../../shared/domain/businessRules';
import { STACKED_FORM_FIELD_CLASS_NAME } from '../../shared/domain/formConstants';
import { getTodayISO } from '../../shared/utils/date';
import { formatMoneyOMR } from '../../shared/utils/format';
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
  const total = lines.reduce((sum, line) => sum + (Number(line.amount) || 0), 0);
  const close = () => { setCustomerName(''); setCustomerPhone(''); setSaleDate(getTodayISO()); setPaymentMethod('cash'); setNotes(''); setLines([{ dressCode: '', amount: '' }]); setError(null); onClose(); };
  const updateLine = (index: number, patch: Partial<Line>) => setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, ...patch } : line));
  const selectDress = (index: number, dressCode: string) => { const dress = dresses.find((item) => item.code === dressCode); updateLine(index, { dressCode, amount: dress ? String(dress.salePrice) : '' }); };
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      const invoice = createSaleInvoiceCommand({ saleDate, customerName, customerPhone, paymentMethod, notes, lines: lines.map((line) => ({ dressCode: line.dressCode, amount: Number(line.amount) })) });
      onCreated(invoice);
      close();
    } catch (reason: unknown) { setError(reason); }
  };

  return <Modal open={open} onClose={close} title="فاتورة مبيعات جديدة" className="max-w-3xl"><form onSubmit={submit} className="space-y-4">
    {error !== null && <UserFacingErrorAlert error={error} fallback="تعذر تسجيل الفاتورة." />}
    <div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-bold text-slate-700">اسم العميلة<input required value={customerName} onChange={(event) => setCustomerName(event.target.value)} className={STACKED_FORM_FIELD_CLASS_NAME} /></label><label className="text-sm font-bold text-slate-700">الهاتف<input value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} className={STACKED_FORM_FIELD_CLASS_NAME} /></label></div>
    <div className="grid gap-4 md:grid-cols-2"><label className="text-sm font-bold text-slate-700">تاريخ البيع<input required type="date" max={getTodayISO()} value={saleDate} onChange={(event) => setSaleDate(event.target.value)} className={STACKED_FORM_FIELD_CLASS_NAME} /></label><label className="text-sm font-bold text-slate-700">وسيلة الدفع<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as SalePaymentMethod)} className={STACKED_FORM_FIELD_CLASS_NAME}>{PAYMENT_METHODS.map((method) => <option key={method} value={method}>{BASIC_PAYMENT_METHOD_LABELS[method]}</option>)}</select></label></div>
    <div className="space-y-3"><div className="flex items-center justify-between"><h3 className="font-bold">بنود الفاتورة</h3><button type="button" onClick={() => setLines((current) => [...current, { dressCode: '', amount: '' }])} className="inline-flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold"><Plus className="h-4 w-4" />إضافة بند</button></div>{lines.map((line, index) => <div key={index} className="grid gap-3 rounded-xl border border-slate-200 p-3 md:grid-cols-[1fr_160px_44px]"><label className="text-sm font-bold text-slate-700">العنصر<select required value={line.dressCode} onChange={(event) => selectDress(index, event.target.value)} className={STACKED_FORM_FIELD_CLASS_NAME}><option value="">اختاري العنصر</option>{dresses.map((dress) => <option key={dress.id} value={dress.code}>{dress.code} — {dress.name}</option>)}</select></label><label className="text-sm font-bold text-slate-700">القيمة<input required type="number" min={MIN_MONEY_AMOUNT} step={MONEY_STEP} value={line.amount} onChange={(event) => updateLine(index, { amount: event.target.value })} className={STACKED_FORM_FIELD_CLASS_NAME} /></label><button type="button" aria-label="حذف البند" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))} className="mt-6 flex h-11 items-center justify-center rounded-xl border border-rose-200 text-rose-700 disabled:opacity-40"><Trash2 className="h-4 w-4" /></button></div>)}</div>
    <label className="block text-sm font-bold text-slate-700">ملاحظات<textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} className={STACKED_FORM_FIELD_CLASS_NAME} /></label>
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4"><p className="text-lg font-bold">الإجمالي: {formatMoneyOMR(total)}</p><div className="flex gap-3"><button type="button" onClick={close} className="min-h-11 rounded-xl border border-slate-300 px-4 text-sm font-bold">إلغاء</button><button type="submit" className="min-h-11 rounded-xl bg-slate-950 px-5 text-sm font-bold text-white">حفظ الفاتورة</button></div></div>
  </form></Modal>;
}
