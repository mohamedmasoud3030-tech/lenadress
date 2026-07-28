import type { FormEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../../components/shared/Modal';
import { FormActions, SelectField, TextAreaField, TextField } from '../../components/shared/FormField';
import { UserFacingErrorAlert } from '../../components/shared/UserFacingErrorAlert';
import { MAX_NOTES_LENGTH } from '../../shared/domain/businessRules';
import { getTodayISO } from '../../shared/utils/date';
import { createSubmissionKey } from '../../shared/utils/submissionKey';
import { getCustomers } from '../customers/customer.service';
import { bookAppointmentCommand } from '../workflows';
import type { Appointment, AppointmentStatus } from './appointment.types';

type AddAppointmentModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated: (appointment: Appointment) => void;
};

type Form = {
  customerId: string;
  customerName: string;
  phone: string;
  appointmentDate: string;
  startTime: string;
  endTime: string;
  notes: string;
};

function defaults(): Form {
  return {
    customerId: '',
    customerName: '',
    phone: '',
    appointmentDate: getTodayISO(),
    startTime: '10:00',
    endTime: '11:00',
    notes: '',
  };
}

export function AddAppointmentModal({ open, onClose, onCreated }: AddAppointmentModalProps) {
  const [form, setForm] = useState<Form>(() => defaults());
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionKey, setSubmissionKey] = useState(() => createSubmissionKey('apt'));

  const customers = useMemo(() => getCustomers(), [open]);

  useEffect(() => {
    if (!open) return;
    setForm(defaults());
    setSubmitError(null);
    setIsSubmitting(false);
    setSubmissionKey(createSubmissionKey('apt'));
  }, [open]);

  const close = () => {
    setForm(defaults());
    setSubmitError(null);
    onClose();
  };

  // Picking an existing customer fills her stable id and phone, so the
  // appointment is linked to the record rather than to a retyped name.
  const selectCustomer = (customerId: string) => {
    const customer = customers.find((item) => item.id === customerId);
    setForm((current) => ({
      ...current,
      customerId,
      customerName: customer?.name ?? current.customerName,
      phone: customer?.phone ?? current.phone,
    }));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setSubmitError(null);
    setIsSubmitting(true);

    try {
      const appointment = bookAppointmentCommand({
        customerId: form.customerId,
        customerName: form.customerName,
        phone: form.phone,
        appointmentDate: form.appointmentDate,
        startTime: form.startTime,
        endTime: form.endTime,
        status: 'pending' as AppointmentStatus,
        notes: form.notes,
        idempotencyKey: submissionKey,
      });

      onCreated(appointment);
      close();
    } catch (error: unknown) {
      setIsSubmitting(false);
      setSubmitError(error);
    }
  };

  return (
    <Modal open={open} onClose={close} title="حجز موعد جديد" className="max-w-lg">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {submitError !== null && <UserFacingErrorAlert error={submitError} fallback="تعذر حفظ الموعد." />}

        {customers.length > 0 && (
          <SelectField
            label="اختيار عميلة مسجلة (اختياري)"
            hint="يملأ الاسم والهاتف تلقائياً ويربط الموعد بسجل العميلة."
            value={form.customerId}
            onChange={(event) => selectCustomer(event.target.value)}
          >
            <option value="">عميلة جديدة أو غير مسجلة</option>
            {customers.map((customer) => (
              <option key={customer.id} value={customer.id}>{customer.name} — {customer.phone}</option>
            ))}
          </SelectField>
        )}

        <TextField
          label="اسم العميلة"
          required
          autoComplete="name"
          value={form.customerName}
          onChange={(event) => setForm({ ...form, customerName: event.target.value })}
        />

        <TextField
          label="رقم الهاتف"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          dir="ltr"
          placeholder="9XXXXXXX"
          value={form.phone}
          onChange={(event) => setForm({ ...form, phone: event.target.value })}
        />

        <TextField
          label="تاريخ الموعد"
          required
          type="date"
          min={getTodayISO()}
          value={form.appointmentDate}
          onChange={(event) => setForm({ ...form, appointmentDate: event.target.value })}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="وقت البداية"
            required
            type="time"
            value={form.startTime}
            onChange={(event) => setForm({ ...form, startTime: event.target.value })}
          />
          <TextField
            label="وقت النهاية"
            required
            type="time"
            value={form.endTime}
            error={form.endTime <= form.startTime ? 'وقت النهاية يجب أن يكون بعد وقت البداية.' : undefined}
            onChange={(event) => setForm({ ...form, endTime: event.target.value })}
          />
        </div>

        <TextAreaField
          label="ملاحظات"
          rows={3}
          maxLength={MAX_NOTES_LENGTH}
          value={form.notes}
          onChange={(event) => setForm({ ...form, notes: event.target.value })}
          placeholder="ملاحظات اختيارية عن القياس أو التفضيلات"
        />

        <FormActions
          onCancel={close}
          submitLabel="حفظ الموعد"
          isSubmitting={isSubmitting}
          disabled={form.endTime <= form.startTime}
        />
      </form>
    </Modal>
  );
}
