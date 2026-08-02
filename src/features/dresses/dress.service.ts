import { Dress, DressFilters, getDressSecurityDepositAmount } from './dress.types';
import { allocateCode, generateId, migrateLegacyInventoryStorage, readCollection, reconcileCounter, writeCollection } from '../../services/localDatabase';
import { recordAudit } from '../audit/audit.service';
import { assertDressCanBeArchived, getDressHardDeleteBlockers } from '../integrity/integrity.service';
import { dressMatchesBarcode, generateDressBarcodeValue } from './barcode.utils';
import { createSearchMatcher } from '../../shared/utils/search';

const INVENTORY_COLLECTION = 'dresses';
const RETIRED_CODES_COLLECTION = 'retired-codes';
const INVENTORY_CODE_COUNTER = 'inventory-code';
const INVENTORY_CODE_PREFIX = 'D';

type RetiredCode = { code: string; retiredAt: string };

function getRetiredCodes(): RetiredCode[] {
  return readCollection<RetiredCode>(RETIRED_CODES_COLLECTION, []);
}

function getReservedCodes(dresses: Dress[]): string[] {
  return [...dresses.map((dress) => dress.code), ...getRetiredCodes().map((entry) => entry.code)].filter(Boolean);
}

export function reconcileInventoryCodeCounter(): number {
  return reconcileCounter(INVENTORY_CODE_COUNTER, INVENTORY_CODE_PREFIX, getReservedCodes(getDressesFromStorage()));
}

export function allocateInventoryCode(): string {
  return allocateCode(INVENTORY_CODE_COUNTER, INVENTORY_CODE_PREFIX, getReservedCodes(getDressesFromStorage()));
}

function getDressesFromStorage(): Dress[] {
  migrateLegacyInventoryStorage();
  return readCollection<Dress>(INVENTORY_COLLECTION, []).map((d) => {
    const rec = d as unknown as Record<string, unknown>;
    const def = typeof rec['defaultSecurityDepositAmount'] === 'number' ? rec['defaultSecurityDepositAmount'] as number : typeof rec['depositAmount'] === 'number' ? rec['depositAmount'] as number : 0; // legacy compat
    const dep = typeof rec['depositAmount'] === 'number' ? rec['depositAmount'] as number : typeof rec['defaultSecurityDepositAmount'] === 'number' ? rec['defaultSecurityDepositAmount'] as number : 0; // legacy compat
    return {
      ...d,
      defaultSecurityDepositAmount: def,
      depositAmount: dep, // legacy compat
    };
  });
}

function saveDressesToStorage(dresses: Dress[]): void {
  migrateLegacyInventoryStorage();
  const normalized = dresses.map((d) => ({
    ...d,
    defaultSecurityDepositAmount: getDressSecurityDepositAmount(d),
    depositAmount: getDressSecurityDepositAmount(d), // legacy compat
  }));
  writeCollection<Dress>(INVENTORY_COLLECTION, normalized);
  // Best-effort Supabase sync for production
  import('../../features/sync/supabaseSync').then(({ pushDressToSupabase }) => {
      normalized.slice(-1).forEach((d) => pushDressToSupabase(d));
    }).catch(() => { /* ignore */ });
}

export function getDresses(): Dress[] {
  return getDressesFromStorage();
}

export function getDressesAsync(): Promise<Dress[]> {
  return Promise.resolve(getDressesFromStorage());
}

export function getDressByCode(code: string): Dress | undefined {
  const dresses = getDressesFromStorage();
  return dresses.find((dress) => dressMatchesBarcode(dress, code));
}

export type AddDressServiceInput = Omit<Dress, 'id' | 'code' | 'timesRented' | 'barcode'> & {
  barcode?: string;
};

