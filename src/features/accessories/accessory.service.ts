import { allocateCode, generateId, readCollection, reconcileCounter, writeCollection } from '../../services/localDatabase';
import { deriveBarcodeFromCode, identityMatchesBarcode } from '../../shared/utils/barcode';
import { recordAudit } from '../audit/audit.service';
import type {
  Accessory,
  AccessoryFilters,
  AccessoryStatus,
  AccessorySummary,
  AddAccessoryInput,
  UpdateAccessoryInput,
} from './accessory.types';
import { getAccessorySecurityDepositAmount } from './accessory.types';
import { createSearchMatcher } from '../../shared/utils/search';

const COLLECTION = 'accessories';
const RETIRED_CODES_COLLECTION = 'retired-codes';
const ACCESSORY_CODE_COUNTER = 'accessory-code';
const ACCESSORY_CODE_PREFIX = 'ACC';

const UNAVAILABLE_STATUSES = new Set<AccessoryStatus>(['lost', 'damaged', 'retired']);

type RetiredCode = { code: string; retiredAt: string };

function getRetiredCodes(): RetiredCode[] {
  return readCollection<RetiredCode>(RETIRED_CODES_COLLECTION, []);
}

function getReservedCodes(accessories: Accessory[]): string[] {
  return [...accessories.map((item) => item.code), ...getRetiredCodes().map((entry) => entry.code)].filter(Boolean);
}

export function reconcileAccessoryCodeCounter(): number {
  return reconcileCounter(ACCESSORY_CODE_COUNTER, ACCESSORY_CODE_PREFIX, getReservedCodes(getAccessories()));
}

export function allocateAccessoryCode(): string {
  return allocateCode(ACCESSORY_CODE_COUNTER, ACCESSORY_CODE_PREFIX, getReservedCodes(getAccessories()));
}

export function getAccessories(): Accessory[] {
  return readCollection<Accessory>(COLLECTION, []).map((a) => {
    const rec = a as unknown as Record<string, unknown>;
    const def = typeof rec['defaultSecurityDepositAmount'] === 'number' ? rec['defaultSecurityDepositAmount'] as number : typeof rec['depositAmount'] === 'number' ? rec['depositAmount'] as number : 0; // legacy compat
    const dep = typeof rec['depositAmount'] === 'number' ? rec['depositAmount'] as number : typeof rec['defaultSecurityDepositAmount'] === 'number' ? rec['defaultSecurityDepositAmount'] as number : 0; // legacy compat
    return {
      ...a,
      defaultSecurityDepositAmount: def,
      depositAmount: dep, // legacy compat
    };
  });
}

function saveAccessories(accessories: Accessory[]): void {
  const normalized = accessories.map((a) => ({
    ...a,
    defaultSecurityDepositAmount: getAccessorySecurityDepositAmount(a),
    depositAmount: getAccessorySecurityDepositAmount(a), // legacy compat
  }));
  writeCollection(COLLECTION, normalized);
}

export function getAccessoryById(id: string): Accessory | undefined {
  return getAccessories().find((item) => item.id === id);
}

export function getAccessoryByBarcode(value: string): Accessory | undefined {
  return getAccessories().find((item) => identityMatchesBarcode(item, value));
}

function normalizeOptionalAmount(value: number | undefined, label: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isFinite(value) || value < 0) throw new Error(`${label} غير صالح.`);
  return value;
}

export function addAccessory(input: AddAccessoryInput): Accessory {
  const name = input.name.trim();
  if (!name) throw new Error('اسم الملحق مطلوب.');

  const accessories = getAccessories();
  const code = allocateAccessoryCode();
  const secDeposit = input.defaultSecurityDepositAmount ?? input.depositAmount ?? 0; // legacy compat
  const accessory: Accessory = {
    id: generateId(),
    code,
    name,
    barcode: deriveBarcodeFromCode(code),
    category: input.category,
    status: input.status ?? 'available',
    salePrice: normalizeOptionalAmount(input.salePrice, 'سعر بيع الملحق'),
    rentalPrice: normalizeOptionalAmount(input.rentalPrice, 'سعر تأجير الملحق'),
    depositAmount: normalizeOptionalAmount(secDeposit, 'مبلغ التأمين المسترد'), // legacy compat
    defaultSecurityDepositAmount: normalizeOptionalAmount(secDeposit, 'مبلغ التأمين المسترد'),
    notes: input.notes?.trim() || undefined,
    image: input.image || undefined,
  };

  saveAccessories([accessory, ...accessories]);
  recordAudit({
    action: 'create',
    entityType: 'accessory',
    entityId: accessory.id,
    summary: `تمت إضافة الملحق ${accessory.code} — ${accessory.name}.`,
    nextValues: { code: accessory.code, category: accessory.category, status: accessory.status, defaultSecurityDepositAmount: secDeposit },
  });
  return accessory;
}

