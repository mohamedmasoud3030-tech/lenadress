import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, ArrowRight, Layers, Link2, Trash2 } from 'lucide-react';
import { PageHeader } from '../../components/shared/PageHeader';
import { SummaryCard } from '../../components/shared/SummaryCard';
import { DRESS_STATUS_LABELS, DRESS_STATUS_STYLES, INVENTORY_ITEM_TYPE_LABELS } from '../../shared/domain/dressConstants';
import { formatMoneyOMR } from '../../shared/utils/format';
import { getDressPerformance } from '../reports/report.service';
import { BarcodeGenerator } from './BarcodeGenerator';
import { DressLifecyclePanel } from './DressLifecyclePanel';
import { getBarcodeEngineEnvironmentNote, getBarcodeRuntimeSupportStatus } from './barcode.utils';
import { archiveDress, deleteDress, getDressDeletionBlockers, getDresses } from './dress.service';
import { AssignToDesignModal } from './AssignToDesignModal';

export function DressDetailsPage() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const dress = getDresses().find((item) => item.code === code);

  const [actionError, setActionError] = useState<string | null>(null);
  const [showAssign, setShowAssign] = useState(false);
  const [assignFeedback, setAssignFeedback] = useState<string | null>(null);
  const deletionBlockers = dress ? getDressDeletionBlockers(dress.code) : [];
  const canHardDelete = Boolean(dress) && deletionBlockers.length === 0;

  const handleArchive = () => {
    if (!dress) return;
    setActionError(null);
    if (!window.confirm(`سيتم أرشفة العنصر "${dress.name}" (${dress.code}) بدل حذفه، مع الاحتفاظ بكامل تاريخه. هل تريدين المتابعة؟`)) return;
    try {
      archiveDress(dress.code);
      navigate('/inventory', { replace: true });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'تعذر أرشفة العنصر.');
    }
  };

  const handleDelete = () => {
    if (!dress) return;
    setActionError(null);
    if (!canHardDelete) {
      setActionError(`${deletionBlockers.join(' ')} استخدمي الأرشفة بدل الحذف.`);
      return;
    }
    if (!window.confirm(`هل تريدين حذف العنصر "${dress.name}" (${dress.code}) نهائياً؟ لا يوجد أي تاريخ مرتبط به، ولن يُعاد استخدام كوده.`)) return;
    try {
      if (deleteDress(dress.code)) navigate('/inventory', { replace: true });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'تعذر حذف العنصر.');
    }
  };

  if (!dress) {
    return (
      <section className="space-y-4">
        <PageHeader
          eyebrow="تفاصيل عنصر المخزون"
          title="العنصر غير موجود"
          description="تعذر العثور على العنصر المطلوب. ربما تم حذفه أو أن الرابط غير صحيح."
        />
        <Link
          to="/inventory"
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-stone-100"
        >
          <ArrowRight aria-hidden="true" className="h-4 w-4" />
          العودة إلى المخزون
        </Link>
      </section>
    );
  }

  const cameraSupport = getBarcodeRuntimeSupportStatus();
  const engineNote = getBarcodeEngineEnvironmentNote();
  const primaryImage = dress.images[0];
  const performance = getDressPerformance().find((item) => item.id === dress.id || item.code === dress.code);

  return (
    <section className="space-y-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <PageHeader
          eyebrow="تفاصيل عنصر المخزون"
          title={dress.name}
          description="مراجعة بيانات العنصر والباركود وحالة الجاهزية والطباعة والأداء المحقق."
        />
        <div className="flex flex-wrap gap-3">
          <Link
            to="/inventory"
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-stone-100"
          >
            <ArrowRight aria-hidden="true" className="h-4 w-4" />
            العودة إلى المخزون
          </Link>
          <button
            type="button"
            onClick={handleArchive}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-bold text-amber-700 shadow-sm transition hover:bg-amber-50"
          >
            <Archive aria-hidden="true" className="h-4 w-4" />
            أرشفة العنصر
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={!canHardDelete}
            title={canHardDelete ? 'حذف نهائي متاح لعنصر بلا أي تاريخ.' : `${deletionBlockers.join(' ')} استخدمي الأرشفة بدل الحذف.`}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-rose-300 bg-white px-4 py-2 text-sm font-bold text-rose-700 shadow-sm transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Trash2 aria-hidden="true" className="h-4 w-4" />
            حذف نهائي
          </button>
        </div>
      </div>

      {actionError ? (
        <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">{actionError}</p>
      ) : null}

      {assignFeedback ? (
        <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-bold text-emerald-800">{assignFeedback}</p>
      ) : null}

      {/* Both directions of the design relationship must be walkable. */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
        <Layers aria-hidden="true" className="h-5 w-5 shrink-0 text-violet-700" />
        {dress.designCode ? (
          <>
            <p className="min-w-0 flex-1 text-sm text-slate-700">
              هذه القطعة جزء من التصميم <span className="font-extrabold text-slate-950" dir="ltr">{dress.designCode}</span>
            </p>
            <Link
              to={`/designs/${encodeURIComponent(dress.designCode)}`}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-700 transition hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
            >
              عرض التصميم والمقاسات الأخرى
            </Link>
          </>
        ) : (
          <>
            <p className="min-w-0 flex-1 text-sm text-slate-600">
              هذه القطعة غير مرتبطة بتصميم. اربطيها لتظهر مع بقية المقاسات والألوان.
            </p>
            <button
              type="button"
              onClick={() => { setAssignFeedback(null); setShowAssign(true); }}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 px-4 text-sm font-bold text-slate-700 transition hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2"
            >
              <Link2 aria-hidden="true" className="h-4 w-4" />
              ربط بتصميم
            </button>
          </>
        )}
      </div>

      {!canHardDelete && deletionBlockers.length > 0 ? (
        <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          لا يمكن حذف هذا العنصر نهائياً لأنه مرتبط بتاريخ تشغيلي أو مالي: {deletionBlockers.join(' ')} استخدمي الأرشفة للحفاظ على التقارير والسجل.
        </p>
      ) : null}

      <AssignToDesignModal
        open={showAssign}
        dressCode={dress.code}
        onClose={() => setShowAssign(false)}
        onAssigned={(pieceCode) => { setShowAssign(false); setAssignFeedback(`تم ربط القطعة ${pieceCode} بالتصميم. حدّثي الصفحة لعرض الرابط.`); }}
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-5">
        <SummaryCard label="كود العنصر" value={dress.code} />
        <SummaryCard label="نوع العنصر" value={INVENTORY_ITEM_TYPE_LABELS[dress.itemType ?? 'dress']} />
        <SummaryCard label="الباركود" value={dress.barcode} />
        <SummaryCard label="سعر البيع" value={dress.isForSale ? formatMoneyOMR(dress.salePrice) : 'غير متاح'} tone={dress.isForSale ? 'positive' : 'default'} />
        <SummaryCard label="سعر الإيجار" value={dress.isForRent ? formatMoneyOMR(dress.rentalPrice) : 'غير متاح'} tone={dress.isForRent ? 'positive' : 'default'} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {primaryImage ? (
            <img src={primaryImage} alt={dress.name} className="h-80 w-full rounded-2xl object-cover" />
          ) : (
            <div className="flex h-80 items-center justify-center rounded-2xl bg-stone-100 text-slate-400">
              لا توجد صورة رئيسية لهذا العنصر
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-sm text-slate-400">الحالة</p>
              <span className={`mt-2 inline-flex rounded-full px-3 py-1 text-xs font-bold ring-1 ${DRESS_STATUS_STYLES[dress.status]}`}>
                {DRESS_STATUS_LABELS[dress.status]}
              </span>
            </div>
            <div>
              <p className="text-sm text-slate-400">الفئة</p>
              <p className="mt-2 text-base font-bold text-slate-900">{dress.category}</p>
            </div>
            <div>
              <p className="text-sm text-slate-400">اللون</p>
              <p className="mt-2 text-base font-bold text-slate-900">{dress.color}</p>
            </div>
            <div>
              <p className="text-sm text-slate-400">المقاس</p>
              <p className="mt-2 text-base font-bold text-slate-900" dir="ltr">{dress.size}</p>
            </div>
            <div>
              <p className="text-sm text-slate-400">التأمين</p>
              <p className="mt-2 text-base font-bold text-slate-900">{dress.isForRent ? formatMoneyOMR(dress.depositAmount) : 'غير متاح'}</p>
            </div>
            <div>
              <p className="text-sm text-slate-400">عدد مرات التأجير</p>
              <p className="mt-2 text-base font-bold text-slate-900">{dress.timesRented}</p>
            </div>
          </div>

          {dress.description && (
            <div>
              <p className="text-sm text-slate-400">الوصف</p>
              <p className="mt-2 leading-7 text-slate-700">{dress.description}</p>
            </div>
          )}

          {dress.notes && (
            <div>
              <p className="text-sm text-slate-400">ملاحظات</p>
              <p className="mt-2 leading-7 text-slate-700">{dress.notes}</p>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <BarcodeGenerator value={dress.barcode} itemName={dress.name} itemCode={dress.code} />

          <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="text-sm font-bold text-slate-900">جاهزية المسح على الجهاز</h2>
            <p className={`mt-3 text-sm font-medium ${cameraSupport.supported ? 'text-emerald-700' : 'text-amber-800'}`}>
              {cameraSupport.message}
            </p>
            <p className="mt-3 text-sm text-slate-600">{engineNote}</p>
          </div>
        </div>
      </div>

      {performance ? <DressLifecyclePanel performance={performance} /> : null}
    </section>
  );
}
