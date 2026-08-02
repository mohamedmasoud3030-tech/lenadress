import { generateId, writeCollection } from '../../services/localDatabase';
import {
  getOutstandingAccessories,
  recordAccessoryDelivery,
  recordAccessoryReturn,
  type AccessoryReturnEntry,
} from '../accessories/reservationAccessory.service';
import { recordAudit } from '../audit/audit.service';
import { markDressRented, updateDressStatus } from '../dresses/dress.service';
import { recordReturnSettlement } from '../payments/payment.service';
import type { PaymentMethod } from '../payments/payment.types';
import { getReservationDepositTotal, getReservationLines } from '../reservations/contractLineHelpers';
import { getReservations } from '../reservations/reservation.service';
import type { ContractLine, Reservation } from '../reservations/reservation.types';
import { getDeliveryReturnRecords, saveDeliveryReturnRecord } from './deliveryReturn.service';
import type { ConditionPhoto, DeliveryReturnRecord } from './deliveryReturn.types';

const RESERVATION_COLLECTION = 'reservations';

type CompleteDeliveryInput = {
  reservationNumber: string;
  deliveryDateTime: string;
  deliveryCondition?: string;
  /** Condition evidence captured at the counter. */
  deliveryPhotos?: ConditionPhoto[];
  /** Accessory ids physically handed over with the dress. */
  deliveredAccessoryIds?: string[];
  /** Required when the operator deliberately hands over an unpaid contract. */
  paymentOverrideReason?: string;
  notes?: string;
};
type CompleteReturnInput = {
  reservationNumber: string;
  returnDateTime: string;
  returnCondition?: string;
  /** Condition evidence captured at the counter. */
  returnPhotos?: ConditionPhoto[];
  lateFee: number;
  damageFee: number;
  refundMethod: PaymentMethod;
  nextDressStatus: 'inspection' | 'laundry' | 'maintenance' | 'damaged';
  /** Per-accessory condition; omitting an accessory keeps it out (partial return). */
  accessoryReturns?: AccessoryReturnEntry[];
  notes?: string;
};

/**
 * Caps and validates the evidence attached to one handover.
 *
 * A limit exists because these live inside the record and therefore inside
 * every backup: unbounded photos would make the backup file itself the next
 * storage problem. Four is enough for front, back, and two close-ups of a
 * disputed area.
 */
const MAX_CONDITION_PHOTOS = 4;

function normalizeConditionPhotos(photos?: ConditionPhoto[]): ConditionPhoto[] | undefined {
  if (!photos || photos.length === 0) return undefined;
  const valid = photos.filter((photo) => typeof photo.dataUrl === 'string' && photo.dataUrl.startsWith('data:image/'));
  if (valid.length === 0) return undefined;
  if (valid.length > MAX_CONDITION_PHOTOS) {
    throw new Error(`لا يمكن إرفاق أكثر من ${MAX_CONDITION_PHOTOS} صور لحالة القطعة.`);
  }
  return valid;
}

function validateDateTime(value: string, label: string): number {
  const timestamp = new Date(value).getTime();
  if (!value || Number.isNaN(timestamp)) throw new Error(`${label} مطلوبان.`);
  if (timestamp > Date.now()) throw new Error(`${label} لا يمكن أن يكونا في المستقبل.`);
  return timestamp;
}

function updateReservationFulfillment(
  reservationNumber: string,
  operation: 'delivery' | 'return',
): Reservation {
  const reservations = getReservations();
  const reservation = reservations.find((item) => item.reservationNumber === reservationNumber);
  if (!reservation) throw new Error('الحجز المحدد غير موجود.');
  const status: Reservation['status'] = operation === 'delivery' ? 'delivered' : 'returned';
  const deliveryStatus: ContractLine['deliveryStatus'] = operation === 'delivery' ? 'delivered' : 'returned';
  const lines = reservation.lines?.map((line) => ({ ...line, deliveryStatus }));
  // Fulfilment changes status only. Recomputing totals here would overwrite
  // the canonical return settlement (retained and refunded deposit amounts).
  const updated = lines
    ? { ...reservation, lines, status }
    : { ...reservation, status };
  writeCollection(RESERVATION_COLLECTION, reservations.map((item) => item.id === reservation.id ? updated : item));
  return updated;
}

