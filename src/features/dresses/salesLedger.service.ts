import { generateId, generateNumber, readCollection, writeCollection } from '../../services/localDatabase';
import { getTodayISO } from '../../shared/utils/date';
import { recordAudit } from '../audit/audit.service';
import { assertBusinessDateOpen } from '../integrity/integrity.service';
import { updateDressStatus } from './dress.service';
import { getSaleableDresses, getSales, type SalePaymentMethod, type SaleRecord } from './sale.service';

export type SaleInvoiceLine = { id: string; dressCode: string; dressName: string; amount: number };
export type SaleInvoice = { id: string; invoiceNumber: string; saleDate: string; customerName: string; customerPhone?: string; paymentMethod: SalePaymentMethod; lines: SaleInvoiceLine[]; totalAmount: number; notes?: string };
export type SaleReturnRecord = { id: string; returnNumber: string; invoiceNumber: string; returnDate: string; dressCode: string; dressName: string; amount: number; paymentMethod: SalePaymentMethod; notes?: string };
type InvoiceInput = { saleDate: string; customerName: string; customerPhone?: string; paymentMethod: SalePaymentMethod; lines: Array<{ dressCode: string; amount: number }>; notes?: string };
type ReturnInput = { invoiceNumber: string; dressCode: string; returnDate: string; notes?: string };

const INVOICE_COLLECTION = 'sales-invoices';
// Canonical registered collection name. Legacy builds wrote 'sales-returns',
// which the registry never knew about, so those records were invisible to reset
// and registry-driven flows. `migrateLegacySaleReturns` folds them in exactly once.
const RETURN_COLLECTION = 'sale-returns';
const LEGACY_RETURN_COLLECTION = 'sales-returns';

export function getSaleInvoices(): SaleInvoice[] { return readCollection<SaleInvoice>(INVOICE_COLLECTION, []); }
export function migrateLegacySaleReturns(): void {
  const legacy = readCollection<SaleReturnRecord>(LEGACY_RETURN_COLLECTION, []);
  if (legacy.length === 0) return;

  const canonical = readCollection<SaleReturnRecord>(RETURN_COLLECTION, []);
  const knownIds = new Set(canonical.map((item) => item.id));
  const merged = [...canonical, ...legacy.filter((item) => !knownIds.has(item.id))];
  writeCollection(RETURN_COLLECTION, merged);
  writeCollection(LEGACY_RETURN_COLLECTION, []);
}

export function getSaleReturns(): SaleReturnRecord[] {
  migrateLegacySaleReturns();
  return readCollection<SaleReturnRecord>(RETURN_COLLECTION, []);
}

export function createSaleInvoice(input: InvoiceInput): SaleInvoice {
  const customerName = input.customerName.trim();
  if (!customerName) throw new Error('اسم العميلة مطلوب.');
  if (!input.saleDate || input.saleDate > getTodayISO()) throw new Error('تاريخ البيع غير صالح.');
  if (input.lines.length === 0) throw new Error('أضيفي فستاناً واحداً على الأقل للفاتورة.');
  assertBusinessDateOpen(input.saleDate);
  const saleable = new Map(getSaleableDresses().map((dress) => [dress.code, dress]));
  const codes = new Set<string>();
  const lines = input.lines.map((line) => {
    const dress = saleable.get(line.dressCode);
    if (!dress || codes.has(line.dressCode)) throw new Error('توجد بنود غير متاحة للبيع أو مكررة.');
    if (!Number.isFinite(line.amount) || line.amount <= 0) throw new Error('قيمة أحد بنود الفاتورة غير صالحة.');
    codes.add(line.dressCode);
    return { id: generateId(), dressCode: dress.code, dressName: dress.name, amount: line.amount };
  });
  const invoice: SaleInvoice = { id: generateId(), invoiceNumber: generateNumber('INV'), saleDate: input.saleDate, customerName, customerPhone: input.customerPhone?.trim() || undefined, paymentMethod: input.paymentMethod, lines, totalAmount: lines.reduce((sum, line) => sum + line.amount, 0), notes: input.notes?.trim() || undefined };
  const sales: SaleRecord[] = lines.map((line) => ({ id: generateId(), saleNumber: generateNumber('SAL'), invoiceNumber: invoice.invoiceNumber, saleDate: invoice.saleDate, dressCode: line.dressCode, dressName: line.dressName, customerName: invoice.customerName, customerPhone: invoice.customerPhone, amount: line.amount, paymentMethod: invoice.paymentMethod, notes: invoice.notes }));
  writeCollection(INVOICE_COLLECTION, [invoice, ...getSaleInvoices()]);
  writeCollection('sales', [...sales, ...getSales()]);
  lines.forEach((line) => updateDressStatus(line.dressCode, 'sold'));
  recordAudit({ action: 'sale', entityType: 'sale', entityId: invoice.id, summary: `تم تسجيل الفاتورة ${invoice.invoiceNumber} بعدد ${lines.length} بنود.`, nextValues: { totalAmount: invoice.totalAmount, paymentMethod: invoice.paymentMethod } });
  return invoice;
}

export function recordSaleReturn(input: ReturnInput): SaleReturnRecord {
  const invoice = getSaleInvoices().find((item) => item.invoiceNumber === input.invoiceNumber);
  const line = invoice?.lines.find((item) => item.dressCode === input.dressCode);
  if (!invoice || !line) throw new Error('بند الفاتورة المحدد غير موجود.');
  if (!input.returnDate || input.returnDate > getTodayISO() || input.returnDate < invoice.saleDate) throw new Error('تاريخ المرتجع غير صالح.');
  if (getSaleReturns().some((item) => item.invoiceNumber === invoice.invoiceNumber && item.dressCode === line.dressCode)) throw new Error('تم تسجيل مرتجع لهذا البند بالفعل.');
  assertBusinessDateOpen(input.returnDate);
  const saleReturn: SaleReturnRecord = { id: generateId(), returnNumber: generateNumber('RET'), invoiceNumber: invoice.invoiceNumber, returnDate: input.returnDate, dressCode: line.dressCode, dressName: line.dressName, amount: line.amount, paymentMethod: invoice.paymentMethod, notes: input.notes?.trim() || undefined };
  writeCollection(RETURN_COLLECTION, [saleReturn, ...getSaleReturns()]);
  // A returned sold item goes back through inspection, never straight to available.
  updateDressStatus(line.dressCode, 'inspection');
  recordAudit({ action: 'refund', entityType: 'sale', entityId: saleReturn.id, summary: `تم تسجيل المرتجع ${saleReturn.returnNumber} للفاتورة ${invoice.invoiceNumber}.`, nextValues: { amount: saleReturn.amount, dressCode: saleReturn.dressCode } });
  return saleReturn;
}
