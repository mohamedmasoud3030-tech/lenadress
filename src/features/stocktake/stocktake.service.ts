import { allocateCode, generateId, readCollection, reconcileCounter, writeCollection } from '../../services/localDatabase';
import { recordAudit } from '../audit/audit.service';
import { getDresses } from '../dresses/dress.service';
import { getAccessories } from '../accessories/accessory.service';
import { getReservations } from '../reservations/reservation.service';
import { getReservationAccessories } from '../accessories/reservationAccessory.service';
import { isActiveReservation } from '../reservations/reservationConflicts';
import { getReservationLines } from '../reservations/contractLineHelpers';
import { matchesSearchQuery } from '../../shared/utils/search';
import type { Dress } from '../dresses/dress.types';
import type { Accessory } from '../accessories/accessory.types';
import type {
  StocktakeFinding,
  StocktakeItemKind,
  StocktakeReport,
  StocktakeScan,
  StocktakeSession,
} from './stocktake.types';

/**
 * Stocktake sessions.
 *
 * The counting model is deliberately additive: scanning records presence, and
 * nothing else. Absence is *derived* when the session closes, by subtracting
 * what was scanned from what should have been on the rail.
 *
 * The alternative — a checklist the operator ticks and unticks — was rejected
 * because an unticked box is ambiguous. It could mean "I looked and it is not
 * there" or "I have not reached that shelf yet", and a report built on that
 * ambiguity is worthless. A scan is unambiguous: the piece was physically in
 * the operator's hand.
 *
 * Items legitimately out of the building are classified rather than reported as
 * missing. A count that flags every rented dress is noise, and noise gets
 * ignored within a week.
 */

const COLLECTION = 'stocktake-sessions';
const SESSION_COUNTER = 'stocktake-session';
const SESSION_PREFIX = 'STK';

/** Item states meaning the piece is physically elsewhere by design. */
const SERVICE_STATUSES = new Set<Dress['status']>(['inspection', 'laundry', 'maintenance']);

export function getStocktakeSessions(): StocktakeSession[] {
  return readCollection<StocktakeSession>(COLLECTION, []);
}

function saveSessions(sessions: StocktakeSession[]): void {
  writeCollection(COLLECTION, sessions);
}

export function reconcileStocktakeCounter(): number {
  return reconcileCounter(SESSION_COUNTER, SESSION_PREFIX, getStocktakeSessions().map((session) => session.sessionNumber));
}

export function getOpenStocktakeSession(): StocktakeSession | undefined {
  return getStocktakeSessions().find((session) => session.status === 'open');
}

export function getStocktakeSessionById(id: string): StocktakeSession | undefined {
  return getStocktakeSessions().find((session) => session.id === id);
}

/**
 * Opens a counting session.
 *
 * Only one may be open at a time. Two concurrent counts on one showroom's stock
 * would each see half the scans and both would report the other half missing.
 */
export function startStocktakeSession(scope?: string): StocktakeSession {
  const sessions = getStocktakeSessions();
  if (sessions.some((session) => session.status === 'open')) {
    throw new Error('توجد جلسة جرد مفتوحة بالفعل. أغلقيها أو ألغيها قبل بدء جلسة جديدة.');
  }

  reconcileStocktakeCounter();
  const session: StocktakeSession = {
    id: generateId(),
    sessionNumber: allocateCode(SESSION_COUNTER, SESSION_PREFIX, sessions.map((item) => item.sessionNumber)),
    status: 'open',
    startedAt: new Date().toISOString(),
    scope: scope?.trim() || undefined,
    scans: [],
  };

  saveSessions([session, ...sessions]);
  recordAudit({
    action: 'create',
    entityType: 'stocktake',
    entityId: session.id,
    summary: `تم بدء جلسة جرد ${session.sessionNumber}.`,
    nextValues: { sessionNumber: session.sessionNumber, scope: session.scope },
  });
  return session;
}

type ResolvedItem = { kind: StocktakeItemKind; itemId: string; code: string; name: string };

/**
 * Resolves a scanned or typed value to a catalogue item.
 *
 * Matching is tried on the barcode first and the stock code second, because a
 * scanner emits the barcode while an operator typing by hand knows the code.
 * Both are compared through the shared Arabic-aware matcher so a typed value
 * behaves like every other search in the app.
 */
export function resolveStocktakeItem(value: string): ResolvedItem | undefined {
  const needle = value.trim();
  if (!needle) return undefined;

  const dress = getDresses().find((item) => item.barcode === needle || item.code === needle)
    ?? getDresses().find((item) => matchesSearchQuery(needle, [item.barcode, item.code]));
  if (dress) return { kind: 'dress', itemId: dress.id, code: dress.code, name: dress.name };

  const accessory = getAccessories().find((item) => item.barcode === needle || item.code === needle)
    ?? getAccessories().find((item) => matchesSearchQuery(needle, [item.barcode, item.code]));
  if (accessory) return { kind: 'accessory', itemId: accessory.id, code: accessory.code, name: accessory.name };

  return undefined;
}

