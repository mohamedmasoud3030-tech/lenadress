import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, ArrowRight, Link2, Plus, Shirt } from 'lucide-react';
import { PageHeader } from '../../components/shared/PageHeader';
import { Section } from '../../components/shared/Section';
import { SummaryCard } from '../../components/shared/SummaryCard';
import { EmptyState } from '../../components/shared/StateViews';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';
import { DRESS_STATUS_LABELS, DRESS_STATUS_STYLES } from '../../shared/domain/dressConstants';
import { AMBER_FOCUS_RING_CLASS_NAME } from '../../shared/domain/formConstants';
import { getTodayISO, addDaysISO } from '../../shared/utils/date';
import { formatMoneyOMR } from '../../shared/utils/format';
import { archiveDesignCommand } from '../workflows';
import { AddVariantsModal } from './AddVariantsModal';
import { AssignToDesignModal } from './AssignToDesignModal';
import { getDesignPieces, getDressDesignByCode, summarizeDressDesign } from './design.service';

/**
 * Everything about one design in one place: what it is, which sizes and colours
 * are stocked, how many of each are free for a period the operator can change,
 * and every physical piece underneath it.
 *
 * The period selector is the point of the page. "Do we have this in size L?" is
 * always really "…for these dates", and the answer comes from the shared
 * conflict rule rather than a stored availability flag.
 */
