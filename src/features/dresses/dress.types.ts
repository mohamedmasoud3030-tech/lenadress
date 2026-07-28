export type DressStatus =
  | 'available'
  | 'reserved'
  | 'rented'
  | 'inspection'
  | 'laundry'
  | 'maintenance'
  | 'damaged'
  | 'sold'
  | 'inactive';

export type InventoryItemType = 'dress' | 'accessory' | 'bag' | 'shoe' | 'veil' | 'other';

export type DressCategory = 'زفاف' | 'خطوبة' | 'سهرة' | 'أطفال' | 'إكسسوارات' | 'حقائب' | 'أحذية' | 'طرح وشالات' | 'أخرى';

export type Dress = {
  id: string;
  code: string;
  name: string;
  description: string;
  itemType?: InventoryItemType;
  category: DressCategory;
  color: string;
  size: string;
  purchasePrice: number;
  rentalPrice: number;
  salePrice: number;
  depositAmount: number;
  status: DressStatus;
  isForRent: boolean;
  isForSale: boolean;
  images: string[];
  barcode: string;
  timesRented: number;
  /** Set when the item is archived instead of deleted; history stays intact. */
  archivedAt?: string;
  notes?: string;
};

export type AddDressInput = Omit<Dress, 'id' | 'code' | 'timesRented'>;

export type DressFilters = {
  search: string;
  status: 'all' | DressStatus;
  itemType: 'all' | InventoryItemType;
  category: 'all' | DressCategory;
  usage: 'all' | 'rent' | 'sale';
};

export type DressSummary = {
  total: number;
  available: number;
  rented: number;
  inService: number;
};
