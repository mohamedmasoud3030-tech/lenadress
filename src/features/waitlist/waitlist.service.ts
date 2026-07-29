import { generateId, readCollection, writeCollection } from '../../services/localDatabase';
import { getTodayISO } from '../../shared/utils/date';
import { recordAudit } from '../audit/audit.service';
import { getCustomers } from '../customers/customer.service';
import { getBookablePieces, getDressDesignById } from '../dresses/design.service';
import { getDresses } from '../dresses/dress.service';
import { getShowroomProfile } from '../preferences/showroomProfile.service';
import { getReservations } from '../reservations/reservation.service';
import { findItemConflicts } from '../reservations/reservationConflicts';
import type {
  AddWaitlistEntryInput,
  WaitlistEntry,
  WaitlistFilters,
  WaitlistOpportunity,
  WaitlistSummary,
} from './waitlist.types';

/**
 * The waiting list.
 *
 * Availability is never stored on an entry. Whether a wanted period is free is
 * recomputed from the reservations through the shared conflict rule every time,
 * because a booking can be cancelled, extended or moved at any moment — a
 * cached "available" flag would send the operator to call a customer about a
 * dress that was re-booked an hour ago.
 */

const COLLECTION = 'waitlist';

export function getWaitlistEntries(): WaitlistEntry[] {
  return readCollection<WaitlistEntry>(COLLECTION, []);
}

function save(entries: WaitlistEntry[]): void {
  writeCollection(COLLECTION, entries);
}

export function addWaitlistEntry(input: AddWaitlistEntryInput): WaitlistEntry {
  const customer = getCustomers().find((item) => item.id === input.customerId);
  if (!customer) throw new Error('العميلة المحددة غير موجودة.');
  if (!input.designId && !input.inventoryItemId) throw new Error('اختاري تصميماً أو قطعة لإضافتها لقائمة الانتظار.');
  if (!input.pickupDate || !input.returnDate) throw new Error('حددي تاريخ الاستلام والإرجاع.');
  if (input.returnDate <= input.pickupDate) throw new Error('تاريخ الإرجاع يجب أن يكون بعد تاريخ الاستلام.');
  if (input.returnDate < getTodayISO()) throw new Error('لا يمكن الانتظار على فترة انتهت بالفعل.');

  const design = input.designId ? getDressDesignById(input.designId) : undefined;
  if (input.designId && !design) throw new Error('التصميم المحدد غير موجود.');
  const piece = input.inventoryItemId ? getDresses().find((item) => item.id === input.inventoryItemId) : undefined;
  if (input.inventoryItemId && !piece) throw new Error('القطعة المحددة غير موجودة.');

  const entries = getWaitlistEntries();
  const duplicate = entries.find((entry) => entry.status === 'waiting'
    && entry.customerId === customer.id
    && entry.pickupDate === input.pickupDate
    && (input.designId ? entry.designId === input.designId : entry.inventoryItemId === input.inventoryItemId));
  if (duplicate) throw new Error('العميلة مسجّلة بالفعل في قائمة الانتظار لنفس الطلب والفترة.');

  const entry: WaitlistEntry = {
    id: generateId(),
    customerId: customer.id,
    customerName: customer.name,
    customerPhone: customer.phone,
    designId: design?.id,
    designCode: design?.code,
    designName: design?.name,
    inventoryItemId: piece?.id,
    dressCode: piece?.code,
    size: input.size?.trim() || undefined,
    color: input.color?.trim() || undefined,
    pickupDate: input.pickupDate,
    returnDate: input.returnDate,
    status: 'waiting',
    notes: input.notes?.trim() || undefined,
    createdAt: new Date().toISOString(),
  };

  save([entry, ...entries]);
  recordAudit({
    action: 'create',
    entityType: 'reservation',
    entityId: entry.id,
    summary: `تمت إضافة ${customer.name} لقائمة انتظار ${design?.name ?? piece?.code ?? ''}.`,
    nextValues: { pickupDate: entry.pickupDate, returnDate: entry.returnDate },
  });
  return entry;
}

function updateEntry(id: string, patch: Partial<WaitlistEntry>, summary: string): WaitlistEntry {
  const entries = getWaitlistEntries();
  const entry = entries.find((item) => item.id === id);
  if (!entry) throw new Error('طلب الانتظار غير موجود.');

  const next = { ...entry, ...patch };
  save(entries.map((item) => (item.id === id ? next : item)));
  recordAudit({
    action: 'update',
    entityType: 'reservation',
    entityId: id,
    summary,
    previousValues: { status: entry.status },
    nextValues: { status: next.status },
  });
  return next;
}