export function DesignDetailsPage() {
  const { code = '' } = useParams();
  const navigate = useNavigate();

  const [refreshToken, setRefreshToken] = useState(0);
  const [showVariants, setShowVariants] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const today = getTodayISO();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(() => addDaysISO(today, 2));

  const design = useMemo(() => getDressDesignByCode(code), [code, refreshToken]);
  const period = useMemo(
    () => (from && to && to > from ? { pickupDate: from, returnDate: to } : undefined),
    [from, to],
  );

  const summary = useMemo(
    () => (design ? summarizeDressDesign(design, period) : null),
    [design, period, refreshToken],
  );
  const pieces = useMemo(
    () => (design ? getDesignPieces(design.id, true) : []),
    [design, refreshToken],
  );

  const refresh = (message: string) => {
    setRefreshToken((current) => current + 1);
    setFeedback(message);
    setError(null);
  };

  const handleArchive = () => {
    if (!design) return;
    if (!window.confirm(`سيتم أرشفة التصميم "${design.name}" مع الاحتفاظ بكل قطعه وتاريخها. هل تريدين المتابعة؟`)) return;
    try {
      archiveDesignCommand(design.id);
      navigate('/inventory', { replace: true });
    } catch (reason: unknown) {
      setError(reason);
    }
  };

  if (!design || !summary) {
    return (
      <section className="min-w-0 space-y-4">
        <PageHeader
          eyebrow="تفاصيل التصميم"
          title="التصميم غير موجود"
        />
        <Link
          to="/inventory"
          className={`inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-stone-100 ${AMBER_FOCUS_RING_CLASS_NAME}`}
        >
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
          العودة إلى المخزون
        </Link>
      </section>
    );
  }

  const totalFree = summary.variants.reduce((total, variant) => total + (variant.freeInPeriod ?? variant.available), 0);

  return (
    <section className="min-w-0 space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <PageHeader
          eyebrow={`تصميم ${design.code}`}
          title={design.name}
          description={design.description || 'مراجعة المقاسات والألوان المتوفرة والقطع المرتبطة بهذا التصميم.'}
        />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => { setFeedback(null); setShowVariants(true); }}
            className={`inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-slate-800 ${AMBER_FOCUS_RING_CLASS_NAME}`}
          >
            <Plus aria-hidden="true" className="h-4 w-4" />
            إضافة مقاس أو لون
          </button>
          <button
            type="button"
            onClick={() => { setFeedback(null); setShowAssign(true); }}
            className={`inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-stone-100 ${AMBER_FOCUS_RING_CLASS_NAME}`}
          >
            <Link2 aria-hidden="true" className="h-4 w-4" />
            ربط قطعة قائمة
          </button>
          <button
            type="button"
            onClick={handleArchive}
            className={`inline-flex min-h-11 items-center gap-2 rounded-xl border border-rose-300 bg-white px-4 py-2 text-sm font-bold text-rose-700 transition hover:bg-rose-50 ${AMBER_FOCUS_RING_CLASS_NAME}`}
          >
            <Archive aria-hidden="true" className="h-4 w-4" />
            أرشفة
          </button>
        </div>
      </div>

      {feedback && <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">{feedback}</div>}
      {error !== null && <UserFacingErrorAlert error={error} fallback="تعذر تنفيذ العملية على التصميم." />}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <SummaryCard label="إجمالي القطع" value={summary.pieceCount} />
        <SummaryCard label="متاحة الآن" value={summary.availableCount} tone="positive" />
        <SummaryCard label="المقاسات" value={summary.sizes.length} hint={summary.sizes.join(' · ') || '—'} />
        <SummaryCard label="الألوان" value={summary.colors.length} hint={summary.colors.join(' · ') || '—'} />
      </div>

      <Section
        title="التوفر خلال فترة محددة"
        description="غيّري التاريخين لمعرفة ما هو متاح فعلياً للحجز، بعد احتساب مدد التجهيز والتنظيف."
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <label className="block text-xs font-bold text-slate-600">
            من تاريخ
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-stone-50 px-3 text-sm outline-none transition focus-visible:border-amber-500 focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-amber-500/30"
            />
          </label>
          <label className="block text-xs font-bold text-slate-600">
            إلى تاريخ
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-stone-50 px-3 text-sm outline-none transition focus-visible:border-amber-500 focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-amber-500/30"
            />
          </label>
          <p className={`min-h-11 rounded-xl px-3 py-2 text-sm font-extrabold ${totalFree > 0 ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
            {period ? `${totalFree} قطعة متاحة` : 'حددي فترة صحيحة'}
          </p>
        </div>

        {summary.variants.length > 0 ? (
          <ul className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3" aria-label="المقاسات والألوان">
            {summary.variants.map((variant) => {
              const free = variant.freeInPeriod ?? variant.available;
              return (
                <li
                  key={`${variant.size}-${variant.color}`}
                  className={`flex items-center justify-between gap-2 rounded-xl border p-3 ${
                    free > 0 ? 'border-emerald-200 bg-emerald-50/60' : 'border-slate-200 bg-stone-50'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold text-slate-900">{variant.size} · {variant.color}</span>
                    <span className="block text-xs text-slate-500">{variant.total} قطعة مسجلة</span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-extrabold ${free > 0 ? 'bg-emerald-600 text-white' : 'bg-slate-300 text-slate-700'}`}>
                    {free > 0 ? `${free} متاحة` : 'محجوزة'}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-slate-500">لا توجد قطع مسجلة تحت هذا التصميم بعد.</p>
        )}
      </Section>

      <Section title={`القطع المرتبطة (${pieces.length})`} description="كل قطعة لها كود مخزون وباركود وتاريخ مستقل.">
        {pieces.length === 0 ? (
          <EmptyState
            icon={<Shirt className="h-10 w-10" />}
            title="لا توجد قطع تحت هذا التصميم"
            description="أضيفي مقاساً ولوناً، أو اربطي قطعة موجودة بالفعل في المخزون."
          />
        ) : (
          <ul className="space-y-2">
            {pieces.map((piece) => (
              <li key={piece.id}>
                <Link
                  to={`/inventory/${piece.code}`}
                  className={`flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:bg-stone-50 ${AMBER_FOCUS_RING_CLASS_NAME}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-slate-900">
                      <span dir="ltr">{piece.code}</span> · {piece.size} · {piece.color}
                    </span>
                    <span className="block truncate text-xs text-slate-500">{formatMoneyOMR(piece.rentalPrice)} للإيجار</span>
                  </span>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ${DRESS_STATUS_STYLES[piece.status]}`}>
                    {DRESS_STATUS_LABELS[piece.status]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <AddVariantsModal
        open={showVariants}
        design={design}
        onClose={() => setShowVariants(false)}
        onAdded={(count) => refresh(`تمت إضافة ${count} قطعة إلى التصميم.`)}
      />
      <AssignToDesignModal
        open={showAssign}
        designId={design.id}
        onClose={() => setShowAssign(false)}
        onAssigned={(pieceCode) => refresh(`تم ربط القطعة ${pieceCode} بهذا التصميم.`)}
      />
    </section>
  );
}
