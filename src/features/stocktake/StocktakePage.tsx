import { Suspense, lazy, useMemo, useState } from 'react';
import { ClipboardCheck, PlayCircle, ScanLine, Trash2, XCircle } from 'lucide-react';
import { PageHeader } from '../../components/shared/PageHeader';
import { Section } from '../../components/shared/Section';
import { SummaryCard } from '../../components/shared/SummaryCard';
import { EmptyState } from '../../components/shared/StateViews';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';
import { AMBER_FOCUS_RING_CLASS_NAME, FORM_FIELD_CLASS_NAME } from '../../shared/domain/formConstants';
import {
  buildStocktakeReport,
  cancelStocktakeSession,
  completeStocktakeSession,
  getOpenStocktakeSession,
  getStocktakeSessions,
  recordStocktakeScan,
  removeStocktakeScan,
  startStocktakeSession,
} from './stocktake.service';
import { STOCKTAKE_ABSENCE_LABELS } from './stocktake.types';
import type { StocktakeReport, StocktakeSession } from './stocktake.types';

const BarcodeScanner = lazy(async () => {
  const module = await import('../dresses/BarcodeScanner');
  return { default: module.BarcodeScanner };
});

/**
 * Stocktake screen.
 *
 * The counting loop is the whole design: a single always-focused input that
 * accepts a scan or a typed code and clears itself. Anything that forces the
 * operator to put the phone down between pieces — a confirm dialog, a dropdown,
 * a save button — makes counting forty dresses take an hour, and a stocktake
 * that takes an hour never gets done twice.
 */
