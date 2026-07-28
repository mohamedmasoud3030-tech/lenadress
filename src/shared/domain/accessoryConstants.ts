import type { AccessoryCategory, AccessoryReturnCondition, AccessoryStatus } from '../../features/accessories/accessory.types';

export const ACCESSORY_CATEGORY_LABELS = {
  veil: 'طرحة',
  crown: 'تاج',
  belt: 'حزام',
  bag: 'حقيبة',
  gloves: 'قفازات',
  jewellery: 'إكسسوارات',
  shoes: 'أحذية',
  other: 'أخرى',
} satisfies Record<AccessoryCategory, string>;

export const ACCESSORY_CATEGORY_OPTIONS: AccessoryCategory[] = [
  'veil',
  'crown',
  'belt',
  'bag',
  'gloves',
  'jewellery',
  'shoes',
  'other',
];

export const ACCESSORY_STATUS_LABELS = {
  available: 'متاح',
  reserved: 'محجوز',
  delivered: 'مسلّم',
  service: 'تنظيف أو صيانة',
  lost: 'مفقود',
  damaged: 'تالف',
  retired: 'متقاعد من المخزون',
} satisfies Record<AccessoryStatus, string>;

/** Reuses the same palette decisions as the inventory and reservation badges. */
export const ACCESSORY_STATUS_STYLES = {
  available: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  reserved: 'bg-amber-50 text-amber-700 ring-amber-200',
  delivered: 'bg-sky-50 text-sky-700 ring-sky-200',
  service: 'bg-cyan-50 text-cyan-700 ring-cyan-200',
  lost: 'bg-slate-200 text-slate-700 ring-slate-300',
  damaged: 'bg-rose-50 text-rose-700 ring-rose-200',
  retired: 'bg-slate-100 text-slate-500 ring-slate-200',
} satisfies Record<AccessoryStatus, string>;

/** States an operator may set directly when creating or editing an accessory. */
export const ACCESSORY_STATUS_OPTIONS: AccessoryStatus[] = [
  'available',
  'service',
  'lost',
  'damaged',
  'retired',
];

export const ACCESSORY_RETURN_CONDITION_OPTIONS: AccessoryReturnCondition[] = [
  'intact',
  'needs_service',
  'damaged',
  'lost',
];
