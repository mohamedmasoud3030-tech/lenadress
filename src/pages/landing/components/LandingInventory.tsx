import { Filter, HeartHandshake, Search } from 'lucide-react';
import type { Dress } from '../../../features/dresses/dress.types';
import { INVENTORY_ITEM_TYPE_LABELS } from '../../../shared/domain/dressConstants';
import { formatMoneyOMR } from '../../../shared/utils/format';
import { buildAppointmentInquiryMessage, buildLandingWhatsAppLink, buildQuickInquiryMessage } from '../landingWhatsapp';
import type { InventoryCategoryFilter, LandingProfile, LandingUsageFilter } from './types';

function getLandingDressPriceLabel(dress: Dress): string {
  if (dress.isForRent && dress.isForSale) return `إيجار ${formatMoneyOMR(dress.rentalPrice)} • بيع ${formatMoneyOMR(dress.salePrice)}`;
  if (dress.isForRent) return `إيجار ${formatMoneyOMR(dress.rentalPrice)}`;
  if (dress.isForSale) return `بيع ${formatMoneyOMR(dress.salePrice)}`;
  return 'السعر يحدد عند المعاينة';
}

type Props = { profile: LandingProfile; dresses: Dress[]; loading: boolean; loadError?: string | null; search: string; onSearchChange: (value: string) => void; selectedCategory: InventoryCategoryFilter; onCategoryChange: (value: InventoryCategoryFilter) => void; usageFilter: LandingUsageFilter; onUsageChange: (value: LandingUsageFilter) => void; inventoryCategories: readonly InventoryCategoryFilter[]; };

