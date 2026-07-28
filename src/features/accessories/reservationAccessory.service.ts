import { generateId, readCollection, writeCollection } from '../../services/localDatabase';
import { recordAudit } from '../audit/audit.service';
import { addExpense } from '../expenses/expense.service';
import { getReservations } from '../reservations/reservation.service';
import { assertNoConflicts, findAccessoryConflicts } from '../reservations/reservationConflicts';
import { getAccessories, getAccessoryById, isAccessoryBookable, updateAccessoryStatus } from './accessory.service';
import type {
  Accessory,
  AccessoryReturnCondition,
  ReservationAccessory,
} from './accessory.types';

/**
 * Reservation ⇄ accessory links.
 *
 * The link record is the operational truth for one accessory on one
 * reservation: whether it was actually handed over, what condition it came back
 * in, and what it was charged for. Money never lives here — a damage or loss
 * charge is posted as an item-linked expense through the existing finance path,
 * so no parallel ledger appears.
 */

const COLLECTION = 'reservation-accessories';

export const ACCESSORY_RETURN_CONDITION_LABELS: Record<AccessoryReturnCondition, string> = {
  intact: 'سليم',
  damaged: 'تالف',
  lost: 'مفقود',
  needs_service: 'يحتاج تنظيفاً أو صيانة',
};

/** Accessory state produced by each return condition. */
const RETURN_CONDITION_STATUS = {
  intact: 'service',
  damaged: 'damaged',
  lost: 'lost',
  needs_service: 'service',
} as const;

export function getReservationAccessories(): ReservationAccessory[] {
  return readCollection<ReservationAccessory>(COLLECTION, []);
}

function saveLinks(links: ReservationAccessory[]): void {
  writeCollection(COLLECTION, links);
}

export function getAccessoriesForReservation(reservationNumber: string): ReservationAccessory[] {
  return getReservationAccessories().filter((link) => link.reservationNumber === reservationNumber);
}

function requireReservation(reservationNumber: string) {
  const reservation = getReservations().find((item) => item.reservationNumber === reservationNumber);
  if (!reservation) throw new Error('الحجز المحدد غير موجود.');
  return reservation;
}

export type AttachAccessoryInput = {
  reservationNumber: string;
  accessoryId: string;
  notes?: string;
};

export function attachAccessoryToReservation(input: AttachAccessoryInput): ReservationAccessory {
  const reservation = requireReservation(input.reservationNumber);
  if (reservation.status === 'cancelled' || reservation.status === 'returned') {
    throw new Error('لا يمكن إضافة ملحق إلى حجز مغلق.');
  }

  const accessory = getAccessoryById(input.accessoryId);
  if (!accessory) throw new Error('الملحق المحدد غير موجود.');
  if (!isAccessoryBookable(accessory)) throw new Error(`الملحق ${accessory.code} غير متاح للحجز في حالته الحالية.`);

  const links = getReservationAccessories();
  if (links.some((link) => link.reservationNumber === reservation.reservationNumber && link.accessoryId === accessory.id)) {
    throw new Error('الملحق مضاف إلى هذا الحجز بالفعل.');
  }

  assertNoConflicts(
    findAccessoryConflicts(
      {
        accessoryId: accessory.id,
        pickupDate: reservation.pickupDate,
        returnDate: reservation.returnDate,
        excludeReservationNumber: reservation.reservationNumber,
      },
      links,
      getReservations(),
    ),
  );

  const link: ReservationAccessory = {
    id: generateId(),
    reservationNumber: reservation.reservationNumber,
    accessoryId: accessory.id,
    accessoryCodeSnapshot: accessory.code,
    accessoryNameSnapshot: accessory.name,
    rentalPrice: accessory.rentalPrice ?? 0,
    depositAmount: accessory.depositAmount ?? 0,
    notes: input.notes?.trim() || undefined,
  };

  saveLinks([link, ...links]);
  if (accessory.status === 'available') updateAccessoryStatus(accessory.id, 'reserved');
  recordAudit({
    action: 'create',
    entityType: 'accessory',
    entityId: link.id,
    summary: `تمت إضافة الملحق ${accessory.code} إلى الحجز ${reservation.reservationNumber}.`,
    nextValues: { reservationNumber: reservation.reservationNumber, accessoryCode: accessory.code },
  });
  return link;
}