export function updateAccessory(id: string, updates: UpdateAccessoryInput): Accessory {
  const accessories = getAccessories();
  const accessory = accessories.find((item) => item.id === id);
  if (!accessory) throw new Error('الملحق المحدد غير موجود.');

  const rec = updates as unknown as Record<string, unknown>;
  const secDepositRaw = typeof rec['defaultSecurityDepositAmount'] === 'number' ? rec['defaultSecurityDepositAmount'] as number : typeof rec['depositAmount'] === 'number' ? rec['depositAmount'] as number : undefined; // legacy compat
  const next: Accessory = {
    ...accessory,
    ...updates,
    name: updates.name?.trim() || accessory.name,
    code: accessory.code,
    barcode: accessory.barcode,
    salePrice: 'salePrice' in updates ? normalizeOptionalAmount(updates.salePrice, 'سعر بيع الملحق') : accessory.salePrice,
    rentalPrice: 'rentalPrice' in updates ? normalizeOptionalAmount(updates.rentalPrice, 'سعر تأجير الملحق') : accessory.rentalPrice,
    depositAmount: secDepositRaw !== undefined ? normalizeOptionalAmount(secDepositRaw, 'مبلغ التأمين المسترد') : accessory.depositAmount, // legacy compat
    defaultSecurityDepositAmount: secDepositRaw !== undefined ? normalizeOptionalAmount(secDepositRaw, 'مبلغ التأمين المسترد') : accessory.defaultSecurityDepositAmount,
  };

  saveAccessories(accessories.map((item) => (item.id === id ? next : item)));
  recordAudit({
    action: 'update',
    entityType: 'accessory',
    entityId: accessory.id,
    summary: `تم تحديث بيانات الملحق ${accessory.code}.`,
    previousValues: { status: accessory.status, name: accessory.name },
    nextValues: { status: next.status, name: next.name },
  });
  return next;
}

export function updateAccessoryStatus(id: string, status: AccessoryStatus): Accessory {
  return updateAccessory(id, { status });
}

export function retireAccessory(id: string): Accessory {
  const accessory = getAccessoryById(id);
  if (!accessory) throw new Error('الملحق المحدد غير موجود.');
  if (accessory.status === 'delivered') throw new Error('لا يمكن إخراج ملحق مسلَّم من المخزون قبل استرجاعه.');

  return updateAccessory(id, { status: 'retired', retiredAt: new Date().toISOString() });
}

export function restoreRetiredAccessory(id: string, status: AccessoryStatus = 'service'): Accessory {
  const accessory = getAccessoryById(id);
  if (!accessory) throw new Error('الملحق المحدد غير موجود.');
  return updateAccessory(id, { status, retiredAt: undefined });
}

export function isAccessoryBookable(accessory: Accessory): boolean {
  return !UNAVAILABLE_STATUSES.has(accessory.status);
}

export function filterAccessories(accessories: Accessory[], filters: AccessoryFilters): Accessory[] {
  const matchesQuery = createSearchMatcher(filters.search);

  return accessories.filter((accessory) => {
    const matchesSearch = matchesQuery([accessory.code, accessory.barcode, accessory.name, accessory.notes]);
    const matchesCategory = filters.category === 'all' || accessory.category === filters.category;
    const matchesStatus = filters.status === 'all' || accessory.status === filters.status;
    return matchesSearch && matchesCategory && matchesStatus;
  });
}

export function summarizeAccessories(accessories: Accessory[]): AccessorySummary {
  return {
    total: accessories.length,
    available: accessories.filter((item) => item.status === 'available').length,
    out: accessories.filter((item) => item.status === 'delivered' || item.status === 'reserved').length,
    unavailable: accessories.filter((item) => UNAVAILABLE_STATUSES.has(item.status) || item.status === 'service').length,
  };
}
