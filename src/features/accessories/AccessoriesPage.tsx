import { Suspense, lazy, useMemo, useState } from 'react';
import { Barcode, Gem, Plus, Search } from 'lucide-react';
import { PageHeader } from '../../components/shared/PageHeader';
import { SummaryCard } from '../../components/shared/SummaryCard';
import { EmptyState } from '../../components/shared/StateViews';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';
import {
  ACCESSORY_CATEGORY_LABELS,
  ACCESSORY_CATEGORY_OPTIONS,
  ACCESSORY_STATUS_LABELS,
  ACCESSORY_STATUS_STYLES,
} from '../../shared/domain/accessoryConstants';
import { AMBER_FOCUS_RING_CLASS_NAME } from '../../shared/domain/formConstants';
import { formatMoneyOMR } from '../../shared/utils/format';
import { retireAccessoryCommand } from '../workflows';
import { AccessoryBarcodeCard } from './AccessoryBarcodeCard';
import { ViewModeToggle, useViewMode } from '../../components/shared/ViewModeToggle';
import { AddAccessoryModal } from './AddAccessoryModal';
import { filterAccessories, getAccessories, getAccessoryByBarcode, summarizeAccessories } from './accessory.service';
import type { Accessory, AccessoryFilters } from './accessory.types';

const BarcodeScanner = lazy(async () => {
  const module = await import('../dresses/BarcodeScanner');
  return { default: module.BarcodeScanner };
});

const fieldClassName =
  'min-h-11 w-full rounded-xl border border-slate-200 bg-stone-50 px-3 text-sm outline-none transition focus-visible:border-amber-500 focus-visible:ring-2 focus-visible:ring-amber-500/30';