export function detachAccessoryFromReservation(reservationNumber: string, accessoryId: string): void {
  const links = getReservationAccessories();
  const link = links.find((item) => item.reservationNumber === reservationNumber && item.accessoryId === accessoryId);
  if (!link) throw new Error('الملحق غير مرتبط بهذا الحجز.');
  if (link.deliveredAt && !link.returnedAt) throw new Error('لا يمكن إزالة ملحق مسلَّم قبل تسجيل استرجاعه.');

  saveLinks(links.filter((item) => item.id !== link.id));
  const accessory = getAccessoryById(accessoryId);
  if (accessory && accessory.status === 'reserved') updateAccessoryStatus(accessory.id, 'available');
  recordAudit({
    action: 'update',
    entityType: 'accessory',
    entityId: link.id,
    summary: `تمت إزالة الملحق ${link.accessoryCodeSnapshot} من الحجز ${reservationNumber}.`,
    previousValues: { reservationNumber, accessoryCode: link.accessoryCodeSnapshot },
  });
}

/**
 * Releases every accessory of a reservation that is no longer active.
 * Delivered accessories are left alone: they are physically still out.
 */
export function releaseAccessoriesForReservation(reservationNumber: string): void {
  getAccessoriesForReservation(reservationNumber)
    .filter((link) => !link.deliveredAt)
    .forEach((link) => {
      const accessory = getAccessoryById(link.accessoryId);
      if (accessory && accessory.status === 'reserved') updateAccessoryStatus(accessory.id, 'available');
    });
}

export type DeliverAccessoriesInput = {
  reservationNumber: string;
  /** Accessory ids physically handed over. Anything omitted stays undelivered. */
  deliveredAccessoryIds: string[];
  deliveredAt: string;
};

/**
 * Records which accessories actually left the showroom.
 * Re-running with the same set is a no-op, so a retried delivery command never
 * double-writes a handover.
 */
export function recordAccessoryDelivery(input: DeliverAccessoriesInput): ReservationAccessory[] {
  const links = getReservationAccessories();
  const reservationLinks = links.filter((link) => link.reservationNumber === input.reservationNumber);
  const deliveredSet = new Set(input.deliveredAccessoryIds);

  const unknown = input.deliveredAccessoryIds.filter(
    (accessoryId) => !reservationLinks.some((link) => link.accessoryId === accessoryId),
  );
  if (unknown.length > 0) throw new Error('أحد الملحقات المحددة غير مرتبط بهذا الحجز.');

  const updated = links.map((link) => {
    if (link.reservationNumber !== input.reservationNumber) return link;
    if (!deliveredSet.has(link.accessoryId)) return link;
    if (link.deliveredAt) return link;
    return { ...link, deliveredAt: input.deliveredAt };
  });

  saveLinks(updated);
  input.deliveredAccessoryIds.forEach((accessoryId) => {
    const accessory = getAccessoryById(accessoryId);
    if (accessory && accessory.status !== 'delivered') updateAccessoryStatus(accessory.id, 'delivered');
  });

  const delivered = updated.filter(
    (link) => link.reservationNumber === input.reservationNumber && deliveredSet.has(link.accessoryId),
  );
  if (delivered.length > 0) {
    recordAudit({
      action: 'deliver',
      entityType: 'accessory',
      entityId: input.reservationNumber,
      summary: `تم تسليم ${delivered.length} ملحقاً ضمن الحجز ${input.reservationNumber}.`,
      nextValues: { accessoryCodes: delivered.map((link) => link.accessoryCodeSnapshot) },
    });
  }
  return delivered;
}

export type AccessoryReturnEntry = {
  accessoryId: string;
  condition: AccessoryReturnCondition;
  /** Damage or loss charge; posted as an item-linked expense, not a new ledger. */
  chargeAmount?: number;
  notes?: string;
};

export type ReturnAccessoriesInput = {
  reservationNumber: string;
  entries: AccessoryReturnEntry[];
  returnedAt: string;
};