export function StocktakePage() {
  const [openSession, setOpenSession] = useState<StocktakeSession | undefined>(() => getOpenStocktakeSession());
  const [scopeInput, setScopeInput] = useState('');
  const [scanInput, setScanInput] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [closedReport, setClosedReport] = useState<StocktakeReport | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const report = useMemo<StocktakeReport | null>(() => {
    if (!openSession) return null;
    try {
      // refreshToken is read so the report recomputes after every scan.
      void refreshToken;
      return buildStocktakeReport(openSession.id);
    } catch {
      return null;
    }
  }, [openSession, refreshToken]);

  const history = useMemo(() => {
    // Read so the list refreshes after a session is closed or cancelled.
    void refreshToken;
    return getStocktakeSessions().filter((session) => session.status !== 'open').slice(0, 5);
  }, [refreshToken]);

  const handleStart = () => {
    setError(null);
    setClosedReport(null);
    try {
      setOpenSession(startStocktakeSession(scopeInput));
      setScopeInput('');
      setFeedback('تم بدء جلسة الجرد. امسحي كل قطعة موجودة في المحل.');
    } catch (caught) {
      setError(caught);
    }
  };

  const handleScan = (value: string) => {
    if (!openSession || !value.trim()) return;
    setError(null);
    try {
      const result = recordStocktakeScan(openSession.id, value);
      setOpenSession(result.session);
      setRefreshToken((token) => token + 1);
      setFeedback(result.duplicate
        ? `${result.scan?.name ?? ''} مسجّلة مسبقاً في هذه الجلسة.`
        : `تم تسجيل ${result.scan?.code ?? ''} — ${result.scan?.name ?? ''}.`);
      setScanInput('');
    } catch (caught) {
      setError(caught);
      setScanInput('');
    }
  };

  const handleRemove = (kind: 'dress' | 'accessory', itemId: string) => {
    if (!openSession) return;
    setError(null);
    try {
      setOpenSession(removeStocktakeScan(openSession.id, kind, itemId));
      setRefreshToken((token) => token + 1);
    } catch (caught) {
      setError(caught);
    }
  };

  const handleComplete = () => {
    if (!openSession) return;
    setError(null);
    try {
      setClosedReport(completeStocktakeSession(openSession.id));
      setOpenSession(undefined);
      setFeedback('تم إقفال جلسة الجرد.');
      setRefreshToken((token) => token + 1);
    } catch (caught) {
      setError(caught);
    }
  };

  const handleCancel = () => {
    if (!openSession) return;
    setError(null);
    try {
      cancelStocktakeSession(openSession.id);
      setOpenSession(undefined);
      setFeedback('تم إلغاء جلسة الجرد.');
      setRefreshToken((token) => token + 1);
    } catch (caught) {
      setError(caught);
    }
  };

  const shown = report ?? closedReport;

  return (
    <div className="min-w-0 space-y-5">
      <PageHeader
        eyebrow="المخزون"
        title="الجرد الدوري"
        description="امسحي كل قطعة موجودة فعلاً في المحل، والنظام يخبرك بما لم يُعثر عليه — مع استبعاد ما هو خارج المحل مع عميلة أو في المغسلة."
      />

      {error !== null && <UserFacingErrorAlert error={error} fallback="تعذر تنفيذ العملية." />}
      {feedback && (
        <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">
          {feedback}
        </p>
      )}

      {!openSession ? (
        <Section title="بدء جلسة جرد" description="يمكنك جرد المحل كاملاً أو رفاً واحداً. الجلسة الواحدة فقط تكون مفتوحة في نفس الوقت.">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
            <label className="block min-w-0">
              <span className="sr-only">نطاق الجرد</span>
              <input
                type="text"
                value={scopeInput}
                onChange={(event) => setScopeInput(event.target.value)}
                placeholder="نطاق الجرد (اختياري) — مثال: رف الزفاف"
                aria-label="نطاق الجرد"
                className={FORM_FIELD_CLASS_NAME}
              />
            </label>
            <button
              type="button"
              onClick={handleStart}
              className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-5 text-sm font-bold text-white transition hover:bg-slate-800 ${AMBER_FOCUS_RING_CLASS_NAME}`}
            >
              <PlayCircle aria-hidden="true" className="h-5 w-5" />
              بدء الجرد
            </button>
          </div>
        </Section>
      ) : (
        <Section
          title={`جلسة ${openSession.sessionNumber}${openSession.scope ? ` — ${openSession.scope}` : ''}`}
          description="امسحي الباركود أو اكتبي الكود ثم اضغطي Enter. تكرار نفس القطعة لا يسبب خطأ."
          action={
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleComplete}
                className={`inline-flex min-h-11 items-center gap-2 rounded-xl bg-emerald-600 px-3 text-sm font-bold text-white transition hover:bg-emerald-700 ${AMBER_FOCUS_RING_CLASS_NAME}`}
              >
                <ClipboardCheck aria-hidden="true" className="h-4 w-4" />
                إقفال الجرد
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className={`inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-bold text-slate-700 transition hover:bg-stone-100 ${AMBER_FOCUS_RING_CLASS_NAME}`}
              >
                <XCircle aria-hidden="true" className="h-4 w-4" />
                إلغاء
              </button>
            </div>
          }
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              handleScan(scanInput);
            }}
            className="grid gap-3 sm:grid-cols-[1fr_auto]"
          >
            <label className="block min-w-0">
              <span className="sr-only">كود أو باركود القطعة</span>
              <input
                type="text"
                value={scanInput}
                onChange={(event) => setScanInput(event.target.value)}
                placeholder="امسحي الباركود أو اكتبي الكود"
                aria-label="كود أو باركود القطعة"
                // A physical scanner types the value then presses Enter; keeping
                // this field focused is what makes the loop hands-free.
                autoFocus
                className={FORM_FIELD_CLASS_NAME}
              />
            </label>
            <button
              type="button"
              onClick={() => setShowScanner(true)}
              className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700 transition hover:bg-stone-100 ${AMBER_FOCUS_RING_CLASS_NAME}`}
            >
              <ScanLine aria-hidden="true" className="h-4 w-4" />
              كاميرا المسح
            </button>
          </form>
        </Section>
      )}

      {shown && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <SummaryCard label="تم عدّها" value={shown.summary.counted} tone="positive" hint={`من ${shown.summary.expectedPresent} متوقعة`} />
            <SummaryCard
              label="مفقودة"
              value={shown.summary.missingCount}
              tone={shown.summary.missingCount > 0 ? 'danger' : 'positive'}
              hint="بلا سبب معروف"
            />
            <SummaryCard label="خارج المحل بعذر" value={shown.summary.expectedAbsentCount} hint="مؤجرة أو في الخدمة" />
            <SummaryCard label="نسبة التغطية" value={`${shown.summary.coveragePercent}%`} tone="accent" />
          </div>

          {shown.missing.length > 0 && (
            <Section
              title={`لم يتم العثور عليها (${shown.missing.length})`}
              description="هذه القطع يفترض وجودها في المحل. راجعيها قبل اعتبارها مفقودة."
              className="border-rose-300 bg-rose-50/40"
            >
              <ul className="space-y-2">
                {shown.missing.map((finding) => (
                  <li key={`${finding.kind}-${finding.itemId}`} className="min-w-0 rounded-xl border border-rose-200 bg-white p-3">
                    <p className="truncate text-sm font-bold text-slate-950">{finding.name}</p>
                    <p className="mt-0.5 truncate text-xs text-slate-600">{finding.code} · {finding.detail}</p>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {shown.expectedAbsent.length > 0 && (
            <Section title={`غائبة بعذر (${shown.expectedAbsent.length})`} description="خارج المحل لسبب معروف — ليست خسارة.">
              <ul className="grid gap-2 sm:grid-cols-2">
                {shown.expectedAbsent.map((finding) => (
                  <li key={`${finding.kind}-${finding.itemId}`} className="min-w-0 rounded-xl border border-slate-200 bg-white p-3">
                    <p className="truncate text-sm font-bold text-slate-950">{finding.name}</p>
                    <p className="mt-0.5 truncate text-xs text-slate-600">
                      {finding.code} · {STOCKTAKE_ABSENCE_LABELS[finding.reason]}
                    </p>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {openSession && shown.present.length > 0 && (
            <Section title={`تم عدّها (${shown.present.length})`} description="اضغطي على سلة الحذف لإزالة مسح خاطئ.">
              <ul className="grid gap-2 sm:grid-cols-2">
                {shown.present.map((finding) => (
                  <li key={`${finding.kind}-${finding.itemId}`} className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-emerald-200 bg-emerald-50/40 p-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-950">{finding.name}</p>
                      <p className="mt-0.5 truncate text-xs text-slate-600">{finding.code}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemove(finding.kind, finding.itemId)}
                      aria-label={`إزالة مسح ${finding.code}`}
                      className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl border border-slate-300 bg-white text-slate-600 transition hover:bg-stone-100 ${AMBER_FOCUS_RING_CLASS_NAME}`}
                    >
                      <Trash2 aria-hidden="true" className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}

      {!openSession && !closedReport && history.length === 0 && (
        <EmptyState
          icon={<ClipboardCheck className="h-10 w-10" />}
          title="لم يتم إجراء أي جرد بعد"
          description="الجرد الدوري يكشف القطع الضائعة مبكراً، قبل أن تكتشفيها عند وصول عميلة لاستلامها."
        />
      )}

      {history.length > 0 && (
        <Section title="جلسات سابقة">
          <ul className="space-y-2">
            {history.map((session) => (
              <li key={session.id} className="min-w-0 rounded-xl border border-slate-200 bg-white p-3">
                <p className="truncate text-sm font-bold text-slate-950">
                  {session.sessionNumber}{session.scope ? ` — ${session.scope}` : ''}
                </p>
                <p className="mt-0.5 truncate text-xs text-slate-600">
                  {session.status === 'completed' ? 'مكتملة' : 'ملغاة'} · {session.scans.length} قطعة · {session.completedAt?.slice(0, 10) ?? ''}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {showScanner && (
        <Suspense fallback={null}>
          <BarcodeScanner
            onScan={(value) => {
              handleScan(value);
              setShowScanner(false);
            }}
            onClose={() => setShowScanner(false)}
          />
        </Suspense>
      )}
    </div>
  );
}