function AccessoryCard({
  accessory,
  highlighted,
  onRetire,
}: {
  accessory: Accessory;
  highlighted: boolean;
  onRetire: (accessory: Accessory) => void;
}) {
  const [showBarcode, setShowBarcode] = useState(false);

  return (
    <article className={`rounded-2xl border bg-white p-5 shadow-sm transition ${highlighted ? 'border-amber-400 ring-2 ring-amber-300' : 'border-slate-200'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold text-slate-400" dir="ltr">{accessory.code}</p>
          <h2 className="mt-1 text-lg font-bold text-slate-950">{accessory.name}</h2>
          <p className="mt-1 text-xs font-bold text-violet-700">{ACCESSORY_CATEGORY_LABELS[accessory.category]}</p>
        </div>
        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ring-1 ${ACCESSORY_STATUS_STYLES[accessory.status]}`}>
          {ACCESSORY_STATUS_LABELS[accessory.status]}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
        <div className="rounded-xl bg-stone-50 p-3">
          <dt className="text-xs text-slate-400">تأجير</dt>
          <dd className="mt-1 font-bold text-slate-900">{accessory.rentalPrice ? formatMoneyOMR(accessory.rentalPrice) : '—'}</dd>
        </div>
        <div className="rounded-xl bg-stone-50 p-3">
          <dt className="text-xs text-slate-400">بيع</dt>
          <dd className="mt-1 font-bold text-slate-900">{accessory.salePrice ? formatMoneyOMR(accessory.salePrice) : '—'}</dd>
        </div>
        <div className="rounded-xl bg-stone-50 p-3">
          <dt className="text-xs text-slate-400">تأمين</dt>
          <dd className="mt-1 font-bold text-slate-900">{accessory.depositAmount ? formatMoneyOMR(accessory.depositAmount) : '—'}</dd> {/* legacy compat */}
        </div>
      </dl>

      {accessory.notes && <p className="mt-4 rounded-xl bg-stone-50 p-3 text-sm leading-6 text-slate-600">{accessory.notes}</p>}

      {showBarcode && (
        <div className="mt-4">
          <AccessoryBarcodeCard accessory={accessory} />
        </div>
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
        <button
          type="button"
          onClick={() => setShowBarcode((current) => !current)}
          aria-expanded={showBarcode}
          className={`inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-stone-100 ${AMBER_FOCUS_RING_CLASS_NAME}`}
        >
          <Barcode aria-hidden="true" className="h-4 w-4" />
          {showBarcode ? 'إخفاء الباركود' : 'الباركود والطباعة'}
        </button>
        {accessory.status !== 'retired' && (
          <button
            type="button"
            onClick={() => onRetire(accessory)}
            className={`inline-flex min-h-10 items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-slate-500 transition hover:bg-rose-50 hover:text-rose-700 ${AMBER_FOCUS_RING_CLASS_NAME}`}
          >
            إخراج من المخزون
          </button>
        )}
      </div>
    </article>
  );
}

export function AccessoriesPage() {
  const [accessories, setAccessories] = useState<Accessory[]>(() => getAccessories());
  const [filters, setFilters] = useState<AccessoryFilters>({ search: '', category: 'all', status: 'all' });
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [highlightedCode, setHighlightedCode] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [viewMode, setViewMode] = useViewMode('accessories');

  const filtered = useMemo(() => filterAccessories(accessories, filters), [accessories, filters]);
  const summary = useMemo(() => summarizeAccessories(accessories), [accessories]);

  const handleCreated = (accessory: Accessory) => {
    setAccessories(getAccessories());
    setHighlightedCode(accessory.code);
    setFeedback(`تمت إضافة الملحق ${accessory.code} — ${accessory.name}.`);
    setError(null);
  };

  const handleRetire = (accessory: Accessory) => {
    if (!window.confirm(`سيتم إخراج الملحق ${accessory.code} من المخزون مع الاحتفاظ بتاريخه. هل تريدين المتابعة؟`)) return;
    try {
      retireAccessoryCommand(accessory.id);
      setAccessories(getAccessories());
      setFeedback(`تم إخراج الملحق ${accessory.code} من المخزون.`);
      setError(null);
    } catch (reason: unknown) {
      setError(reason);
    }
  };

  const handleScan = (value: string) => {
    setShowScanner(false);
    const matched = getAccessoryByBarcode(value);
    if (!matched) {
      setHighlightedCode(null);
      setFeedback(`لم يتم العثور على ملحق مرتبط بالباركود ${value}.`);
      return;
    }
    setHighlightedCode(matched.code);
    setFilters((current) => ({ ...current, search: matched.code }));
    setFeedback(`تم العثور على الملحق ${matched.name} (${matched.code}).`);
  };

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <PageHeader
          eyebrow="الملحقات"
          title="إدارة الملحقات"
        />
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => { setFeedback(null); setError(null); setShowScanner(true); }}
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-5 py-3 text-sm font-bold text-slate-800 shadow-sm transition hover:bg-stone-100 ${AMBER_FOCUS_RING_CLASS_NAME}`}
          >
            <Barcode aria-hidden="true" className="h-5 w-5" />
            مسح باركود ملحق
          </button>
          <button
            type="button"
            onClick={() => { setFeedback(null); setError(null); setShowCreateModal(true); }}
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-slate-800 ${AMBER_FOCUS_RING_CLASS_NAME}`}
          >
            <Plus aria-hidden="true" className="h-5 w-5" />
            ملحق جديد
          </button>
        </div>
      </div>

      {feedback && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">{feedback}</div>}
      {error !== null && <UserFacingErrorAlert error={error} fallback="تعذر تنفيذ العملية على الملحق." />}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <SummaryCard label="إجمالي الملحقات" value={summary.total} />
        <SummaryCard label="متاحة" value={summary.available} tone="positive" />
        <SummaryCard label="محجوزة أو مسلّمة" value={summary.out} />
        <SummaryCard label="خارج الخدمة" value={summary.unavailable} tone={summary.unavailable > 0 ? 'warning' : 'default'} />
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="grid gap-3 lg:grid-cols-[1fr_190px_190px]">
          <label className="relative block">
            <span className="sr-only">البحث في الملحقات</span>
            <Search aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={filters.search}
              onChange={(event) => setFilters((current) => ({ ...current, search: event.target.value }))}
              placeholder="ابحثي بالاسم أو كود المخزون أو الباركود"
              className={`${fieldClassName} pr-11`}
            />
          </label>
          <label>
            <span className="sr-only">فئة الملحق</span>
            <select
              value={filters.category}
              onChange={(event) => setFilters((current) => ({ ...current, category: event.target.value as AccessoryFilters['category'] }))}
              className={fieldClassName}
            >
              <option value="all">كل الفئات</option>
              {ACCESSORY_CATEGORY_OPTIONS.map((category) => (
                <option key={category} value={category}>{ACCESSORY_CATEGORY_LABELS[category]}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">حالة الملحق</span>
            <select
              value={filters.status}
              onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as AccessoryFilters['status'] }))}
              className={fieldClassName}
            >
              <option value="all">كل الحالات</option>
              {Object.entries(ACCESSORY_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-bold text-slate-600">{filtered.length} ملحق</p>
        <ViewModeToggle mode={viewMode} onChange={setViewMode} />
      </div>

      {filtered.length > 0 ? (
        viewMode === 'grid' ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {filtered.map((accessory) => (
              <AccessoryCard
                key={accessory.id}
                accessory={accessory}
                highlighted={accessory.code === highlightedCode}
                onRetire={handleRetire}
              />
            ))}
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((accessory) => (
              <li
                key={accessory.id}
                className={`flex items-center gap-3 rounded-xl border bg-white p-3 ${
                  accessory.code === highlightedCode ? 'border-amber-400 ring-2 ring-amber-300' : 'border-slate-200'
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold text-slate-900">{accessory.name}</span>
                  <span className="block truncate text-xs text-slate-500">
                    <span dir="ltr">{accessory.code}</span> · {ACCESSORY_CATEGORY_LABELS[accessory.category]}
                    {accessory.rentalPrice ? ` · ${formatMoneyOMR(accessory.rentalPrice)}` : ''}
                  </span>
                </span>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ${ACCESSORY_STATUS_STYLES[accessory.status]}`}>
                  {ACCESSORY_STATUS_LABELS[accessory.status]}
                </span>
              </li>
            ))}
          </ul>
        )
      ) : (
        <EmptyState
          icon={<Gem className="h-10 w-10" />}
          title={accessories.length === 0 ? 'لا توجد ملحقات بعد' : 'لا توجد ملحقات مطابقة'}
          description={accessories.length === 0
            ? 'أضيفي أول ملحق ليحصل على كود مخزون ثابت وباركود قابل للطباعة والمسح.'
            : 'غيّري البحث أو الفلاتر الحالية لعرض نتائج أخرى.'}
          action={accessories.length === 0 ? (
            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className={`inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white ${AMBER_FOCUS_RING_CLASS_NAME}`}
            >
              <Plus aria-hidden="true" className="h-4 w-4" />
              إضافة أول ملحق
            </button>
          ) : undefined}
        />
      )}

      <AddAccessoryModal open={showCreateModal} onClose={() => setShowCreateModal(false)} onCreated={handleCreated} />
      {showScanner && (
        <Suspense fallback={null}>
          <BarcodeScanner onScan={handleScan} onClose={() => setShowScanner(false)} />
        </Suspense>
      )}
    </section>
  );
}
