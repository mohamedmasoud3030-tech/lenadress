import { getSupabaseClient, isSupabaseConfigured } from '../../lib/supabaseClient';
import { getDresses } from '../../features/dresses/dress.service';
import type { Dress, DressCategory, InventoryItemType } from '../../features/dresses/dress.types';
import { DRESS_CATEGORIES } from '../../shared/domain/dressConstants';

/**
 * Data source for the public /landing page's inventory section.
 *
 * The rest of the app is local-first: `getDresses()` reads from this
 * browser's `localStorage` (see @engines/persistence). That is the right
 * choice for a single-device showroom back office, but it means the public
 * landing page — meant to be opened by a customer on her own phone — showed
 * whatever (usually nothing) happened to be in *her* browser's storage
 * rather than the showroom's actual inventory.
 *
 * This repository prefers the shared Supabase `dresses` table (readable
 * anonymously for `status = 'available'` rows only, see migration
 * 0013_landing_public_read_available_dresses.sql) and falls back to the
 * local `getDresses()` behaviour when Supabase isn't configured or the
 * request fails, so the page never hard-crashes and local/demo setups keep
 * working exactly as before.
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
  deposit_amount: number | null;
  status: string;
  is_for_rent: boolean;
  is_for_sale: boolean;
  main_image_url: string | null;
  dress_images?: { image_url: string; sort_order: number | null }[] | null;
};

function normalizeCategory(value: string | null): DressCategory {
  return value && KNOWN_CATEGORIES.has(value) ? (value as DressCategory) : 'أخرى';
}

function normalizeItemType(value: string | null): InventoryItemType {
  return value && KNOWN_ITEM_TYPES.has(value as InventoryItemType) ? (value as InventoryItemType) : 'dress';
}

function mapSupabaseRowToDress(row: SupabaseDressRow): Dress {
  const galleryImages = (row.dress_images ?? [])
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((image) => image.image_url);
  const images = row.main_image_url ? [row.main_image_url, ...galleryImages] : galleryImages;

  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description ?? '',
    // The Supabase schema has no item_type column yet; every landing row is
    // treated as a plain dress until that column exists.
    itemType: normalizeItemType(null),
    category: normalizeCategory(row.category),
    color: row.color ?? '',
    size: row.size ?? '',
    purchasePrice: 0,
    rentalPrice: row.rental_price ?? 0,
    salePrice: row.sale_price ?? 0,
    depositAmount: row.deposit_amount ?? 0,
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

async function fetchAvailableDressesFromSupabase(): Promise<Dress[]> {
  const client = getSupabaseClient();
  const { data, error } = await client
    .from('dresses')
    .select('id, code, name, description, category, color, size, rental_price, sale_price, deposit_amount, status, is_for_rent, is_for_sale, main_image_url, dress_images(image_url, sort_order)')
    .eq('status', 'available')
    .order('created_at', { ascending: false });

  if (error) throw new LandingInventoryError('تعذر تحميل المعروض الحالي من الخادم.', error);
  return (data as SupabaseDressRow[] ?? []).map(mapSupabaseRowToDress);
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
    return {
      dresses: readLocalInventory(),
      source: 'local',
      warning: error instanceof Error ? error.message : 'تعذر الاتصال بالخادم، تم عرض البيانات المحلية إن وُجدت.',
    };
  }
}
