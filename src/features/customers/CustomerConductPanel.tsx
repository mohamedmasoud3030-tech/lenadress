import { useMemo, useState } from 'react';
import { AlertTriangle, ShieldCheck, Trash2 } from 'lucide-react';
import { Section } from '../../components/shared/Section';
import { SelectField, TextField } from '../../components/shared/FormField';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';
import { AMBER_FOCUS_RING_CLASS_NAME } from '../../shared/domain/formConstants';
import { formatMoneyOMR } from '../../shared/utils/format';
import { addConductNote, getConductNotesForCustomer, getCustomerConduct, removeConductNote } from './customerConduct.service';
import type { ConductNote } from './customerConduct.types';
import type { Customer } from './customer.types';

const KIND_LABELS: Record<ConductNote['kind'], string> = {
  late_return: 'تأخر في الإرجاع',
  damage: 'تلف أو فقد',
  no_show: 'لم تحضر',
  cancellation: 'إلغاء',
  manual_note: 'ملاحظة',
};

const SEVERITY_STYLES = {
  positive: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  warning: 'bg-amber-50 text-amber-800 ring-amber-200',
  severe: 'bg-rose-50 text-rose-800 ring-rose-200',
} as const;

const SUGGESTED_LABELS = {
  trusted: 'موثوقة',
  normal: 'عادية',
  warning: 'تحتاج انتباه',
  blocked: 'يُنصح بالحظر',
} as const;

/**
 * The customer's record: what actually happened, and what an operator wrote.
 *
 * Derived events are marked as such, so nobody mistakes a computed count for
 * someone's opinion — and manual notes always show who wrote them.
 */