export function markWaitlistNotified(id: string): WaitlistEntry {
  return updateEntry(
    id,
    { status: 'notified', notifiedAt: new Date().toISOString() },
    'تم إبلاغ العميلة بتوفر طلبها من قائمة الانتظار.',
  );
}

export function markWaitlistConverted(id: string, reservationNumber: string): WaitlistEntry {
  return updateEntry(
    id,
    { status: 'converted', reservationNumber, closedAt: new Date().toISOString() },
    `تحوّل طلب الانتظار إلى الحجز ${reservationNumber}.`,
  );
}

export function closeWaitlistEntry(id: string): WaitlistEntry {
  return updateEntry(id, { status: 'closed', closedAt: new Date().toISOString() }, 'تم إغلاق طلب الانتظار.');
}

/** Codes of the pieces that would satisfy this entry, right now. */
function findAvailableCodes(entry: WaitlistEntry): string[] {
  const period = { pickupDate: entry.pickupDate, returnDate: entry.returnDate };

  if (entry.designId) {
    return getBookablePieces(entry.designId, period, entry.size, entry.color).map((piece) => piece.code);
  }

  const piece = getDresses().find((item) => item.id === entry.inventoryItemId);
  if (!piece) return [];
  const rentable = piece.isForRent && piece.status !== 'damaged' && piece.status !== 'sold' && !piece.archivedAt;
  if (!rentable) return [];
  const conflicts = findItemConflicts(
    { inventoryItemId: piece.id, dressCode: piece.code, pickupDate: entry.pickupDate, returnDate: entry.returnDate },
    getReservations(),
  );
  return conflicts.length === 0 ? [piece.code] : [];
}

function buildMessage(entry: WaitlistEntry): string {
  const what = entry.designName ?? entry.dressCode ?? 'القطعة المطلوبة';
  return `مرحباً ${entry.customerName}،\n`
    + `تتوفر الآن ${what} في الفترة من ${entry.pickupDate} إلى ${entry.returnDate}`
    + `${entry.size ? ` — مقاس ${entry.size}` : ''}${entry.color ? ` — لون ${entry.color}` : ''}.`
    + `\nهل ترغبين بتأكيد الحجز؟ نحتفظ بها لكِ حتى نسمع منكِ.`
    + `\n\n${getShowroomProfile().brandName}`;
}

/**
 * Entries whose wanted period has actually become free.
 *
 * Ordered by when the customer asked, so the queue is honoured rather than
 * whoever happens to be at the top of the list.
 */
export function getWaitlistOpportunities(): WaitlistOpportunity[] {
  const today = getTodayISO();

  return getWaitlistEntries()
    .filter((entry) => entry.status === 'waiting' || entry.status === 'notified')
    // A period that has already passed cannot be offered.
    .filter((entry) => entry.returnDate >= today)
    .map((entry) => ({ entry, availableCodes: findAvailableCodes(entry), message: buildMessage(entry) }))
    .filter((opportunity) => opportunity.availableCodes.length > 0)
    .sort((left, right) => left.entry.createdAt.localeCompare(right.entry.createdAt));
}

export function filterWaitlist(entries: WaitlistEntry[], filters: WaitlistFilters): WaitlistEntry[] {
  const search = filters.search.trim().toLowerCase();

  return entries.filter((entry) => {
    const matchesStatus = filters.status === 'all' || entry.status === filters.status;
    if (!search) return matchesStatus;
    const haystack = `${entry.customerName} ${entry.customerPhone} ${entry.designName ?? ''} ${entry.designCode ?? ''} ${entry.dressCode ?? ''}`;
    return matchesStatus && haystack.toLowerCase().includes(search);
  });
}

export function summarizeWaitlist(entries: WaitlistEntry[]): WaitlistSummary {
  const readyIds = new Set(getWaitlistOpportunities().map((opportunity) => opportunity.entry.id));
  return {
    waiting: entries.filter((entry) => entry.status === 'waiting').length,
    ready: entries.filter((entry) => readyIds.has(entry.id)).length,
    notified: entries.filter((entry) => entry.status === 'notified').length,
    converted: entries.filter((entry) => entry.status === 'converted').length,
  };
}
