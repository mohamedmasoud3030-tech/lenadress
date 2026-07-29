import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Banknote, Barcode, Layers, Plus, Search, Shirt } from 'lucide-react';
import { PageHeader } from '../../components/shared/PageHeader';
import { SummaryCard } from '../../components/shared/SummaryCard';
import { DRESS_CATEGORIES, DRESS_STATUS_LABELS, DRESS_STATUS_OPTIONS, DRESS_STATUS_STYLES, INVENTORY_ITEM_TYPE_LABELS, INVENTORY_ITEM_TYPE_OPTIONS } from '../../shared/domain/dressConstants';
import { formatMoneyOMR } from '../../shared/utils/format';
import { AddDressModal } from './AddDressModal';
import { filterDresses, getDressByCode, getDresses, getDressesAsync, summarizeDresses } from './dress.service';
import { SellDressModal } from './SellDressModal';
import { AddDesignModal } from './AddDesignModal';
import { summarizeAllDesigns } from './design.service';
import { EmptyState, LoadingState } from '../../components/shared/StateViews';
import { ViewModeToggle, useViewMode } from '../../components/shared/ViewModeToggle';
import { AMBER_FOCUS_RING_CLASS_NAME } from '../../shared/domain/formConstants';
import type { DressDesign } from './design.types';
import type { SaleInvoice } from './salesLedger.service';
import type { Dress, DressFilters } from './dress.types';

const categories = ['all', ...DRESS_CATEGORIES] as const;
const statuses = ['all', ...DRESS_STATUS_OPTIONS] as const;
const itemTypes = ['all', ...INVENTORY_ITEM_TYPE_OPTIONS] as const;
const BarcodeScanner = lazy(async () => {
  const module = await import('./BarcodeScanner');
  return { default: module.BarcodeScanner };
});

