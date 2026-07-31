import { useMemo, useState } from 'react';
import { Ruler, Save } from 'lucide-react';
import { Section } from '../../components/shared/Section';
import { TextAreaField, TextField } from '../../components/shared/FormField';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';
import { MAX_NOTES_LENGTH } from '../../shared/domain/businessRules';
import { AMBER_FOCUS_RING_CLASS_NAME } from '../../shared/domain/formConstants';
import { getTodayISO } from '../../shared/utils/date';
import { updateCustomerCommand } from '../workflows';
import { getMeasurementLabel, parseLegacyMeasurements, suggestSize } from './measurements.service';
import type { CustomerMeasurements } from './measurements.types';
import type { Customer } from './customer.types';

const FIELDS: Array<keyof CustomerMeasurements> = [
  'bust', 'waist', 'hips', 'shoulder', 'length', 'armLength', 'height', 'heelHeight',
];

type Draft = Record<string, string>;

function toDraft(measurements?: CustomerMeasurements): Draft {
  const draft: Draft = {};
  FIELDS.forEach((field) => {
    const value = measurements?.[field];
    draft[field] = typeof value === 'number' ? String(value) : '';
  });
  draft.notes = measurements?.notes ?? '';
  return draft;
}

/**
 * Structured measurements with a live size suggestion.
 *
 * The suggestion updates as the operator types, so she can sanity-check it
 * against the customer standing in front of her rather than discovering a
 * surprise after saving.
 */
export function MeasurementsPanel({ customer, onSaved }: { customer: Customer; onSaved?: () => void }) {
  const initial = useMemo(
    // An older record has only free text; read what can be read from it.
    () => customer.bodyMeasurements ?? (customer.measurements ? parseLegacyMeasurements(customer.measurements) : {}),
    [customer],
  );

  const [draft, setDraft] = useState<Draft>(() => toDraft(initial));
  const [error, setError] = useState<unknown>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const measurements = useMemo<CustomerMeasurements>(() => {
    const parsed: CustomerMeasurements = {};
    FIELDS.forEach((field) => {
      const raw = draft[field];
      const value = raw === '' ? undefined : Number(raw);
      if (value !== undefined && Number.isFinite(value) && value > 0) {
        (parsed as Record<string, number>)[field] = value;
      }
    });
    parsed.notes = draft.notes?.trim() || undefined;
    return parsed;
  }, [draft]);

  const suggestion = useMemo(() => suggestSize(measurements), [measurements]);

  const save = () => {
    setError(null);
    try {
      updateCustomerCommand(customer.id, {
        bodyMeasurements: { ...measurements, measuredAt: getTodayISO() },
      });
      setFeedback('تم حفظ المقاسات.');
      onSaved?.();
    } catch (reason: unknown) {
      setError(reason);
    }
  };

  return (
    <Section
      title="المقاسات"
      description="المقاسات بالسنتيمتر. جميعها اختيارية — احفظي ما توفّر منها الآن وأكملي لاحقاً."
    >
      {error !== null && <UserFacingErrorAlert error={error} fallback="تعذر حفظ المقاسات." />}
      {feedback && <p role="status" className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">{feedback}</p>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {FIELDS.map((field) => (
          <TextField
            key={field}
            label={getMeasurementLabel(field)}
            type="number"
            inputMode="decimal"
            min={0}
            max={300}
            value={draft[field] ?? ''}
            onChange={(event) => setDraft((current) => ({ ...current, [field]: event.target.value }))}
            placeholder="سم"
          />
        ))}
      </div>

      <div className={`mt-4 flex items-start gap-3 rounded-xl p-3 ${suggestion.suggestedSize ? 'bg-emerald-50 ring-1 ring-emerald-200' : 'bg-stone-50'}`}>
        <Ruler aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-slate-600" />
        <div className="min-w-0">
          {suggestion.suggestedSize ? (
            <p className="text-sm font-extrabold text-emerald-900">المقاس المقترح: {suggestion.suggestedSize}</p>
          ) : (
            <p className="text-sm font-bold text-slate-700">لا يمكن اقتراح مقاس بعد</p>
          )}
          <p className="mt-1 text-xs leading-5 text-slate-600">{suggestion.reason}</p>
          <p className="mt-1 text-xs text-slate-500">الاقتراح إرشادي — القياس الفعلي هو الفيصل.</p>
        </div>
      </div>

      <div className="mt-4">
        <TextAreaField
          label="ملاحظات القياس"
          rows={2}
          maxLength={MAX_NOTES_LENGTH}
          value={draft.notes ?? ''}
          onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
          placeholder="مثال: تفضّل الأكمام الطويلة، الكتف يحتاج تضييقاً."
        />
      </div>

      {customer.bodyMeasurements?.measuredAt && (
        <p className="mt-2 text-xs text-slate-500">آخر تحديث للمقاسات: {customer.bodyMeasurements.measuredAt}</p>
      )}

      <button
        type="button"
        onClick={save}
        className={`mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white transition hover:bg-slate-800 ${AMBER_FOCUS_RING_CLASS_NAME}`}
      >
        <Save aria-hidden="true" className="h-4 w-4" />
        حفظ المقاسات
      </button>
    </Section>
  );
}
