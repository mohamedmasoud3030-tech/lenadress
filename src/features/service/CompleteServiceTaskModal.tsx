import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Modal } from '../../components/shared/Modal';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';
import { MIN_ZERO_AMOUNT, MONEY_STEP } from '../../shared/domain/businessRules';
import { STACKED_FORM_FIELD_CLASS_NAME, STACKED_FORM_LABEL_CLASS_NAME } from '../../shared/domain/formConstants';
import { getTodayISO } from '../../shared/utils/date';
import { createSubmissionKey } from '../../shared/utils/submissionKey';
import type { ServiceOutcomeStatus, ServiceTask } from './service.types';
import { completeServiceTaskCommand } from '../workflows';

type Props = { task: ServiceTask | null; onClose: () => void; onCompleted: (task: ServiceTask) => void };

const OUTCOMES: Array<{ value: ServiceOutcomeStatus; label: string }> = [
  { value: 'available', label: 'جاهزة ومتاحة' },
  { value: 'inspection', label: 'تحتاج فحصاً إضافياً' },
  { value: 'laundry', label: 'تحتاج غسيلاً' },
  { value: 'maintenance', label: 'تحتاج صيانة أو تعديلاً' },
  { value: 'damaged', label: 'تالفة' },
  { value: 'inactive', label: 'إيقاف من الخدمة' },
];

export function CompleteServiceTaskModal({ task, onClose, onCompleted }: Props) {
  const [completedDate, setCompletedDate] = useState(getTodayISO());
  const [cost, setCost] = useState('0');
  const [resultingItemStatus, setResultingItemStatus] = useState<ServiceOutcomeStatus>('available');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionKey, setSubmissionKey] = useState(() => createSubmissionKey('srv-done'));

  useEffect(() => {
    if (!task) return;
    setCompletedDate(getTodayISO());
    setCost('0');
    setResultingItemStatus('available');
    setNotes('');
    setError(null);
    setIsSubmitting(false);
    setSubmissionKey(createSubmissionKey('srv-done'));
  }, [task]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!task || isSubmitting) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const completed = completeServiceTaskCommand({
        taskId: task.id,
        completedDate,
        cost: Number(cost),
        resultingItemStatus,
        notes,
        idempotencyKey: submissionKey,
      });
      onCompleted(completed);
      onClose();
    } catch (reason: unknown) {
      setIsSubmitting(false);
      setError(reason);
    }
  };

  return (
    <Modal open={task !== null} onClose={onClose} title="إنهاء عمل الخدمة" className="max-w-2xl">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error !== null ? <UserFacingErrorAlert error={error} fallback="تعذر إنهاء عمل الخدمة." /> : null}

        <p className="rounded-xl bg-stone-50 p-3 text-sm text-slate-600">
          حالة القطعة بعد الخدمة قرار صريح. لن تصبح القطعة متاحة تلقائياً بدون هذا القرار.
        </p>

        <div className="grid gap-4 md:grid-cols-2">
          <label className={STACKED_FORM_LABEL_CLASS_NAME}>
            تاريخ الإنهاء
            <input
              required
              type="date"
              max={getTodayISO()}
              value={completedDate}
              onChange={(event) => setCompletedDate(event.target.value)}
              className={STACKED_FORM_FIELD_CLASS_NAME}
            />
          </label>
          <label className={STACKED_FORM_LABEL_CLASS_NAME}>
            التكلفة
            <input
              required
              type="number"
              min={MIN_ZERO_AMOUNT}
              step={MONEY_STEP}
              value={cost}
              onChange={(event) => setCost(event.target.value)}
              className={STACKED_FORM_FIELD_CLASS_NAME}
            />
          </label>
        </div>

        <label className={STACKED_FORM_LABEL_CLASS_NAME}>
          حالة القطعة بعد الخدمة
          <select
            value={resultingItemStatus}
            onChange={(event) => setResultingItemStatus(event.target.value as ServiceOutcomeStatus)}
            className={STACKED_FORM_FIELD_CLASS_NAME}
          >
            {OUTCOMES.map((outcome) => (
              <option key={outcome.value} value={outcome.value}>{outcome.label}</option>
            ))}
          </select>
        </label>

        <label className={STACKED_FORM_LABEL_CLASS_NAME}>
          ملاحظات
          <textarea rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} className={STACKED_FORM_FIELD_CLASS_NAME} />
        </label>

        <p className="text-xs text-slate-500">
          إدخال تكلفة أكبر من صفر ينشئ مصروفاً مرتبطاً بالقطعة يظهر في التقارير واليومية وربحية القطعة.
        </p>

        <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-slate-300 px-5 py-2 text-sm font-bold text-slate-700">
            إلغاء
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="min-h-11 rounded-xl bg-slate-950 px-5 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? 'جارٍ الحفظ…' : 'إنهاء العمل'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