/**
 * Records that an item was physically seen.
 *
 * Re-scanning the same piece is a no-op rather than an error: during a real
 * count the operator loses her place constantly, and an app that scolds her for
 * scanning twice trains her to stop scanning.
 */
export function recordStocktakeScan(sessionId: string, value: string): { session: StocktakeSession; scan: StocktakeScan | null; duplicate: boolean } {
  const sessions = getStocktakeSessions();
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) throw new Error('جلسة الجرد المحددة غير موجودة.');
  if (session.status !== 'open') throw new Error('لا يمكن التسجيل في جلسة جرد مغلقة.');

  const resolved = resolveStocktakeItem(value);
  if (!resolved) throw new Error(`لم يتم العثور على عنصر بالكود أو الباركود «${value.trim()}».`);

  const already = session.scans.find((scan) => scan.kind === resolved.kind && scan.itemId === resolved.itemId);
  if (already) return { session, scan: already, duplicate: true };

  const scan: StocktakeScan = { ...resolved, scannedAt: new Date().toISOString() };
  const updated: StocktakeSession = { ...session, scans: [...session.scans, scan] };
  saveSessions(sessions.map((item) => (item.id === session.id ? updated : item)));
  return { session: updated, scan, duplicate: false };
}

/** Removes a scan, for the case where the operator scanned the wrong shelf. */
export function removeStocktakeScan(sessionId: string, kind: StocktakeItemKind, itemId: string): StocktakeSession {
  const sessions = getStocktakeSessions();
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) throw new Error('جلسة الجرد المحددة غير موجودة.');
  if (session.status !== 'open') throw new Error('لا يمكن التعديل على جلسة جرد مغلقة.');

  const updated: StocktakeSession = {
    ...session,
    scans: session.scans.filter((scan) => !(scan.kind === kind && scan.itemId === itemId)),
  };
  saveSessions(sessions.map((item) => (item.id === session.id ? updated : item)));
  return updated;
}

/** Reservation numbers currently holding each item, for the absence explanation. */
function buildOutOnRentalMap(): { dresses: Map<string, string>; accessories: Map<string, string> } {
  const reservations = getReservations().filter(isActiveReservation);
  const delivered = reservations.filter((reservation) => reservation.status === 'delivered' || reservation.status === 'overdue');

  const dresses = new Map<string, string>();
  delivered.forEach((reservation) => {
    // Check each line's inventoryItemId for multi-item support
    const lines = getReservationLines(reservation);
    lines.forEach((line) => {
      if (line.deliveryStatus === 'delivered' || line.deliveryStatus === 'late') {
        if (line.inventoryItemId) dresses.set(line.inventoryItemId, reservation.reservationNumber);
      }
    });
    // Also check top-level for backward compatibility
    if (reservation.inventoryItemId && !dresses.has(reservation.inventoryItemId)) {
      dresses.set(reservation.inventoryItemId, reservation.reservationNumber);
    }
  });

  const deliveredNumbers = new Set(delivered.map((reservation) => reservation.reservationNumber));
  const accessories = new Map<string, string>();
  getReservationAccessories()
    .filter((link) => link.deliveredAt && !link.returnedAt && deliveredNumbers.has(link.reservationNumber))
    .forEach((link) => accessories.set(link.accessoryId, link.reservationNumber));

  return { dresses, accessories };
}

function classifyDress(dress: Dress, outOnRental: Map<string, string>): StocktakeFinding {
  const base = { kind: 'dress' as const, itemId: dress.id, code: dress.code, name: dress.name };

  if (dress.archivedAt) return { ...base, reason: 'archived', detail: 'عنصر مؤرشف خارج المخزون العامل.' };
  if (dress.status === 'sold') return { ...base, reason: 'sold', detail: 'تم بيع القطعة.' };

  const reservationNumber = outOnRental.get(dress.id);
  if (reservationNumber) {
    return { ...base, reason: 'out_on_rental', detail: `مسلّمة ضمن الحجز ${reservationNumber}.` };
  }

  if (SERVICE_STATUSES.has(dress.status)) {
    return { ...base, reason: 'in_service', detail: 'القطعة في الفحص أو المغسلة أو التعديل.' };
  }

  return { ...base, reason: 'unexplained', detail: 'يفترض وجودها في المحل ولم يتم العثور عليها.' };
}

function classifyAccessory(accessory: Accessory, outOnRental: Map<string, string>): StocktakeFinding {
  const base = { kind: 'accessory' as const, itemId: accessory.id, code: accessory.code, name: accessory.name };

  if (accessory.retiredAt) return { ...base, reason: 'archived', detail: 'ملحق مؤرشف.' };

  const reservationNumber = outOnRental.get(accessory.id);
  if (reservationNumber) {
    return { ...base, reason: 'out_on_rental', detail: `مسلّم ضمن الحجز ${reservationNumber}.` };
  }

  if (accessory.status === 'service') return { ...base, reason: 'in_service', detail: 'الملحق في الخدمة.' };
  if (accessory.status === 'lost') return { ...base, reason: 'unexplained', detail: 'مسجّل كمفقود مسبقاً.' };

  return { ...base, reason: 'unexplained', detail: 'يفترض وجوده في المحل ولم يتم العثور عليه.' };
}

