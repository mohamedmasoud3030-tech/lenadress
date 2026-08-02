import { allocateCode, generateId, readCollection, reconcileCounter, writeCollection } from '../../services/localDatabase';
import { recordAudit } from '../audit/audit.service';
import { findItemConflicts } from '../reservations/reservationConflicts';
import { getReservations } from '../reservations/reservation.service';
import { addDress, getDresses } from './dress.service';
import type { Dress } from './dress.types';
import type {
  AddDressDesignInput,
  DesignVariantInput,
  DesignVariantSummary,
  DressDesign,
  DressDesignSummary,
  UpdateDressDesignInput,
} from './design.types';

/**
 * Dress designs — the grouping above physical pieces.
 *
 * A design never holds stock or availability itself. Every question about "is
 * this available" is answered by looking at its pieces and running the existing
 * central conflict rule against them, so there is exactly one definition of an
 * occupied period in the application.
 *
 * Design codes use their own monotonic counter, separate from item codes, so a
 * design code and a piece code can never be confused for one another.
 */

const COLLECTION = 'dress-designs';
const RETIRED_CODES_COLLECTION = 'retired-codes';
const DESIGN_CODE_COUNTER = 'design-code';
const DESIGN_CODE_PREFIX = 'DSG';

/** Pieces in these states are not part of the working stock. */
const RETIRED_PIECE_STATUSES = new Set<Dress['status']>(['sold', 'inactive']);

type RetiredCode = { code: string; retiredAt: string };

function getRetiredCodes(): RetiredCode[] {
  return readCollection<RetiredCode>(RETIRED_CODES_COLLECTION, []);
}

function getReservedCodes(designs: DressDesign[]): string[] {
  return [...designs.map((design) => design.code), ...getRetiredCodes().map((entry) => entry.code)].filter(Boolean);
}

export function reconcileDesignCodeCounter(): number {
  return reconcileCounter(DESIGN_CODE_COUNTER, DESIGN_CODE_PREFIX, getReservedCodes(getDressDesigns()));
}

export function allocateDesignCode(): string {
  return allocateCode(DESIGN_CODE_COUNTER, DESIGN_CODE_PREFIX, getReservedCodes(getDressDesigns()));
}

export function getDressDesigns(): DressDesign[] {
  return readCollection<DressDesign>(COLLECTION, []);
}

function saveDesigns(designs: DressDesign[]): void {
  writeCollection(COLLECTION, designs);
}

export function getDressDesignById(id: string): DressDesign | undefined {
  return getDressDesigns().find((design) => design.id === id);
}

export function getDressDesignByCode(code: string): DressDesign | undefined {
  const normalized = code.trim().toUpperCase();
  return getDressDesigns().find((design) => design.code.toUpperCase() === normalized);
}

/** Physical pieces belonging to a design, excluding sold and retired ones. */
export function getDesignPieces(designId: string, includeRetired = false): Dress[] {
  return getDresses().filter((dress) => dress.designId === designId
    && (includeRetired || (!dress.archivedAt && !RETIRED_PIECE_STATUSES.has(dress.status))));
}

