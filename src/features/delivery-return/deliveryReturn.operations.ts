import { generateId, writeCollection } from '../../services/localDatabase';
import { recordAudit } from '../audit/audit.service';
import { updateDressStatus } from '../dresses/dress.service';
import { recordReturnSettlement } from '../payments/payment.service';
import type { PaymentMethod } from '../payments/payment.types';
import { getReservations } from '../reservations/reservation.service';
import type { Reservation } from '../reservations/reservation.types';
import { getDeliveryReturnRecords, saveDeliveryReturnRecord } from './deliveryReturn.service';
import type { DeliveryReturnRecord } from './deliveryReturn.types';

const RESERVATION_COLLECTION = 'reservations';

type CompleteDeliveryInput = { reservationNumber: string; deliveryDateTime: string; deliveryCondition?: string; notes?: string };
type CompleteReturnInput = { reservationNumber: string; returnDateTime: string; returnCondition?: string; lateFee: number; damageFee: number; refundMethod: PaymentMethod; nextDressStatus: 'available' | 'laundry' | 'maintenance' | 'damaged'; notes?: string };

function validateDateTime(value: string, label: string): number {
  const timestamp = new Date(value).getTime();
  if (!value || Number.isNaN(timestamp)) throw new Error(`${label} مطلوبان.`);
  if (timestamp > Date.now()) throw new Error(`${label} لا يمكن أن يكونا في المستقبل.`);
  return timestamp;
}

function updateReservationStatus(reservationNumber: string, status: Reservation['status']): Reservation {
  const reservations = getReservations();
  const reservation = reservations.find((item) => item.reservationNumber === reservationNumber);
  if (!reservation) throw new Error('الحجز المحدد غير موجود.');
  const updated = { ...reservation, status };
  writeCollection(RESERVATION_COLLECTION, reservations.map((item) => item.id === reservation.id ? updated : item));
  return updated;
}

function getBaseRecord(reservation: Reservation): DeliveryReturnRecord {
  return getDeliveryReturnRecords().find((item) => item.reservationNumber === reservation.reservationNumber) ?? {
    id: generateId(), reservationNumber: reservation.reservationNumber, customerId: reservation.customerId, inventoryItemId: reservation.inventoryItemId, customerName: reservation.customerName,
    customerPhone: reservation.customerPhone, dressCode: reservation.dressCode, dressName: reservation.dressName,
    status: 'pending_delivery', depositAmount: reservation.depositAmount, lateFee: 0, damageFee: 0,
    depositRefundAmount: reservation.depositAmount,
  };
}

export function completeDelivery(input: CompleteDeliveryInput): DeliveryReturnRecord {
  const reservation = getReservations().find((item) => item.reservationNumber === input.reservationNumber);
  if (!reservation) throw new Error('الحجز المحدد غير موجود.');
  if (!['pending', 'confirmed'].includes(reservation.status)) throw new Error('الحجز غير مؤهل للتسليم حالياً.');
  validateDateTime(input.deliveryDateTime, 'تاريخ ووقت التسليم');
  const base = getBaseRecord(reservation);
  const record = saveDeliveryReturnRecord({ ...base, status: 'delivered', deliveryDateTime: input.deliveryDateTime, deliveryCondition: input.deliveryCondition?.trim() || undefined, notes: input.notes?.trim() || base.notes });
  updateReservationStatus(reservation.reservationNumber, 'delivered');
  updateDressStatus(reservation.dressCode, 'rented');
  recordAudit({ action: 'deliver', entityType: 'delivery-return', entityId: record.id, summary: `تم تسليم العنصر ${reservation.dressCode} للحجز ${reservation.reservationNumber}.`, nextValues: { deliveryDateTime: record.deliveryDateTime, status: record.status } });
  return record;
}

export function completeReturn(input: CompleteReturnInput): DeliveryReturnRecord {
  const reservation = getReservations().find((item) => item.reservationNumber === input.reservationNumber);
  if (!reservation) throw new Error('الحجز المحدد غير موجود.');
  if (!['delivered', 'overdue'].includes(reservation.status)) throw new Error('الحجز غير مؤهل للاسترجاع حالياً.');
  const returnTimestamp = validateDateTime(input.returnDateTime, 'تاريخ ووقت الاسترجاع');
  if (![input.lateFee, input.damageFee].every((amount) => Number.isFinite(amount) && amount >= 0)) throw new Error('رسوم التأخير أو الضرر غير صالحة.');
  const base = getBaseRecord(reservation);
  if (base.deliveryDateTime && returnTimestamp < new Date(base.deliveryDateTime).getTime()) throw new Error('وقت الاسترجاع لا يمكن أن يسبق وقت التسليم.');

  const settlement = recordReturnSettlement({ reservationNumber: reservation.reservationNumber, paymentDate: input.returnDateTime.slice(0, 10), refundMethod: input.refundMethod, lateFee: input.lateFee, damageFee: input.damageFee });
  const status = input.damageFee > 0 || input.nextDressStatus === 'damaged' ? 'damaged' : input.lateFee > 0 ? 'late' : 'returned';
  const record = saveDeliveryReturnRecord({ ...base, status, returnDateTime: input.returnDateTime, returnCondition: input.returnCondition?.trim() || undefined, lateFee: input.lateFee, damageFee: input.damageFee, depositRefundAmount: settlement.refundAmount, notes: input.notes?.trim() || base.notes });
  updateReservationStatus(reservation.reservationNumber, 'returned');
  updateDressStatus(reservation.dressCode, input.nextDressStatus);
  recordAudit({ action: 'return', entityType: 'delivery-return', entityId: record.id, summary: `تم استرجاع العنصر ${reservation.dressCode} من الحجز ${reservation.reservationNumber}.`, nextValues: { returnDateTime: record.returnDateTime, status: record.status, lateFee: record.lateFee, damageFee: record.damageFee, depositRefundAmount: record.depositRefundAmount } });
  return record;
}