function assertValidDress(input: Pick<Dress, 'name' | 'purchasePrice' | 'rentalPrice' | 'salePrice' | 'depositAmount' | 'isForRent' | 'isForSale'> & { defaultSecurityDepositAmount?: number }): void { // legacy compat
  if (!input.name.trim()) throw new Error('اسم العنصر مطلوب.');

  const rec = input as unknown as Record<string, unknown>;
  const securityDeposit = typeof rec['defaultSecurityDepositAmount'] === 'number' ? rec['defaultSecurityDepositAmount'] as number : input.depositAmount ?? 0; // legacy compat

  const moneyFields: Array<[number, string]> = [
    [input.purchasePrice, 'سعر الشراء'],
    [input.rentalPrice, 'سعر الإيجار'],
    [input.salePrice, 'سعر البيع'],
    [securityDeposit, 'مبلغ التأمين المسترد'],
  ];
  moneyFields.forEach(([value, label]) => {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${label} يجب أن يكون رقماً غير سالب.`);
    }
  });

  if (!input.isForRent && !input.isForSale) {
    throw new Error('يجب أن يكون العنصر متاحاً للبيع أو للإيجار على الأقل.');
  }
}

export function addDress(input: AddDressServiceInput): Dress {
  assertValidDress(input as unknown as Pick<Dress, 'name' | 'purchasePrice' | 'rentalPrice' | 'salePrice' | 'depositAmount' | 'isForRent' | 'isForSale'> & { defaultSecurityDepositAmount?: number }); // legacy compat
  const dresses = getDressesFromStorage();
  const code = allocateInventoryCode();

  const securityDeposit = getDressSecurityDepositAmount(input as Dress);

  const newDress: Dress = {
    ...input,
    name: input.name.trim(),
    itemType: input.itemType ?? 'dress',
    id: `dress-${generateId()}`,
    code,
    barcode: generateDressBarcodeValue(code),
    timesRented: 0,
    defaultSecurityDepositAmount: securityDeposit,
    depositAmount: securityDeposit, // legacy compat
  };

  dresses.push(newDress);
  saveDressesToStorage(dresses);
  recordAudit({
    action: 'create',
    entityType: 'dress',
    entityId: newDress.id,
    summary: `تمت إضافة العنصر ${newDress.code} إلى المخزون.`,
    nextValues: {
      code: newDress.code,
      name: newDress.name,
      status: newDress.status,
      isForRent: newDress.isForRent,
      isForSale: newDress.isForSale,
      defaultSecurityDepositAmount: securityDeposit,
    },
  });
  return newDress;
}

export function updateDress(code: string, updates: Partial<Dress>): Dress | null {
  const dresses = getDressesFromStorage();
  const index = dresses.findIndex(d => d.code === code);

  if (index === -1) return null;

  const current = dresses[index];
  const nextRaw: Dress = {
    ...current,
    ...updates,
    id: current.id,
    code: current.code,
    barcode: current.barcode,
    timesRented: current.timesRented,
  };
  const sec = getDressSecurityDepositAmount(nextRaw);
  const next: Dress = {
    ...nextRaw,
    defaultSecurityDepositAmount: sec,
    depositAmount: sec, // legacy compat
  };
  assertValidDress(next as unknown as Pick<Dress, 'name' | 'purchasePrice' | 'rentalPrice' | 'salePrice' | 'depositAmount' | 'isForRent' | 'isForSale'> & { defaultSecurityDepositAmount?: number }); // legacy compat
  dresses[index] = next;

  saveDressesToStorage(dresses);
  return dresses[index];
}

export function updateDressStatus(code: string, status: Dress['status']): Dress | null {
  return updateDress(code, { status });
}

export function markDressRented(code: string): Dress | null {
  const dresses = getDressesFromStorage();
  const index = dresses.findIndex((dress) => dress.code === code);
  if (index === -1) return null;

  const current = dresses[index];
  const updated: Dress = {
    ...current,
    status: 'rented',
    timesRented: current.timesRented + 1,
  };
  dresses[index] = updated;
  saveDressesToStorage(dresses);
  return updated;
}

export function filterDresses(filters?: Partial<DressFilters>): Dress[] {
  let dresses = getDresses();

  if (filters?.search) {
    const matchesQuery = createSearchMatcher(filters.search);
    dresses = dresses.filter((dress) =>
      matchesQuery([dress.name, dress.code, dress.barcode, dress.color, dress.size, dress.designCode]),
    );
  }

  if (filters?.status && filters.status !== 'all') {
    dresses = dresses.filter((dress) => dress.status === filters.status);
  }

  if (filters?.itemType && filters.itemType !== 'all') {
    dresses = dresses.filter((dress) => (dress.itemType ?? 'dress') === filters.itemType);
  }

  if (filters?.category && filters.category !== 'all') {
    dresses = dresses.filter((dress) => dress.category === filters.category);
  }

  if (filters?.usage === 'rent') {
    dresses = dresses.filter((dress) => dress.isForRent);
  }

  if (filters?.usage === 'sale') {
    dresses = dresses.filter((dress) => dress.isForSale);
  }

  if (filters?.designId) {
    dresses = dresses.filter((dress) => dress.designId === filters.designId);
  }

  if (filters?.size) {
    dresses = dresses.filter((dress) => dress.size === filters.size);
  }

  if (filters?.color) {
    dresses = dresses.filter((dress) => dress.color === filters.color);
  }

  return dresses;
}

export function summarizeDresses(): { total: number; available: number; rented: number; inService: number } {
  const dresses = getDresses();

  return {
    total: dresses.length,
    available: dresses.filter(d => d.status === 'available').length,
    rented: dresses.filter(d => d.status === 'rented').length,
    inService: dresses.filter(d => d.status === 'laundry' || d.status === 'maintenance').length,
  };
}

export function archiveDress(code: string): Dress | null {
  const dresses = getDressesFromStorage();
  const dress = dresses.find((item) => item.code === code);
  if (!dress) return null;

  assertDressCanBeArchived(dress.code, dress.status);
  const archived: Dress = { ...dress, status: 'inactive', archivedAt: new Date().toISOString() };
  saveDressesToStorage(dresses.map((item) => (item.code === code ? archived : item)));
  recordAudit({
    action: 'archive',
    entityType: 'dress',
    entityId: dress.id,
    summary: `تمت أرشفة العنصر ${dress.code} بدلاً من حذفه للحفاظ على تاريخه.`,
    previousValues: { status: dress.status },
    nextValues: { status: archived.status },
  });
  return archived;
}

export function restoreArchivedDress(code: string, status: Dress['status'] = 'inspection'): Dress | null {
  const dresses = getDressesFromStorage();
  const dress = dresses.find((item) => item.code === code);
  if (!dress) return null;

  const restored: Dress = { ...dress, status, archivedAt: undefined };
  saveDressesToStorage(dresses.map((item) => (item.code === code ? restored : item)));
  recordAudit({
    action: 'restore',
    entityType: 'dress',
    entityId: dress.id,
    summary: `تمت إعادة تفعيل العنصر ${dress.code} إلى حالة الفحص.`,
    previousValues: { status: dress.status },
    nextValues: { status: restored.status },
  });
  return restored;
}

export function getDressDeletionBlockers(code: string): string[] {
  const dress = getDressesFromStorage().find((item) => item.code === code);
  if (!dress) return ['العنصر غير موجود.'];
  return getDressHardDeleteBlockers(dress.code, dress.status);
}

export function deleteDress(code: string): boolean {
  const dresses = getDressesFromStorage();
  const dress = dresses.find((item) => item.code === code);
  if (!dress) return false;

  const blockers = getDressHardDeleteBlockers(dress.code, dress.status);
  if (blockers.length > 0) {
    throw new Error(`${blockers.join(' ')} استخدمي الأرشفة بدل الحذف.`);
  }

  writeCollection<RetiredCode>(RETIRED_CODES_COLLECTION, [
    ...getRetiredCodes(),
    { code: dress.code, retiredAt: new Date().toISOString() },
  ]);
  saveDressesToStorage(dresses.filter((item) => item.code !== code));
  recordAudit({
    action: 'delete',
    entityType: 'dress',
    entityId: dress.id,
    summary: `تم حذف العنصر ${dress.code} لعدم وجود أي تاريخ تشغيلي أو مالي مرتبط به.`,
    previousValues: { code: dress.code, name: dress.name, status: dress.status },
  });
  return true;
}