function assertAmount(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} غير صالح.`);
  return value;
}

export function addDressDesign(input: AddDressDesignInput): DressDesign {
  const name = input.name.trim();
  if (!name) throw new Error('اسم التصميم مطلوب.');

  const designs = getDressDesigns();
  const design: DressDesign = {
    id: generateId(),
    code: allocateDesignCode(),
    name,
    description: input.description?.trim() ?? '',
    category: input.category,
    defaultRentalPrice: assertAmount(input.defaultRentalPrice, 'سعر الإيجار الافتراضي'),
    defaultSalePrice: assertAmount(input.defaultSalePrice, 'سعر البيع الافتراضي'),
    defaultDepositAmount: assertAmount(input.defaultDepositAmount, 'مبلغ التأمين الافتراضي'),
    images: input.images ?? [],
    notes: input.notes?.trim() || undefined,
  };

  saveDesigns([design, ...designs]);
  recordAudit({
    action: 'create',
    entityType: 'dress',
    entityId: design.id,
    summary: `تمت إضافة التصميم ${design.code} — ${design.name}.`,
    nextValues: { code: design.code, category: design.category },
  });
  return design;
}

export function updateDressDesign(id: string, updates: UpdateDressDesignInput): DressDesign {
  const designs = getDressDesigns();
  const design = designs.find((item) => item.id === id);
  if (!design) throw new Error('التصميم المحدد غير موجود.');

  const next: DressDesign = {
    ...design,
    ...updates,
    // Identity is never editable.
    id: design.id,
    code: design.code,
    name: updates.name?.trim() || design.name,
  };

  saveDesigns(designs.map((item) => (item.id === id ? next : item)));
  recordAudit({
    action: 'update',
    entityType: 'dress',
    entityId: design.id,
    summary: `تم تحديث التصميم ${design.code}.`,
    previousValues: { name: design.name },
    nextValues: { name: next.name },
  });
  return next;
}

/**
 * Creates the physical pieces of a design.
 *
 * Each piece goes through the normal inventory path, so it gets its own
 * never-reused stock code, its own derived barcode and its own audit entry —
 * exactly like an item added on its own. Nothing about the piece model changes;
 * the design is only recorded as its parent.
 */
export function addDesignVariants(designId: string, variants: DesignVariantInput[]): Dress[] {
  const design = getDressDesignById(designId);
  if (!design) throw new Error('التصميم المحدد غير موجود.');
  if (variants.length === 0) throw new Error('أضيفي مقاساً أو لوناً واحداً على الأقل.');

  const created: Dress[] = [];

  variants.forEach((variant) => {
    const size = variant.size.trim();
    const color = variant.color.trim();
    if (!size) throw new Error('مقاس القطعة مطلوب.');
    if (!color) throw new Error('لون القطعة مطلوب.');

    const quantity = variant.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
      throw new Error('عدد القطع يجب أن يكون رقماً صحيحاً بين 1 و 50.');
    }

    const rentalPrice = variant.rentalPrice ?? design.defaultRentalPrice;
    const salePrice = variant.salePrice ?? design.defaultSalePrice;
    const depositAmount = variant.depositAmount ?? design.defaultDepositAmount; // legacy compat

    for (let index = 0; index < quantity; index += 1) {
      created.push(addDress({
        name: design.name,
        description: design.description,
        itemType: 'dress',
        category: design.category,
        color,
        size,
        purchasePrice: 0,
        rentalPrice,
        salePrice,
        depositAmount, // legacy compat
        status: 'available',
        isForRent: rentalPrice > 0,
        isForSale: salePrice > 0,
        images: design.images,
        designId: design.id,
        designCode: design.code,
        notes: design.notes,
      }));
    }
  });

  recordAudit({
    action: 'create',
    entityType: 'dress',
    entityId: design.id,
    summary: `تمت إضافة ${created.length} قطعة إلى التصميم ${design.code}.`,
    nextValues: { pieceCodes: created.map((piece) => piece.code) },
  });
  return created;
}

/** Links an existing standalone piece to a design without touching its history. */
export function assignPieceToDesign(dressCode: string, designId: string): Dress {
  const design = getDressDesignById(designId);
  if (!design) throw new Error('التصميم المحدد غير موجود.');

  const dresses = getDresses();
  const dress = dresses.find((item) => item.code === dressCode);
  if (!dress) throw new Error('العنصر المحدد غير موجود.');

  const updated: Dress = { ...dress, designId: design.id, designCode: design.code };
  writeCollection('dresses', dresses.map((item) => (item.code === dressCode ? updated : item)));
  recordAudit({
    action: 'update',
    entityType: 'dress',
    entityId: dress.id,
    summary: `تم ربط القطعة ${dress.code} بالتصميم ${design.code}.`,
    nextValues: { designCode: design.code },
  });
  return updated;
}

export type AvailabilityPeriod = { pickupDate: string; returnDate: string };

/**
 * Groups a design's pieces by size and colour.
 *
 * When a period is supplied, `freeInPeriod` counts the pieces that are actually
 * bookable then, resolved through the shared conflict rule rather than a stored
 * flag. That is what lets the operator answer "do we have this design in size L
 * for that weekend?" without opening each piece.
 */
export function summarizeDesignVariants(designId: string, period?: AvailabilityPeriod): DesignVariantSummary[] {
  const pieces = getDesignPieces(designId);
  const reservations = period ? getReservations() : [];
  const grouped = new Map<string, DesignVariantSummary>();

  pieces.forEach((piece) => {
    const key = `${piece.size}||${piece.color}`;
    const entry = grouped.get(key) ?? {
      size: piece.size,
      color: piece.color,
      total: 0,
      available: 0,
      ...(period ? { freeInPeriod: 0 } : {}),
    };

    entry.total += 1;
    if (piece.status === 'available') entry.available += 1;

    if (period) {
      const conflicts = findItemConflicts({
        inventoryItemId: piece.id,
        dressCode: piece.code,
        pickupDate: period.pickupDate,
        returnDate: period.returnDate,
      }, reservations);
      // A piece is free only when it is rentable AND nothing overlaps the period.
      const rentable = piece.isForRent && piece.status !== 'damaged' && piece.status !== 'sold';
      if (rentable && conflicts.length === 0) entry.freeInPeriod = (entry.freeInPeriod ?? 0) + 1;
    }

    grouped.set(key, entry);
  });

  return Array.from(grouped.values()).sort((left, right) =>
    left.size.localeCompare(right.size) || left.color.localeCompare(right.color));
}

export function summarizeDressDesign(design: DressDesign, period?: AvailabilityPeriod): DressDesignSummary {
  const pieces = getDesignPieces(design.id);
  const variants = summarizeDesignVariants(design.id, period);

  return {
    design,
    pieceCount: pieces.length,
    availableCount: pieces.filter((piece) => piece.status === 'available').length,
    sizes: Array.from(new Set(pieces.map((piece) => piece.size))).sort(),
    colors: Array.from(new Set(pieces.map((piece) => piece.color))).sort(),
    variants,
    lowestRentalPrice: pieces.length > 0
      ? Math.min(...pieces.map((piece) => piece.rentalPrice))
      : design.defaultRentalPrice,
  };
}

export function summarizeAllDesigns(period?: AvailabilityPeriod): DressDesignSummary[] {
  return getDressDesigns()
    .filter((design) => !design.archivedAt)
    .map((design) => summarizeDressDesign(design, period));
}

/**
 * The pieces of a design that can actually be booked for a period, optionally
 * narrowed to one size and colour. This is what the reservation form offers.
 */
export function getBookablePieces(designId: string, period: AvailabilityPeriod, size?: string, color?: string): Dress[] {
  const reservations = getReservations();

  return getDesignPieces(designId)
    .filter((piece) => (!size || piece.size === size) && (!color || piece.color === color))
    .filter((piece) => piece.isForRent && piece.status !== 'damaged' && piece.status !== 'sold')
    .filter((piece) => findItemConflicts({
      inventoryItemId: piece.id,
      dressCode: piece.code,
      pickupDate: period.pickupDate,
      returnDate: period.returnDate,
    }, reservations).length === 0);
}

/** A design can only be retired once none of its pieces are still in use. */
export function archiveDressDesign(id: string): DressDesign {
  const design = getDressDesignById(id);
  if (!design) throw new Error('التصميم المحدد غير موجود.');

  const activePieces = getDesignPieces(id).filter((piece) => piece.status === 'rented' || piece.status === 'reserved');
  if (activePieces.length > 0) {
    throw new Error(`لا يمكن أرشفة التصميم قبل عودة ${activePieces.length} قطعة ما زالت خارج المحل.`);
  }

  return updateDressDesign(id, { archivedAt: new Date().toISOString() });
}
