import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarSearch, CheckCircle2, Gem, Search, Shirt, TriangleAlert } from 'lucide-react';
import { PageHeader } from '../../components/shared/PageHeader';
import { Section } from '../../components/shared/Section';
import { SummaryCard } from '../../components/shared/SummaryCard';
import { EmptyState } from '../../components/shared/StateViews';
import { FilterBar, SearchFilter, SelectFilter } from '../../components/shared/FilterBar';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';
import { ViewModeToggle, useViewMode } from '../../components/shared/ViewModeToggle';
import { AMBER_FOCUS_RING_CLASS_NAME, FORM_FIELD_CLASS_NAME } from '../../shared/domain/formConstants';
import { DRESS_CATEGORIES } from '../../shared/domain/dressConstants';
import { addDaysISO, getTodayISO } from '../../shared/utils/date';
import { formatMoneyOMR } from '../../shared/utils/format';
import { searchAvailabilityWithAccessories } from './availability.service';
import type { AvailabilitySearchResult, UnavailabilityReason } from './availability.types';
import type { DressCategory } from '../dresses/dress.types';

/**
 * "What is free on this date?" — the question the showroom is actually asked.
 *
 * The page leads with the period rather than the item, because that is the
 * order the conversation happens in: the customer states her wedding date
 * first and the garment second. Every other screen in the app works the other
 * way round, which forced the operator to guess an item and back out of a
 * conflict in front of the customer.
 */

const REASON_LABELS: Record<UnavailabilityReason, string> = {
  booked: 'محجوز في هذه الفترة',
  not_for_rent: 'غير معروض للإيجار',
  damaged: 'تالف',
  sold: 'مباع',
  in_service: 'في الخدمة (فحص / مغسلة / تعديل)',
  archived: 'مؤرشف',
};

const REASON_STYLES: Record<UnavailabilityReason, string> = {
  booked: 'bg-amber-50 text-amber-800 ring-amber-200',
  not_for_rent: 'bg-slate-100 text-slate-600 ring-slate-200',
  damaged: 'bg-rose-50 text-rose-800 ring-rose-200',
  sold: 'bg-slate-100 text-slate-600 ring-slate-200',
  in_service: 'bg-sky-50 text-sky-800 ring-sky-200',
  archived: 'bg-slate-100 text-slate-500 ring-slate-200',
};

const categoryOptions: Array<{ value: DressCategory | 'all'; label: string }> = [
  { value: 'all', label: 'كل الأقسام' },
  ...DRESS_CATEGORIES.map((category) => ({ value: category, label: category })),
];

const availabilityOptions = [
  { value: 'available', label: 'المتاح فقط' },
  { value: 'all', label: 'الكل مع سبب عدم التوفر' },
] as const;

type AvailabilityScope = (typeof availabilityOptions)[number]['value'];