export function CustomerConductPanel({ customer }: { customer: Customer }) {
  const [refreshToken, setRefreshToken] = useState(0);
  const [note, setNote] = useState('');
  const [kind, setKind] = useState<ConductNote['kind']>('manual_note');
  const [severity, setSeverity] = useState<ConductNote['severity']>('warning');
  const [error, setError] = useState<unknown>(null);

  const conduct = useMemo(() => getCustomerConduct(customer), [customer, refreshToken]);
  const notes = useMemo(() => getConductNotesForCustomer(customer.id), [customer.id, refreshToken]);

  const refresh = () => setRefreshToken((current) => current + 1);

  const submitNote = () => {
    if (!note.trim()) return;
    setError(null);
    try {
      addConductNote({ customerId: customer.id, kind, severity, note });
      setNote('');
      refresh();
    } catch (reason: unknown) {
      setError(reason);
    }
  };

  const scoreTone = conduct.reliabilityScore >= 85
    ? 'text-emerald-700'
    : conduct.reliabilityScore >= 60
      ? 'text-amber-700'
      : 'text-rose-700';

  return (
    <Section title="سجل التعامل" description="مبني على ما حدث فعلاً في الحجوزات والتسليم، إضافة إلى ملاحظات مسجّلة يدوياً.">
      {error !== null && <UserFacingErrorAlert error={error} fallback="تعذر حفظ الملاحظة." />}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl bg-stone-50 p-3">
          <p className="text-xs text-slate-500">مؤشر الالتزام</p>
          <p className={`mt-1 text-xl font-extrabold ${scoreTone}`}>{conduct.reliabilityScore}</p>
        </div>
        <div className="rounded-xl bg-stone-50 p-3">
          <p className="text-xs text-slate-500">تأخير</p>
          <p className="mt-1 text-xl font-extrabold text-slate-900">{conduct.lateReturnCount}</p>
        </div>
        <div className="rounded-xl bg-stone-50 p-3">
          <p className="text-xs text-slate-500">تلف أو فقد</p>
          <p className="mt-1 text-xl font-extrabold text-slate-900">{conduct.damageCount}</p>
        </div>
        <div className="rounded-xl bg-stone-50 p-3">
          <p className="text-xs text-slate-500">لم تحضر</p>
          <p className="mt-1 text-xl font-extrabold text-slate-900">{conduct.noShowCount}</p>
        </div>
      </div>

      {conduct.advisories.length > 0 && (
        <div role="alert" className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <p className="flex items-center gap-2 text-sm font-extrabold text-amber-900">
            <AlertTriangle aria-hidden="true" className="h-4 w-4" />
            قبل الحجز لهذه العميلة
          </p>
          <ul className="mt-2 space-y-1 text-xs font-bold text-amber-900">
            {conduct.advisories.map((advisory) => <li key={advisory}>• {advisory}</li>)}
          </ul>
        </div>
      )}

      {conduct.suggestedStatus !== customer.status && (
        <p className="mt-3 flex items-center gap-2 rounded-xl bg-stone-50 p-3 text-xs text-slate-600">
          <ShieldCheck aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-500" />
          بناءً على السجل، التصنيف المقترح: <b className="text-slate-900">{SUGGESTED_LABELS[conduct.suggestedStatus]}</b>
          <span className="text-slate-400">— القرار النهائي لكِ.</span>
        </p>
      )}

      <div className="mt-4">
        <h3 className="text-sm font-extrabold text-slate-800">الأحداث ({conduct.events.length})</h3>
        {conduct.events.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">لا توجد ملاحظات أو مخالفات على هذه العميلة.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {conduct.events.slice(0, 12).map((event, index) => (
              <li key={`${event.kind}-${event.date}-${index}`} className="flex flex-wrap items-start justify-between gap-2 rounded-xl bg-stone-50 p-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-slate-800">{event.description}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    {event.date}
                    {event.reservationNumber ? ` · ${event.reservationNumber}` : ''}
                    {event.derived ? ' · محسوب من السجل' : ' · مسجّل يدوياً'}
                  </span>
                </span>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-bold ring-1 ${SEVERITY_STYLES[event.severity]}`}>
                  {KIND_LABELS[event.kind]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {conduct.outstandingAmount > 0 && (
        <p className="mt-3 rounded-xl bg-rose-50 p-3 text-sm font-bold text-rose-800">
          مبلغ غير مسدد: {formatMoneyOMR(conduct.outstandingAmount)}
        </p>
      )}

      <div className="mt-4 space-y-3 rounded-2xl border border-slate-200 bg-stone-50/70 p-3">
        <h3 className="text-sm font-extrabold text-slate-800">تسجيل ملاحظة</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField label="النوع" value={kind} onChange={(event) => setKind(event.target.value as ConductNote['kind'])}>
            {Object.entries(KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </SelectField>
          <SelectField label="الدرجة" value={severity} onChange={(event) => setSeverity(event.target.value as ConductNote['severity'])}>
            <option value="positive">إيجابية</option>
            <option value="neutral">محايدة</option>
            <option value="warning">تنبيه</option>
            <option value="severe">خطيرة</option>
          </SelectField>
        </div>
        <TextField
          label="الملاحظة"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="مثال: أعادت الفستان متأخرة يومين بدون إشعار."
        />
        <button
          type="button"
          onClick={submitNote}
          disabled={!note.trim()}
          className={`inline-flex min-h-11 items-center rounded-xl bg-slate-950 px-4 text-sm font-bold text-white transition hover:bg-slate-800 disabled:opacity-50 ${AMBER_FOCUS_RING_CLASS_NAME}`}
        >
          حفظ الملاحظة
        </button>

        {notes.length > 0 && (
          <ul className="space-y-1.5 border-t border-slate-200 pt-3">
            {notes.map((entry) => (
              <li key={entry.id} className="flex items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate text-slate-600">
                  {entry.note} — <b>{entry.recordedBy}</b>
                </span>
                <button
                  type="button"
                  onClick={() => { removeConductNote(entry.id); refresh(); }}
                  aria-label={`حذف الملاحظة: ${entry.note}`}
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-rose-50 hover:text-rose-700 ${AMBER_FOCUS_RING_CLASS_NAME}`}
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
