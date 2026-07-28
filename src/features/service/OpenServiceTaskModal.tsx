import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Modal } from '../../components/shared/Modal';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';
import { STACKED_FORM_FIELD_CLASS_NAME, STACKED_FORM_LABEL_CLASS_NAME } from '../../shared/domain/formConstants';
import { getTodayISO } from '../../shared/utils/date';
import { createSubmissionKey } from '../../shared/utils/submissionKey';
import { getDresses } from '../dresses/dress.service';
import { SERVICE_TASK_TYPE_LABELS, getServiceConflictBlockers } from './service.service';
import type { ServiceTask, ServiceTaskType } from './service.types';
import { openServiceTaskCommand } from '../workflows';

type Props = { open: boolean; onClose: () => void; onCreated: (task: ServiceTask) => void };

type Form = { dressCode: string; type: ServiceTaskType; startDate: string; expectedCompletionDate: string; notes: string };

function defaults(): Form {
  return { dressCode: '', type: 'inspection', startDate: getTodayISO(), expectedCompletionDate: '', notes: '' };
}

export function OpenServiceTaskModal({ open, onClose, onCreated }: Props) {
  const [form, setForm] = useState<Form>(defaults);
  const [error, setError] = useState<unknown>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionKey, setSubmissionKey] = useState(() => createSubmissionKey('srv'));

  // Items that are rented or sold cannot enter the service queue.
  const items = useMemo(
    () => getDresses().filter((dress) => dress.status !== 'rented' && dress.status !== 'sold'),
    [open],
  );

  const conflicts = form.dressCode
    ? getServiceConflictBlockers(form.dressCode, form.startDate, form.expectedCompletionDate || undefined)
    : [];

  useEffect(() => {
    if (!open) return;
    setForm(defaults());
    setError(null);
    setIsSubmitting(false);
    setSubmissionKey(createSubmissionKey('srv'));
  }, [open]);

  const close = () => {
    setForm(defaults());
    setError(null);
    onClose();
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setError(null);
    setIsSubmitting(true);
    try {
      const task = openServiceTaskCommand({
        dressCode: form.dressCode,
        type: form.type,
        startDate: form.startDate,
        expectedCompletionDate: form.expectedCompletionDate || undefined,
        notes: form.notes,
        idempotencyKey: submissionKey,
      });
      onCreated(task);
      close();
    } catch (reason: unknown) {
      setIsSubmitting(false);
      setError(reason);
    }
  };

  return (
    <Modal open={open} onClose={close} title="فتح عمل خدمة" className="max-w-2xl">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error !== null ? <UserFacingErrorAlert error={error} fallback="تعذر فتح عمل الخدمة." /> : null}

        <label className={STACKED_FORM_LABEL_CLASS_NAME}>
          القطعة
          <select
            required
            value={form.dressCode}
            onChange={(event) => setForm((current) => ({ ...current, dressCode: event.target.value }))}
            className={STACKED_FORM_FIELD_CLASS_NAME}
          >
            <option value="">اختاري القطعة</option>
            {items.map((dress) => (
              <option key={dress.id} value={dress.code}>{dress.code} — {dress.name}</option>
            ))}
          </select>
        </label>

        <label className={STACKED_FORM_LABEL_CLASS_NAME}>
          نوع الخدمة
          <select
            value={form.type}
            onChange={(event) => setForm((current) => ({ ...current, type: event.target.value as ServiceTaskType }))}
            className={STACKED_FORM_FIELD_CLASS_NAME}
          >
            {Object.entries(SERVICE_TASK_TYPE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>

        <div className="grid gap-4 md:grid-cols-2">
          <label className={STACKED_FORM_LABEL_CLASS_NAME}>
            تاريخ البدء
            <input
              required
              type="date"
              value={form.startDate}
              onChange={(event) => setForm((current) => ({ ...current, startDate: event.target.value }))}
              className={STACKED_FORM_FIELD_CLASS_NAME}
            />
          </label>
          <label className={STACKED_FORM_LABEL_CLASS_NAME}>
            الانتهاء المتوقع
            <input
              type="date"
              min={form.startDate}
              value={form.expectedCompletionDate}
              onChange={(event) => setForm((current) => ({ ...current, expectedCompletionDate: event.target.value }))}
              className={STACKED_FORM_FIELD_CLASS_NAME}
            />
          </label>
        </div>

        <label className={STACKED_FORM_LABEL_CLASS_NAME}>
          ملاحظات
          <textarea
            rows={3}
            value={form.notes}
            onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
            className={STACKED_FORM_FIELD_CLASS_NAME}
          />
        </label>

        {conflicts.length > 0 ? (
          <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-bold text-rose-700">
            {conflicts.join(' ')}
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:justify-end">
          <button type="button" onClick={close} className="min-h-11 rounded-xl border border-slate-300 px-5 py-2 text-sm font-bold text-slate-700">
            إلغاء
          </button>
          <button
            type="submit"
            disabled={isSubmitting || conflicts.length > 0 || items.length === 0}
            className="min-h-11 rounded-xl bg-slate-950 px-5 py-2 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? 'جارٍ الحفظ…' : 'فتح العمل'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
