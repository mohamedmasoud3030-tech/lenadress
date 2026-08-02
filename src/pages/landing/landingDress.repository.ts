import { isSupabaseConfigured } from '../../lib/supabaseClient';
import { getSupabaseConfig } from '../../config/env';
import { getDresses } from '../../features/dresses/dress.service';
import type { Dress, DressCategory, InventoryItemType } from '../../features/dresses/dress.types';
import { DRESS_CATEGORIES } from '../../shared/domain/dressConstants';

/**
 * Data source for the public /landing page's inventory section.
 *
 * The authenticated application uses a local UI cache hydrated from the
 * authoritative showroom snapshot. A public visitor cannot use that private
 * snapshot, so this page reads the narrow anonymous catalogue projection.
 *
 * Local inventory is used only by unconfigured development/test environments;
 * a configured production failure is surfaced instead of showing stale data.
 */

const KNOWN_CATEGORIES = new Set<string>(DRESS_CATEGORIES);
const KNOWN_ITEM_TYPES = new Set<InventoryItemType>(['dress', 'accessory', 'bag', 'shoe', 'veil', 'other']);

type SupabaseDressRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  category: string | null;
  color: string | null;
  size: string | null;
  rental_price: number | null;
  sale_price: number | null;
  security_deposit_amount: number | null;
  status: string;
  is_for_rent: boolean;
  is_for_sale: boolean;
  item_type: string | null;
  images: string[] | null;
};

function normalizeCategory(value: string | null): DressCategory {
  return value && KNOWN_CATEGORIES.has(value) ? (value as DressCategory) : 'أخرى';
}

function normalizeItemType(value: string | null): InventoryItemType {
  return value && KNOWN_ITEM_TYPES.has(value as InventoryItemType) ? (value as InventoryItemType) : 'dress';
}

function mapSupabaseRowToDress(row: SupabaseDressRow): Dress {
  const images = (row.images ?? []).filter((image) => typeof image === 'string');

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description ?? '',
    itemType: normalizeItemType(row.item_type),
    category: normalizeCategory(row.category),
    color: row.color ?? '',
    size: row.size ?? '',
    purchasePrice: 0,
    rentalPrice: row.rental_price ?? 0,
    salePrice: row.sale_price ?? 0,
    depositAmount: row.security_deposit_amount ?? 0, // legacy compat
    status: row.status === 'available' ? 'available' : 'inactive',
    isForRent: row.is_for_rent,
    isForSale: row.is_for_sale,
    images: [...new Set(images)],
    barcode: row.code,
    timesRented: 0,
  };
}

export class LandingInventoryError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'LandingInventoryError';
  }
}

const CATALOGUE_COLUMNS = [
  'id', 'code', 'name', 'description', 'category', 'color', 'size', 'item_type',
  'rental_price', 'sale_price', 'security_deposit_amount', 'status', 'is_for_rent',
  'is_for_sale', 'images',
].join(',');

export async function fetchAvailableDressesFromSupabase({
  getConfig = getSupabaseConfig,
  fetcher = globalThis.fetch,
}: Partial<{
  getConfig: typeof getSupabaseConfig;
  fetcher: typeof fetch;
}> = {}): Promise<Dress[]> {
  const { url, publishableKey } = getConfig();
  const endpoint = new URL('/rest/v1/catalogue_items', url);
  endpoint.searchParams.set('select', CATALOGUE_COLUMNS);
  endpoint.searchParams.set('status', 'eq.available');
  endpoint.searchParams.set('order', 'updated_at.desc');

  try {
    const response = await fetcher(endpoint, {
      headers: {
        Accept: 'application/json',
        apikey: publishableKey,
        Authorization: `Bearer ${publishableKey}`,
      },
    });
    if (!response.ok) {
      throw new Error(`Catalogue request failed with status ${response.status}.`);
    }
    const data: unknown = await response.json();
    if (!Array.isArray(data)) throw new Error('Catalogue response is not an array.');
    return (data as SupabaseDressRow[]).map(mapSupabaseRowToDress);
  } catch (error) {
    throw new LandingInventoryError('تعذر تحميل المعروض الحالي من الخادم.', error);
  }
}

function getAvailableDressesFromLocalStorage(): Dress[] {
  return getDresses().filter((dress) => dress.status === 'available');
}

export type LandingInventorySource = 'supabase' | 'local';

export type LandingInventoryResult = {
  dresses: Dress[];
  source: LandingInventorySource;
  /** Set when Supabase was configured but the request failed and we fell back locally. */
  warning?: string;
};

export type LandingInventoryDependencies = Partial<{
  isSupabaseConfigured: () => boolean;
  fetchAvailableDressesFromSupabase: () => Promise<Dress[]>;
  getAvailableDressesFromLocalStorage: () => Dress[];
}>;

/**
 * Loads the dresses the landing page should show, preferring the shared
 * Supabase backend and only touching local device storage when Supabase is
 * unavailable or unreachable.
 *
 * Dependencies are optional so the production path keeps its existing
 * behaviour while Node tests can exercise every branch without Vite env
 * mocking or a live Supabase client.
 */
export async function loadLandingInventory({
  isSupabaseConfigured: hasSupabaseConfig = isSupabaseConfigured,
  fetchAvailableDressesFromSupabase: fetchFromSupabase = fetchAvailableDressesFromSupabase,
  getAvailableDressesFromLocalStorage: readLocalInventory = getAvailableDressesFromLocalStorage,
}: LandingInventoryDependencies = {}): Promise<LandingInventoryResult> {
  if (!hasSupabaseConfig()) {
    return { dresses: readLocalInventory(), source: 'local' };
  }

  try {
    const dresses = await fetchFromSupabase();
    return { dresses, source: 'supabase' };
  } catch (error) {
    throw error instanceof LandingInventoryError
      ? error
      : new LandingInventoryError('تعذر تحميل المعروض الحالي من الخادم.', error);
  }
}