function InventoryCard({ dress, profile }: { dress: Dress; profile: LandingProfile }) {
  const primaryImage = dress.images[0];
  const typeLabel = INVENTORY_ITEM_TYPE_LABELS[dress.itemType ?? 'dress'];
  const appointmentLink = buildLandingWhatsAppLink(profile, buildAppointmentInquiryMessage(dress.name));
  const inquiryLink = buildLandingWhatsAppLink(profile, buildQuickInquiryMessage(dress.name));

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md">
      {primaryImage ? (
        <img src={primaryImage} alt={dress.name} className="h-48 sm:h-64 md:h-72 w-full object-cover" loading="lazy" />
      ) : (
        <div className="flex h-48 sm:h-64 md:h-72 items-center justify-center bg-gradient-to-br from-violet-100 via-white to-amber-50">
          <p className="text-sm font-medium text-slate-500">لا توجد صورة متاحة حالياً</p>
        </div>
      )}
      <div className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-violet-700">{typeLabel} • {dress.category}</p>
            <h3 className="mt-1 text-lg font-black text-slate-950">{dress.name}</h3>
            <p className="mt-1 text-sm leading-6 text-slate-500">{dress.description || 'قطعة متاحة حالياً ويمكن معاينتها وتجربتها خلال الموعد داخل المعرض.'}</p>
          </div>
          <span className="shrink-0 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200">متاح</span>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-xl bg-stone-50 p-3">
            <p className="text-slate-400">المقاس</p>
            <p className="mt-1 font-bold text-slate-900" dir="ltr">{dress.size}</p>
          </div>
          <div className="rounded-xl bg-stone-50 p-3">
            <p className="text-slate-400">اللون</p>
            <p className="mt-1 font-bold text-slate-900">{dress.color}</p>
          </div>
        </div>
        <div className="rounded-xl border border-slate-100 bg-white p-4">
          <p className="text-xs font-semibold text-slate-400">السعر</p>
          <p className="mt-2 text-sm font-bold text-slate-900">{getLandingDressPriceLabel(dress)}</p>
          {dress.isForRent && dress.depositAmount > 0 && <p className="mt-2 text-xs text-slate-500">التأمين: {formatMoneyOMR(dress.depositAmount)}</p>} {/* legacy compat */}
        </div>
        <div className="flex flex-wrap gap-2">
          {dress.isForRent && <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700">للإيجار</span>}
          {dress.isForSale && <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">للبيع</span>}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <a href={appointmentLink} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-4 py-3 text-sm font-bold text-white transition hover:bg-slate-800">حجز موعد للتجربة</a>
          <a href={inquiryLink} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-bold text-slate-700 transition hover:bg-stone-100">استفسار سريع</a>
        </div>
      </div>
    </article>
  );
}

export function LandingInventory({ profile, dresses, loading, loadError, search, onSearchChange, selectedCategory, onCategoryChange, usageFilter, onUsageChange, inventoryCategories }: Props) {
  const groupedByType = dresses.reduce<Record<string, Dress[]>>((acc, dress) => {
    const type = dress.itemType ?? 'dress';
    if (!acc[type]) acc[type] = [];
    acc[type].push(dress);
    return acc;
  }, {});

  const typeEntries = Object.entries(groupedByType);
  const headerAppointmentLink = buildLandingWhatsAppLink(profile, buildAppointmentInquiryMessage());
  const emptyStateAppointmentLink = buildLandingWhatsAppLink(profile, buildQuickInquiryMessage());

  return (
    <section id="available-dresses" className="mt-12 space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-bold text-violet-700">المعروض الحالي من المخزون</p>
          <h2 className="mt-1 text-2xl font-black text-slate-950">العناصر المتاحة الآن</h2>
          <p className="mt-2 text-sm leading-6 text-slate-600">هذا القسم متصل بالبيانات الفعلية المتاحة، ويعرض كل أنواع المخزون: الفساتين، الإكسسوارات، الحقائب، الأحذية، الطرح والشالات، وغيرها.</p>
        </div>
        <a href={headerAppointmentLink} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-stone-100">
          <HeartHandshake className="h-4 w-4" />
          حجز موعد عبر واتساب
        </a>
      </div>

      {loadError && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {loadError}
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[1fr_190px_190px]">
          <label className="relative block">
            <span className="sr-only">ابحثي في المخزون</span>
            <Search className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input type="search" value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="ابحثي بالاسم أو الفئة أو اللون أو المقاس" className="h-12 w-full rounded-xl border border-slate-200 bg-stone-50 pr-11 text-sm outline-none transition focus-visible:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500/30" />
          </label>
          <label>
            <span className="sr-only">فلتر الفئة</span>
            <div className="relative">
              <Filter className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <select value={selectedCategory} onChange={(event) => onCategoryChange(event.target.value as InventoryCategoryFilter)} className="h-12 w-full rounded-xl border border-slate-200 bg-stone-50 px-10 text-sm outline-none transition focus-visible:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500/30">
                {inventoryCategories.map((category) => <option key={category} value={category}>{category === 'all' ? 'كل الفئات' : category}</option>)}
              </select>
            </div>
          </label>
          <label>
            <span className="sr-only">فلتر الخدمة</span>
            <select value={usageFilter} onChange={(event) => onUsageChange(event.target.value as LandingUsageFilter)} className="h-12 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-sm outline-none transition focus-visible:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500/30">
              <option value="all">إيجار وبيع</option>
              <option value="rent">للإيجار فقط</option>
              <option value="sale">للبيع فقط</option>
            </select>
          </label>
        </div>
      </div>

      {loading ? (
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <div key={index} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="h-72 animate-pulse bg-stone-100" />
              <div className="space-y-3 p-5">
                <div className="h-5 animate-pulse rounded bg-stone-100" />
                <div className="h-4 w-2/3 animate-pulse rounded bg-stone-100" />
                <div className="h-4 w-1/2 animate-pulse rounded bg-stone-100" />
              </div>
            </div>
          ))}
        </div>
      ) : dresses.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center shadow-sm">
          <p className="text-lg font-semibold text-slate-900">لا توجد عناصر مطابقة حالياً</p>
          <p className="mt-2 text-sm text-slate-500">جرّبي تغيير البحث أو الفلاتر، أو انتقلي لحجز موعد للاستفسار عن المتاح من بقية الفئات والخدمات.</p>
          <a href={emptyStateAppointmentLink} target="_blank" rel="noopener noreferrer" className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-slate-800">حجز موعد للاستفسار</a>
        </div>
      ) : typeEntries.length === 1 ? (
        <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {typeEntries[0][1].map((dress) => <InventoryCard key={dress.id} dress={dress} profile={profile} />)}
        </div>
      ) : (
        <div className="space-y-10">
          {typeEntries.map(([type, items]) => (
            <div key={type}>
              <div className="mb-4 flex items-center gap-3">
                <span className="rounded-full bg-violet-100 px-4 py-2 text-sm font-bold text-violet-800">{INVENTORY_ITEM_TYPE_LABELS[type as keyof typeof INVENTORY_ITEM_TYPE_LABELS] ?? type}</span>
                <span className="text-sm text-slate-500">{items.length} عنصر</span>
              </div>
              <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((dress) => <InventoryCard key={dress.id} dress={dress} profile={profile} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