function DressCard({ dress }: { dress: Dress }) {
  const primaryImage = dress.images[0];

  return (
    <article className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md">
      {primaryImage ? (
        <img
          src={primaryImage}
          alt={dress.name}
          className="h-40 sm:h-48 w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="flex h-40 sm:h-48 items-center justify-center bg-gradient-to-br from-violet-100 via-white to-amber-50">
          <div className="rounded-full bg-white/80 p-5 sm:p-6 shadow-sm ring-1 ring-slate-200">
            <Shirt aria-hidden="true" className="h-10 w-10 sm:h-12 sm:w-12 text-violet-700" />
          </div>
        </div>
      )}
      <div className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-slate-400" dir="ltr">{dress.code}</p>
            <h2 className="mt-1 text-lg font-bold text-slate-950">{dress.name}</h2>
            <p className="mt-1 text-xs font-bold text-violet-700">{INVENTORY_ITEM_TYPE_LABELS[dress.itemType ?? 'dress']}</p>
            {dress.description && <p className="mt-1 text-sm leading-6 text-slate-500">{dress.description}</p>}
          </div>
          <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ring-1 ${DRESS_STATUS_STYLES[dress.status]}`}>
            {DRESS_STATUS_LABELS[dress.status]}
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="rounded-xl bg-stone-50 p-3">
            <p className="text-slate-400">اللون</p>
            <p className="font-semibold text-slate-900">{dress.color}</p>
          </div>
          <div className="rounded-xl bg-stone-50 p-3">
            <p className="text-slate-400">المقاس</p>
            <p className="font-semibold text-slate-900" dir="ltr">{dress.size}</p>
          </div>
          <div className="rounded-xl bg-stone-50 p-3">
            <p className="text-slate-400">الفئة</p>
            <p className="font-semibold text-slate-900">{dress.category}</p>
          </div>
        </div>

        <div className="grid gap-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-2">
          {dress.isForRent && (
            <>
              <div>
                <p className="text-slate-400">سعر الإيجار</p>
                <p className="font-bold text-slate-950">{formatMoneyOMR(dress.rentalPrice)}</p>
              </div>
              <div>
                <p className="text-slate-400">التأمين</p>
                <p className="font-bold text-slate-950">{formatMoneyOMR(dress.depositAmount)}</p>
              </div>
            </>
          )}
          {dress.isForSale && (
            <div>
              <p className="text-slate-400">سعر البيع</p>
              <p className="font-bold text-slate-950">{formatMoneyOMR(dress.salePrice)}</p>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {dress.isForRent && <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700">للإيجار</span>}
          {dress.isForSale && <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">للبيع</span>}
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">تأجر {dress.timesRented} مرات</span>
        </div>
      </div>
    </article>
  );
}

/** Compact row: scanning forty codes should not mean scrolling forty photos. */
function DressRow({ dress, highlighted }: { dress: Dress; highlighted: boolean }) {
  return (
    <Link
      to={`/inventory/${dress.code}`}
      className={`flex items-center gap-3 rounded-xl border bg-white p-3 transition hover:bg-stone-50 ${AMBER_FOCUS_RING_CLASS_NAME} ${
        highlighted ? 'border-amber-400 ring-2 ring-amber-300' : 'border-slate-200'
      }`}
    >
      {dress.images[0] ? (
        <img src={dress.images[0]} alt="" aria-hidden="true" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
      ) : (
        <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-violet-50 text-violet-700">
          <Shirt className="h-5 w-5" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold text-slate-900">{dress.name}</span>
        <span className="block truncate text-xs text-slate-500">
          <span dir="ltr">{dress.code}</span> · {dress.size} · {dress.color}
          {dress.designCode ? <> · <span dir="ltr">{dress.designCode}</span></> : null}
        </span>
      </span>
      <span className="shrink-0 text-left">
        <span className={`block rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ${DRESS_STATUS_STYLES[dress.status]}`}>
          {DRESS_STATUS_LABELS[dress.status]}
        </span>
        <span className="mt-1 block text-xs font-bold text-slate-700">{formatMoneyOMR(dress.rentalPrice)}</span>
      </span>
    </Link>
  );
}

/** One design with its stocked sizes and colours. */
function DesignCard({ summary }: { summary: ReturnType<typeof summarizeAllDesigns>[number] }) {
  return (
    <article className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-400" dir="ltr">{summary.design.code}</p>
          <h3 className="mt-0.5 truncate text-base font-bold text-slate-950">{summary.design.name}</h3>
          <p className="mt-0.5 text-xs text-slate-500">{summary.design.category}</p>
        </div>
        <span className="shrink-0 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-800 ring-1 ring-emerald-200">
          {summary.availableCount} / {summary.pieceCount} متاحة
        </span>
      </div>

      {summary.variants.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label={`المقاسات والألوان المتوفرة من ${summary.design.name}`}>
          {summary.variants.map((variant) => (
            <li
              key={`${variant.size}-${variant.color}`}
              className={`rounded-full px-2.5 py-1 text-[11px] font-bold ring-1 ${
                variant.available > 0
                  ? 'bg-stone-50 text-slate-700 ring-slate-200'
                  : 'bg-slate-100 text-slate-400 ring-slate-200'
              }`}
            >
              {variant.size} · {variant.color} — {variant.available}/{variant.total}
            </li>
          ))}
        </ul>
      )}

      <Link
        to={`/designs/${encodeURIComponent(summary.design.code)}`}
        className={`mt-3 inline-flex min-h-10 items-center rounded-xl border border-slate-300 px-3 text-xs font-bold text-slate-700 transition hover:bg-stone-100 ${AMBER_FOCUS_RING_CLASS_NAME}`}
      >
        فتح التصميم
      </Link>
    </article>
  );
}

export function DressesPage() {
  const [dresses, setDresses] = useState<Dress[]>(() => getDresses());
  // `?design=` lets a design card link straight to its own pieces.
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState<DressFilters>(() => ({
    search: '',
    status: 'all',
    itemType: 'all',
    category: 'all',
    usage: 'all',
    designId: searchParams.get('design') ?? undefined,
  }));
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showDesignModal, setShowDesignModal] = useState(false);
  const [groupByDesign, setGroupByDesign] = useState(false);
  const [viewMode, setViewMode] = useViewMode('inventory');
  const [showSaleModal, setShowSaleModal] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [highlightedDressCode, setHighlightedDressCode] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getDressesAsync().then((data) => {
      if (!cancelled) {
        setDresses(data);
        setLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  const filteredDresses = useMemo(() => filterDresses(filters), [dresses, filters]);
  const designSummaries = useMemo(() => summarizeAllDesigns(), [dresses]);
  const summary = useMemo(() => summarizeDresses(), [dresses]);

  const handleCreated = (dress: Dress) => {
    setDresses((current) => [dress, ...current]);
    setFeedback(`تمت إضافة العنصر ${dress.code} بنجاح.`);
  };

  const handleDesignCreated = (design: DressDesign, pieces: number) => {
    setDresses(getDresses());
    setGroupByDesign(true);
    setFeedback(`تمت إضافة التصميم ${design.code} بعدد ${pieces} قطعة.`);
  };

  const handleSold = (invoice: SaleInvoice) => {
    setDresses(getDresses());
    const soldCode = invoice.lines[0]?.dressCode ?? '';
    setHighlightedDressCode(soldCode);
    setFeedback(`تم تسجيل الفاتورة ${invoice.invoiceNumber} للعنصر ${soldCode}.`);
  };

  const handleBarcodeScan = (barcode: string) => {
    const normalizedBarcode = barcode.trim();
    const matchedDress = dresses.find((dress) => dress.barcode === normalizedBarcode)
      ?? getDressByCode(normalizedBarcode);

    setShowScanner(false);

    if (!matchedDress) {
      setHighlightedDressCode(null);
      setFeedback(`لم يتم العثور على عنصر مرتبط بالباركود ${normalizedBarcode}.`);
      return;
    }

    setHighlightedDressCode(matchedDress.code);
    setFilters((current) => ({ ...current, search: matchedDress.code }));
    setFeedback(`تم العثور على العنصر ${matchedDress.name} (${matchedDress.code}).`);
  };

  // Auto-dismiss feedback after 5 seconds
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(null), 5000);
    return () => clearTimeout(timer);
  }, [feedback]);

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <PageHeader
          eyebrow="المخزون"
          title="المخزون"
          description="إدارة الفساتين والحقائب والإكسسوارات وباقي عناصر المعرض من سجل واحد واضح."
        />
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => {
              setFeedback(null);
              setHighlightedDressCode(null);
              setShowScanner(true);
            }}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-800 shadow-sm transition hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
          >
            <Barcode aria-hidden="true" className="h-5 w-5" />
            مسح باركود
          </button>
          <button
            type="button"
            onClick={() => {
              setFeedback(null);
              setShowSaleModal(true);
            }}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-800 shadow-sm transition hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
          >
            <Banknote aria-hidden="true" className="h-5 w-5" />
            بيع عنصر
          </button>
          <button
            type="button"
            onClick={() => {
              setFeedback(null);
              setShowCreateModal(true);
            }}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
          >
            <Plus aria-hidden="true" className="h-5 w-5" />
            إضافة عنصر مخزون
          </button>
          <button
            type="button"
            onClick={() => { setFeedback(null); setShowDesignModal(true); }}
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-700 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-violet-800 ${AMBER_FOCUS_RING_CLASS_NAME}`}
          >
            <Layers aria-hidden="true" className="h-5 w-5" />
            تصميم بمقاسات وألوان
          </button>
        </div>
      </div>

      {feedback && (
        <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
          {feedback}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <SummaryCard label="إجمالي المخزون" value={summary.total} />
        <SummaryCard label="متاحة الآن" value={summary.available} tone="positive" />
        <SummaryCard label="مؤجرة حالياً" value={summary.rented} />
        <SummaryCard label="مغسلة أو تعديل" value={summary.inService} tone={summary.inService > 0 ? 'warning' : 'default'} />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_180px_180px_180px_180px]">
          <label className="relative block">
            <span className="sr-only">البحث في المخزون</span>
            <Search aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={filters.search}
              onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
              placeholder="ابحثي بالكود أو الاسم أو اللون أو المقاس"
              className="h-12 w-full rounded-xl border border-slate-200 bg-stone-50 pr-11 text-sm outline-none transition focus-visible:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500/30"
            />
          </label>

          <label>
            <span className="sr-only">حالة العنصر</span>
            <select
              value={filters.status}
              onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as DressFilters['status'] }))}
              className="h-12 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-sm outline-none transition focus-visible:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500/30"
            >
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {status === 'all' ? 'كل الحالات' : DRESS_STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="sr-only">نوع العنصر</span>
            <select
              value={filters.itemType}
              onChange={(event) => setFilters((current) => ({ ...current, itemType: event.target.value as DressFilters['itemType'] }))}
              className="h-12 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-sm outline-none transition focus-visible:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500/30"
            >
              {itemTypes.map((itemType) => (
                <option key={itemType} value={itemType}>
                  {itemType === 'all' ? 'كل الأنواع' : INVENTORY_ITEM_TYPE_LABELS[itemType as Exclude<typeof itemType, 'all'>]}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="sr-only">فئة العنصر</span>
            <select
              value={filters.category}
              onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value as DressFilters['category'] }))}
              className="h-12 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-sm outline-none transition focus-visible:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500/30"
            >
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category === 'all' ? 'كل الفئات' : category}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="sr-only">نوع الاستخدام</span>
            <select
              value={filters.usage}
              onChange={(event) => setFilters((current) => ({ ...current, usage: event.target.value as DressFilters['usage'] }))}
              className="h-12 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-sm outline-none transition focus-visible:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500/30"
            >
              <option value="all">كل الاستخدامات</option>
              <option value="rent">للإيجار</option>
              <option value="sale">للبيع</option>
            </select>
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="تجميع العرض" className="inline-flex rounded-xl border border-slate-300 bg-white p-1 text-xs font-bold">
          <button
            type="button"
            aria-pressed={!groupByDesign}
            onClick={() => setGroupByDesign(false)}
            className={`min-h-10 rounded-lg px-3 transition ${AMBER_FOCUS_RING_CLASS_NAME} ${!groupByDesign ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-stone-100'}`}
          >
            كل القطع ({filteredDresses.length})
          </button>
          <button
            type="button"
            aria-pressed={groupByDesign}
            onClick={() => setGroupByDesign(true)}
            className={`min-h-10 rounded-lg px-3 transition ${AMBER_FOCUS_RING_CLASS_NAME} ${groupByDesign ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-stone-100'}`}
          >
            حسب التصميم ({designSummaries.length})
          </button>
        </div>
        {!groupByDesign && <ViewModeToggle mode={viewMode} onChange={setViewMode} />}
      </div>

      {loading ? (
        <LoadingState label="جاري تحميل المخزون…" />
      ) : groupByDesign ? (
        designSummaries.length > 0 ? (
          <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {designSummaries.map((summary) => <DesignCard key={summary.design.id} summary={summary} />)}
          </div>
        ) : (
          <EmptyState
            icon={<Layers className="h-10 w-10" />}
            title="لا توجد تصاميم بعد"
            description="أنشئي تصميماً واحداً بعدة مقاسات وألوان بدلاً من إضافة كل قطعة على حدة."
            action={
              <button
                type="button"
                onClick={() => setShowDesignModal(true)}
                className={`inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white ${AMBER_FOCUS_RING_CLASS_NAME}`}
              >
                <Layers aria-hidden="true" className="h-4 w-4" />
                إضافة أول تصميم
              </button>
            }
          />
        )
      ) : filteredDresses.length > 0 ? (
        viewMode === 'grid' ? (
          <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
            {filteredDresses.map((dress) => (
              <Link
                key={dress.id}
                to={`/inventory/${dress.code}`}
                className={highlightedDressCode === dress.code ? 'block rounded-3xl ring-2 ring-amber-400 ring-offset-4 ring-offset-slate-50' : 'block'}
              >
                <DressCard dress={dress} />
              </Link>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {filteredDresses.map((dress) => (
              <DressRow key={dress.id} dress={dress} highlighted={highlightedDressCode === dress.code} />
            ))}
          </div>
        )
      ) : (
        <EmptyState
          title={dresses.length === 0 ? 'لا توجد عناصر في المخزون بعد' : 'لا توجد عناصر مطابقة'}
          description={dresses.length === 0
            ? 'أضيفي أول قطعة، أو أنشئي تصميماً كاملاً بعدة مقاسات وألوان.'
            : 'غيّري البحث أو الفلاتر الحالية لعرض نتائج أخرى.'}
        />
      )}

      {showScanner && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
              <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-xl">
                <p className="text-lg font-bold text-slate-900">جاري تحميل الماسح…</p>
                <p className="mt-2 text-sm text-slate-500">انتظري لحظة حتى يتم تجهيز الكاميرا.</p>
              </div>
            </div>
          }
        >
          <BarcodeScanner
            onScan={handleBarcodeScan}
            onClose={() => setShowScanner(false)}
          />
        </Suspense>
      )}

      <AddDressModal open={showCreateModal} onClose={() => setShowCreateModal(false)} onCreated={handleCreated} />
      <AddDesignModal open={showDesignModal} onClose={() => setShowDesignModal(false)} onCreated={handleDesignCreated} />
      <SellDressModal open={showSaleModal} onClose={() => setShowSaleModal(false)} onCreated={handleSold} />
    </section>
  );
}