/**
 * Records the returned condition of some or all accessories.
 *
 * Partial returns are supported: only the listed accessories are closed, the
 * rest stay out. Repeating an entry for an already-returned accessory is
 * rejected, so an idempotent retry of the return command cannot charge twice.
 */
export function recordAccessoryReturn(input: ReturnAccessoriesInput): ReservationAccessory[] {
  const links = getReservationAccessories();
  const reservationLinks = links.filter((link) => link.reservationNumber === input.reservationNumber);
  const entryById = new Map(input.entries.map((entry) => [entry.accessoryId, entry]));

  input.entries.forEach((entry) => {
    const link = reservationLinks.find((item) => item.accessoryId === entry.accessoryId);
    if (!link) throw new Error('أحد الملحقات المحددة غير مرتبط بهذا الحجز.');
    if (link.returnedAt) throw new Error(`تم تسجيل استرجاع الملحق ${link.accessoryCodeSnapshot} بالفعل.`);
    if (entry.chargeAmount !== undefined && (!Number.isFinite(entry.chargeAmount) || entry.chargeAmount < 0)) {
      throw new Error('قيمة رسوم التلف أو الفقد غير صالحة.');
    }
  });

  const updated = links.map((link) => {
    if (link.reservationNumber !== input.reservationNumber) return link;
    const entry = entryById.get(link.accessoryId);
    if (!entry) return link;
    return {
      ...link,
      returnedAt: input.returnedAt,
      returnCondition: entry.condition,
      chargeAmount: entry.chargeAmount && entry.chargeAmount > 0 ? entry.chargeAmount : undefined,
      notes: entry.notes?.trim() || link.notes,
    };
  });

  saveLinks(updated);

  input.entries.forEach((entry) => {
    const accessory = getAccessoryById(entry.accessoryId);
    if (accessory) updateAccessoryStatus(accessory.id, RETURN_CONDITION_STATUS[entry.condition]);

    if (entry.chargeAmount && entry.chargeAmount > 0) {
      // The charge is a real showroom cost recovered from the customer; it is
      // posted through the existing expense/finance path so item profitability
      // and the daily close both see it exactly once.
      addExpense({
        expenseDate: input.returnedAt.slice(0, 10),
        title: `رسوم ${ACCESSORY_RETURN_CONDITION_LABELS[entry.condition]} للملحق ${accessory?.code ?? entry.accessoryId}`,
        category: entry.condition === 'lost' ? 'purchase' : 'maintenance',
        amount: entry.chargeAmount,
        paymentMethod: 'other',
        notes: `الحجز ${input.reservationNumber} — ${entry.notes?.trim() ?? ''}`.trim(),
      });
    }
  });

  const returned = updated.filter(
    (link) => link.reservationNumber === input.reservationNumber && entryById.has(link.accessoryId),
  );
  recordAudit({
    action: 'return',
    entityType: 'accessory',
    entityId: input.reservationNumber,
    summary: `تم تسجيل استرجاع ${returned.length} ملحقاً ضمن الحجز ${input.reservationNumber}.`,
    nextValues: {
      accessories: returned.map((link) => ({
        code: link.accessoryCodeSnapshot,
        condition: link.returnCondition,
        chargeAmount: link.chargeAmount ?? 0,
      })),
    },
  });
  return returned;
}

export type ReservationAccessoryView = ReservationAccessory & { accessory?: Accessory };

/** Joins links with their current accessory record for display purposes. */
export function getReservationAccessoryViews(reservationNumber: string): ReservationAccessoryView[] {
  const accessories = new Map(getAccessories().map((accessory) => [accessory.id, accessory]));
  return getAccessoriesForReservation(reservationNumber).map((link) => ({
    ...link,
    accessory: accessories.get(link.accessoryId),
  }));
}

/** Accessories still out for this reservation, i.e. delivered and not returned. */
export function getOutstandingAccessories(reservationNumber: string): ReservationAccessory[] {
  return getAccessoriesForReservation(reservationNumber).filter((link) => link.deliveredAt && !link.returnedAt);
}