export function AvailabilitySearchPage() {
  // Defaults describe the most common question: a booking a week out, kept for
  // two nights. Starting from today would offer pieces still in the laundry.
  const [pickupDate, setPickupDate] = useState(() => addDaysISO(getTodayISO(), 7));
  const [returnDate, setReturnDate] = useState(() => addDaysISO(getTodayISO(), 9));
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<DressCategory | 'all'>('all');
  const [size, setSize] = useState('');
  const [color, setColor] = useState('');
  const [maxRentalPrice, setMaxRentalPrice] = useState('');
  const [scope, setScope] = useState<AvailabilityScope>('available');
  const [viewMode, setViewMode] = useViewMode('availability', 'list');

  const { result, error } = useMemo((): { result: AvailabilitySearchResult | null; error: unknown } => {
    try {
      const parsedMax = Number.parseFloat(maxRentalPrice);
      return {
        result: searchAvailabilityWithAccessories({
          pickupDate,
          returnDate,
          search: search.trim() || undefined,
          category,
          size: size.trim() || undefined,
          color: color.trim() || undefined,
          maxRentalPrice: Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : undefined,
          includeUnavailable: scope === 'all',
        }, { search: search.trim() || undefined }),
        error: null,
      };
    } catch (caught) {
      return { result: null, error: caught };
    }
  }, [pickupDate, returnDate, search, category, size, color, maxRentalPrice, scope]);

  const summary = result?.summary;

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          eyebrow="البحث بالتاريخ"
          title="المتاح في فترة"
        />
        <ViewModeToggle mode={viewMode} onChange={setViewMode} />
      </div>

      {error !== null && <UserFacingErrorAlert error={error} fallback="تعذر تنفيذ البحث." />}

      <Section title="فترة المناسبة" description="الاستلام والإرجاع بالتوقيت المحلي. الفترة المحجوبة تشمل أيام التجهيز والتنظيف المعرّفة في الإعدادات.">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="block min-w-0">
            <span className="mb-1.5 block text-sm font-bold text-slate-700">تاريخ الاستلام</span>
            <input
              type="date"
              value={pickupDate}
              onChange={(event) => setPickupDate(event.target.value)}
              className={FORM_FIELD_CLASS_NAME}
            />
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-sm font-bold text-slate-700">تاريخ الإرجاع</span>
            <input
              type="date"
              value={returnDate}
              min={pickupDate}
              onChange={(event) => setReturnDate(event.target.value)}
              className={FORM_FIELD_CLASS_NAME}
            />
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-sm font-bold text-slate-700">المقاس</span>
            <input
              type="text"
              value={size}
              onChange={(event) => setSize(event.target.value)}
              placeholder="مثال: 42"
              inputMode="numeric"
              className={FORM_FIELD_CLASS_NAME}
            />
          </label>
          <label className="block min-w-0">
            <span className="mb-1.5 block text-sm font-bold text-slate-700">اللون</span>
            <input
              type="text"
              value={color}
              onChange={(event) => setColor(event.target.value)}
              placeholder="مثال: أبيض"
              className={FORM_FIELD_CLASS_NAME}
            />
          </label>
        </div>
        {result && (
          <p className="mt-3 text-xs font-bold text-slate-600">
            مدة الإيجار: {result.durationDays} ليلة
          </p>
        )}
      </Section>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <SummaryCard
          label="فساتين متاحة"
          value={summary?.availableItems ?? 0}
          tone={(summary?.availableItems ?? 0) > 0 ? 'positive' : 'warning'}
          hint="جاهزة للحجز في هذه الفترة"
        />
        <SummaryCard label="غير متاحة" value={summary?.busyItems ?? 0} hint="محجوزة أو في الخدمة" />
        <SummaryCard label="ملحقات متاحة" value={summary?.availableAccessories ?? 0} tone="accent" />
        <SummaryCard
          label="المقاسات المتوفرة"
          value={summary?.sizes.length ? summary.sizes.join('، ') : '—'}
          hint={summary?.colors.length ? summary.colors.slice(0, 4).join('، ') : 'لا ألوان متاحة'}
        />
      </div>

      <FilterBar>
        <SearchFilter
          label="البحث في القطع المتاحة"
          value={search}
          onChange={setSearch}
          placeholder="ابحثي بالاسم أو الكود أو التصميم"
        />
        <SelectFilter label="القسم" value={category} onChange={setCategory} options={categoryOptions} />
        <SelectFilter label="نطاق النتائج" value={scope} onChange={setScope} options={availabilityOptions} />
        <label className="block min-w-0">
          <span className="sr-only">أقصى سعر إيجار</span>
          <input
            type="number"
            min={0}
            step="0.001"
            inputMode="decimal"
            value={maxRentalPrice}
            onChange={(event) => setMaxRentalPrice(event.target.value)}
            placeholder="أقصى سعر إيجار"
            aria-label="أقصى سعر إيجار"
            className="min-h-11 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-sm text-slate-950 outline-none transition focus-visible:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500/30"
          />
        </label>
      </FilterBar>

      {!result || result.items.length === 0 ? (
        <EmptyState
          icon={<CalendarSearch className="h-10 w-10" />}
          title="لا توجد قطع مطابقة لهذه الفترة"
          description="جرّبي توسيع الفترة أو إزالة فلتر المقاس أو اللون، أو اعرضي الكل لمعرفة سبب عدم التوفر واقتراح أقرب تاريخ بديل."
          action={
            <Link
              to="/waitlist"
              className={`inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 transition hover:bg-stone-100 ${AMBER_FOCUS_RING_CLASS_NAME}`}
            >
              إضافتها لقائمة الانتظار
            </Link>
          }
        />
      ) : (
        <Section title={`النتائج (${result.items.length})`} description="المتاح أولاً، ثم الأقل سعراً.">
          <ul className={viewMode === 'grid' ? 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3' : 'space-y-2'}>
            {result.items.map((item) => (
              <li
                key={item.dress.id}
                className={`min-w-0 rounded-xl border p-3 ${item.available ? 'border-emerald-200 bg-emerald-50/40' : 'border-slate-200 bg-white'}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-950">{item.dress.name}</p>
                    <p className="mt-0.5 truncate text-xs text-slate-600">
                      {item.dress.code} · مقاس {item.dress.size || '—'} · {item.dress.color || '—'}
                    </p>
                    <p className="mt-0.5 text-xs font-bold text-slate-700">{formatMoneyOMR(item.dress.rentalPrice)}</p>
                  </div>
                  {item.available ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800 ring-1 ring-emerald-200">
                      <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5" />
                      متاح
                    </span>
                  ) : (
                    <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ring-1 ${REASON_STYLES[item.reason ?? 'booked']}`}>
                      <TriangleAlert aria-hidden="true" className="h-3.5 w-3.5" />
                      {REASON_LABELS[item.reason ?? 'booked']}
                    </span>
                  )}
                </div>

                {!item.available && item.conflicts.length > 0 && (
                  <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
                    محجوز ضمن {item.conflicts.map((conflict) => conflict.reservationNumber).join('، ')}
                    {' '}({item.conflicts[0].pickupDate} → {item.conflicts[0].returnDate})
                  </p>
                )}

                {/* A date the operator can offer instead of a bare "no". */}
                {item.nextFreeDate && (
                  <p className="mt-1.5 text-xs font-bold text-sky-800">
                    أقرب تاريخ متاح لنفس المدة: {item.nextFreeDate}
                  </p>
                )}

                {item.alternativePieceCodes.length > 0 && (
                  <p className="mt-1.5 text-xs text-slate-600">
                    بدائل من نفس التصميم: {item.alternativePieceCodes.join('، ')}
                  </p>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  <Link
                    to={`/inventory/${item.dress.code}`}
                    className={`inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 transition hover:bg-stone-100 ${AMBER_FOCUS_RING_CLASS_NAME}`}
                  >
                    <Shirt aria-hidden="true" className="h-4 w-4" />
                    تفاصيل القطعة
                  </Link>
                  {item.available && (
                    <Link
                      to={`/reservations?new=1&dress=${encodeURIComponent(item.dress.code)}&pickup=${result.period.pickupDate}&return=${result.period.returnDate}`}
                      className={`inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-3 text-sm font-bold text-white transition hover:bg-slate-800 ${AMBER_FOCUS_RING_CLASS_NAME}`}
                    >
                      <Search aria-hidden="true" className="h-4 w-4" />
                      احجزيها
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {result && result.accessories.length > 0 && (
        <Section title={`الملحقات المتاحة (${result.accessories.length})`} description="متاحة لنفس الفترة، بعد احتساب ارتباطها بحجوزات أخرى.">
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {result.accessories.map((entry) => (
              <li key={entry.accessory.id} className="min-w-0 rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold text-slate-950">{entry.accessory.name}</p>
                    <p className="mt-0.5 truncate text-xs text-slate-600">{entry.accessory.code}</p>
                  </div>
                  {entry.available ? (
                    <Gem aria-hidden="true" className="h-4 w-4 shrink-0 text-violet-600" />
                  ) : (
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ring-1 ${REASON_STYLES[entry.reason ?? 'booked']}`}>
                      {REASON_LABELS[entry.reason ?? 'booked']}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