/**
 * Builds the report for a session without closing it, so the operator can see
 * her progress mid-count and know which shelf still needs walking.
 */
export function buildStocktakeReport(sessionId: string): StocktakeReport {
  const session = getStocktakeSessionById(sessionId);
  if (!session) throw new Error('جلسة الجرد المحددة غير موجودة.');

  const outOnRental = buildOutOnRentalMap();
  const scannedDressIds = new Set(session.scans.filter((scan) => scan.kind === 'dress').map((scan) => scan.itemId));
  const scannedAccessoryIds = new Set(session.scans.filter((scan) => scan.kind === 'accessory').map((scan) => scan.itemId));

  const present: StocktakeFinding[] = [];
  const expectedAbsent: StocktakeFinding[] = [];
  const missing: StocktakeFinding[] = [];

  const catalogueDressIds = new Set<string>();
  getDresses().forEach((dress) => {
    catalogueDressIds.add(dress.id);
    const finding = classifyDress(dress, outOnRental.dresses);

    if (scannedDressIds.has(dress.id)) {
      // Found in the showroom. Note that finding a piece that should be out on
      // a rental is itself worth knowing, so the reason is preserved.
      present.push(finding);
      return;
    }

    if (finding.reason === 'unexplained') missing.push(finding);
    else expectedAbsent.push(finding);
  });

  const catalogueAccessoryIds = new Set<string>();
  getAccessories().forEach((accessory) => {
    catalogueAccessoryIds.add(accessory.id);
    const finding = classifyAccessory(accessory, outOnRental.accessories);

    if (scannedAccessoryIds.has(accessory.id)) {
      present.push(finding);
      return;
    }

    if (finding.reason === 'unexplained') missing.push(finding);
    else expectedAbsent.push(finding);
  });

  // A scan whose item has since been deleted from the catalogue. Rare, but
  // silently dropping it would hide a real data problem.
  const unknownScans = session.scans.filter((scan) => (
    scan.kind === 'dress' ? !catalogueDressIds.has(scan.itemId) : !catalogueAccessoryIds.has(scan.itemId)
  ));

  const expectedPresent = present.length + missing.length;
  const coveragePercent = expectedPresent > 0 ? Math.round((present.length / expectedPresent) * 100) : 100;

  return {
    session,
    countedTotal: session.scans.length,
    present,
    expectedAbsent,
    missing,
    unknownScans,
    summary: {
      expectedPresent,
      counted: present.length,
      missingCount: missing.length,
      expectedAbsentCount: expectedAbsent.length,
      coveragePercent,
    },
  };
}

/**
 * Closes the session and freezes its report.
 *
 * Closing deliberately does **not** change any item's status. A stocktake is an
 * observation, not an authority: automatically marking unfound pieces as lost
 * would let one hurried count write off real stock, and the reason a piece is
 * missing usually turns out to be a human one the app cannot see.
 */
export function completeStocktakeSession(sessionId: string, notes?: string): StocktakeReport {
  const sessions = getStocktakeSessions();
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) throw new Error('جلسة الجرد المحددة غير موجودة.');
  if (session.status !== 'open') throw new Error('جلسة الجرد مغلقة بالفعل.');

  const report = buildStocktakeReport(sessionId);
  const completed: StocktakeSession = {
    ...session,
    status: 'completed',
    completedAt: new Date().toISOString(),
    notes: notes?.trim() || session.notes,
  };
  saveSessions(sessions.map((item) => (item.id === session.id ? completed : item)));

  recordAudit({
    action: 'update',
    entityType: 'stocktake',
    entityId: session.id,
    summary: `تم إقفال جلسة الجرد ${session.sessionNumber} بعدد ${report.summary.counted} قطعة و${report.summary.missingCount} مفقودة.`,
    nextValues: {
      sessionNumber: session.sessionNumber,
      counted: report.summary.counted,
      missing: report.summary.missingCount,
      coveragePercent: report.summary.coveragePercent,
    },
  });

  return { ...report, session: completed };
}

export function cancelStocktakeSession(sessionId: string): StocktakeSession {
  const sessions = getStocktakeSessions();
  const session = sessions.find((item) => item.id === sessionId);
  if (!session) throw new Error('جلسة الجرد المحددة غير موجودة.');
  if (session.status !== 'open') throw new Error('لا يمكن إلغاء جلسة جرد مغلقة.');

  const cancelled: StocktakeSession = { ...session, status: 'cancelled', completedAt: new Date().toISOString() };
  saveSessions(sessions.map((item) => (item.id === session.id ? cancelled : item)));
  recordAudit({
    action: 'update',
    entityType: 'stocktake',
    entityId: session.id,
    summary: `تم إلغاء جلسة الجرد ${session.sessionNumber}.`,
  });
  return cancelled;
}