function roundOMR(value: number): number {
  return Math.round((value + Number.EPSILON) * 1_000) / 1_000;
}

function assertDeliveryPaymentGate(reservation: Reservation, overrideReason?: string): string | undefined {
  const outstandingAmount = roundOMR(reservation.remainingAmount);
  if (outstandingAmount <= 0) return undefined;

  const reason = overrideReason?.trim();
  if (!reason) {
    throw new Error(`لا يمكن تسليم الحجز قبل سداد الرصيد المتبقي (${outstandingAmount.toFixed(3)} ر.ع)، أو تسجيل سبب واضح للتجاوز.`);
  }
  return reason;
}

function assertWholeContractCanTransition(reservation: Reservation, operation: 'delivery' | 'return'): void {
  const allowed = operation === 'delivery'
    ? new Set(['pending_delivery'])
    : new Set(['delivered', 'late']);
  const invalid = getReservationLines(reservation).filter((line) => !allowed.has(line.deliveryStatus));
  if (invalid.length === 0) return;

  if (operation === 'delivery') {
    throw new Error('لا يمكن تسليم العقد كاملاً لأن بعض بنوده سُلّمت أو أُرجعت بالفعل.');
  }
  throw new Error('لا يمكن استرجاع العقد كاملاً قبل تسليم كل بنوده. استخدمي إجراء البند للحالات الجزئية.');
}

function updateEveryReservationItemStatus(
  reservation: Reservation,
  status: 'rented' | 'inspection' | 'laundry' | 'maintenance' | 'damaged',
): string[] {
  return getReservationLines(reservation).map((line) => {
    const updated = status === 'rented'
      ? markDressRented(line.dressCodeSnapshot)
      : updateDressStatus(line.dressCodeSnapshot, status);
    if (!updated) {
      throw new Error(`تعذر العثور على العنصر ${line.dressCodeSnapshot}. لم تُحفظ العملية.`);
    }
    return line.dressCodeSnapshot;
  });
}

function getBaseRecord(reservation: Reservation): DeliveryReturnRecord {
  return getDeliveryReturnRecords().find((item) => item.reservationNumber === reservation.reservationNumber) ?? {
    id: generateId(), reservationNumber: reservation.reservationNumber, customerId: reservation.customerId, inventoryItemId: reservation.inventoryItemId, customerName: reservation.customerName,
    customerPhone: reservation.customerPhone, dressCode: reservation.dressCode, dressName: reservation.dressName,
    status: 'pending_delivery', depositAmount: getReservationDepositTotal(reservation), lateFee: 0, damageFee: 0, // legacy compat
    depositRefundAmount: getReservationDepositTotal(reservation),
  };
}

