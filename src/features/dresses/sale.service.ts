import { generateId, generateNumber, readCollection, writeCollection } from '../../services/localDatabase';
import { getTodayISO } from '../../shared/utils/date';
import { recordAudit } from '../audit/audit.service';
import { assertBusinessDateOpen } from '../integrity/integrity.service';
import { getReservationLines } from '../reservations/contractLineHelpers';
import { getReservations } from '../reservations/reservation.service';
import { getDresses, updateDressStatus } from './dress.service';

export type SalePaymentMethod = 'cash' | 'card' | 'bank_transfer' | 'other';

export type SaleRecord = {
  id: string;
  saleNumber: string;
  saleDate: string;
  dressCode: string;
  dressName: string;
  customerName: string;
  customerPhone?: string;
  amount: number;
  /** Catalogue sale price snapshot; the gap to `amount` is the recorded discount. */
  listPrice?: number;
  paymentMethod: SalePaymentMethod;
  notes?: string;
};

type AddSaleInput = {
  dressCode: string;
  saleDate: string;
  customerName: string;
  customerPhone?: string;
  amount: number;
  paymentMethod: SalePaymentMethod;
  notes?: string;
};

const COLLECTION = 'sales';
const activeStatuses = new Set(['pending', 'confirmed', 'delivered', 'overdue']);

export function getSales(): SaleRecord[] {
  return readCollection<SaleRecord>(COLLECTION, []);
}

export function getSaleableDresses() {
  const reservedCodes = new Set(
    getReservations()
      .filter((reservation) => activeStatuses.has(reservation.status))
      .flatMap((reservation) => [
        reservation.dressCode,
        ...getReservationLines(reservation).map((line) => line.dressCodeSnapshot),
      ])
      .filter(Boolean),
  );

  return getDresses().filter(
    (dress) => dress.isForSale && dress.status === 'available' && !reservedCodes.has(dress.code),
  );
}

export function addSale(input: AddSaleInput): SaleRecord {
  const dress = getSaleableDresses().find((item) => item.code === input.dressCode);
  const customerName = input.customerName.trim();

  if (!dress) throw new Error('العنصر غير متاح للبيع حالياً.');
  if (!customerName) throw new Error('اسم العميلة مطلوب.');
  if (!input.saleDate) throw new Error('تاريخ البيع مطلوب.');
  if (input.saleDate > getTodayISO()) throw new Error('تاريخ البيع لا يمكن أن يكون في المستقبل.');
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw new Error('قيمة البيع يجب أن تكون أكبر من صفر.');
  assertBusinessDateOpen(input.saleDate);

  const sale: SaleRecord = {
    id: generateId(),
    saleNumber: generateNumber('SAL'),
    saleDate: input.saleDate,
    dressCode: dress.code,
    dressName: dress.name,
    customerName,
    customerPhone: input.customerPhone?.trim() || undefined,
    amount: input.amount,
    listPrice: dress.salePrice,
    paymentMethod: input.paymentMethod,
    notes: input.notes?.trim() || undefined,
  };

  writeCollection(COLLECTION, [sale, ...getSales()]);
  updateDressStatus(dress.code, 'sold');
  recordAudit({
    action: 'sale',
    entityType: 'sale',
    entityId: sale.id,
    summary: `تم تسجيل البيع ${sale.saleNumber} للفستان ${sale.dressCode}.`,
    nextValues: { saleDate: sale.saleDate, amount: sale.amount, paymentMethod: sale.paymentMethod },
  });
  return sale;
}