export function completeDelivery(input: CompleteDeliveryInput): DeliveryReturnRecord {
  const reservation = getReservations().find((item) => item.reservationNumber === input.reservationNumber);
  if (!reservation) throw new Error('الحجز المحدد غير موجود.');
  if (!['pending', 'confirmed'].includes(reservation.status)) throw new Error('الحجز غير مؤهل للتسليم حالياً.');
  assertWholeContractCanTransition(reservation, 'delivery');
  const paymentOverrideReason = assertDeliveryPaymentGate(reservation, input.paymentOverrideReason);
  validateDateTime(input.deliveryDateTime, 'تاريخ ووقت التسليم');
  const base = getBaseRecord(reservation);
  const record = saveDeliveryReturnRecord({ ...base, status: 'delivered', deliveryDateTime: input.deliveryDateTime, deliveryCondition: input.deliveryCondition?.trim() || undefined, deliveryPhotos: normalizeConditionPhotos(input.deliveryPhotos), notes: input.notes?.trim() || base.notes });
  updateReservationFulfillment(reservation.reservationNumber, 'delivery');
  const deliveredItemCodes = updateEveryReservationItemStatus(reservation, 'rented');
  // Accessories are part of the same handover, inside the same command boundary.
  const deliveredAccessories = recordAccessoryDelivery({
    reservationNumber: reservation.reservationNumber,
    deliveredAccessoryIds: input.deliveredAccessoryIds ?? [],
    deliveredAt: input.deliveryDateTime,
  });
  recordAudit({ action: 'deliver', entityType: 'delivery-return', entityId: record.id, summary: `تم تسليم ${deliveredItemCodes.length} قطعة للحجز ${reservation.reservationNumber}.`, nextValues: { deliveryDateTime: record.deliveryDateTime, status: record.status, deliveredItemCodes, deliveredAccessories: deliveredAccessories.length, deliveryPhotos: record.deliveryPhotos?.length ?? 0, paymentOverrideReason } });
  return record;
}

export function completeReturn(input: CompleteReturnInput): DeliveryReturnRecord {
  const reservation = getReservations().find((item) => item.reservationNumber === input.reservationNumber);
  if (!reservation) throw new Error('الحجز المحدد غير موجود.');
  if (!['delivered', 'overdue'].includes(reservation.status)) throw new Error('الحجز غير مؤهل للاسترجاع حالياً.');
  assertWholeContractCanTransition(reservation, 'return');
  const returnTimestamp = validateDateTime(input.returnDateTime, 'تاريخ ووقت الاسترجاع');
  if (![input.lateFee, input.damageFee].every((amount) => Number.isFinite(amount) && amount >= 0)) throw new Error('رسوم التأخير أو الضرر غير صالحة.');
  const base = getBaseRecord(reservation);
  if (base.deliveryDateTime && returnTimestamp < new Date(base.deliveryDateTime).getTime()) throw new Error('وقت الاسترجاع لا يمكن أن يسبق وقت التسليم.');

  // Accessory conditions and charges are recorded before the money settlement so a
  // rejected accessory entry cannot leave a posted settlement behind.
  const accessoryReturns = input.accessoryReturns ?? [];
  if (accessoryReturns.length > 0) {
    recordAccessoryReturn({ reservationNumber: reservation.reservationNumber, entries: accessoryReturns, returnedAt: input.returnDateTime });
  }
  const stillOut = getOutstandingAccessories(reservation.reservationNumber);

  const settlement = recordReturnSettlement({ reservationNumber: reservation.reservationNumber, paymentDate: input.returnDateTime.slice(0, 10), refundMethod: input.refundMethod, lateFee: input.lateFee, damageFee: input.damageFee });
  const status = input.damageFee > 0 || input.nextDressStatus === 'damaged' ? 'damaged' : input.lateFee > 0 ? 'late' : 'returned';
  const record = saveDeliveryReturnRecord({ ...base, status, returnDateTime: input.returnDateTime, returnCondition: input.returnCondition?.trim() || undefined, returnPhotos: normalizeConditionPhotos(input.returnPhotos), lateFee: input.lateFee, damageFee: input.damageFee, depositRefundAmount: settlement.refundAmount, notes: input.notes?.trim() || base.notes });
  updateReservationFulfillment(reservation.reservationNumber, 'return');
  const returnedItemCodes = updateEveryReservationItemStatus(reservation, input.nextDressStatus);
  recordAudit({ action: 'return', entityType: 'delivery-return', entityId: record.id, summary: `تم استرجاع ${returnedItemCodes.length} قطعة من الحجز ${reservation.reservationNumber}.`, nextValues: { returnDateTime: record.returnDateTime, status: record.status, returnedItemCodes, lateFee: record.lateFee, damageFee: record.damageFee, depositRefundAmount: record.depositRefundAmount, accessoriesStillOut: stillOut.length, returnPhotos: record.returnPhotos?.length ?? 0 } });
  return record;
}
